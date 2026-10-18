import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { apply } from '../index.mjs'

const input = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const userTexts = request => request.messages.filter(m => m.role === 'user' && m.source.kind === 'user').map(m => m.content.map(b => b.text).join(''))

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-message-edit-loop-'))
  const ctx = new Context()
  const fibers = []
  const handles = []
  t.after(async () => {
    for (const handle of handles.reverse()) await handle.dispose()
    for (const fiber of fibers.reverse()) await fiber.dispose()
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '/') || resolve(directory).startsWith(resolve(tmpdir()) + '\\'))
    await rm(directory, { recursive: true, force: true })
  })
  for (const plugin of [LlmRuntime, SessionStore, SessionProjectionRegistry, SystemPrompt, ToolRuntime, AgentRegistry]) fibers.push(await ctx.plugin(plugin))
  fibers.push(await ctx.plugin(JsonlPersistence, { root: directory, compression: 'none' }))
  fibers.push(await ctx.plugin(AgentLoop, { agents: [] }))
  const requests = []
  class Adapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(options) {
      requests.push(structuredClone({ messages: options.messages }))
      for (const [index, blockType, text] of [[0, 'reasoning', 'original thought'], [1, 'text', 'original answer']]) {
        yield { type: 'block-start', index, blockType }
        yield { type: blockType === 'reasoning' ? 'reasoning-delta' : 'text-delta', index, text }
        yield { type: 'block-end', index, block: { type: blockType, text } }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['test'], new Adapter())
  const source = await ctx.agents.create({ sessionId: 'source', agentOptions: { provider: 'test', model: 'model' } })
  handles.push(source)
  source.agent.followup(input('original task'))
  await source.agent.whenIdle()
  assert.equal(source.agent.inbox.hasPending, false)
  assert.equal(requests.length, 1)
  const connection = new HostConnectionService(new Context(), [], { isAuthenticated: () => true })
  const transport = connection.createSharedFetchHandler('/api')
  apply({
    effect: fn => t.after(fn()), get: () => undefined,
    connection, sessions: ctx.sessions, sessionPersistence: ctx.sessionPersistence,
    workspaceRegistry: { list: () => [] },
    agents: {
      get: id => ctx.agents.get(id),
      resume: async options => { const handle = await ctx.agents.resume(options); handles.push(handle); return handle },
    },
  })
  async function operation(body) {
    const response = await transport.fetch(new Request('http://localhost/api/message-edit', { method: 'POST', body: JSON.stringify(body) }), connection.browserPeer)
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return ctx.agents.get(result.sessionId)
  }
  async function edit(agent, blockIndex, text) {
    const event = agent.session.snapshotEvents().find(e => e.type === 'assistant/message')
    return operation({ action: 'edit', sessionId: agent.session.id, eventSeq: event.seq, blockIndex, text, cascade: 'truncate' })
  }
  return { ctx, source: source.agent, handles, requests, operation, edit }
}

test('real followup, thinking edit, response edit and cold resume send only the new continuation', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const before = JSON.stringify(f.source.session.snapshotEvents())
  const thinking = await f.edit(f.source, 0, 'edited thought')
  assert.equal(thinking.inbox.hasPending, false)
  const response = await f.edit(thinking, 1, 'edited answer')
  assert.equal(response.inbox.hasPending, false)
  assert.equal(f.requests.length, 1, 'manual edits must not run the model')
  assert.equal(JSON.stringify(f.source.session.snapshotEvents()), before)
  const handle = f.handles.find(h => h.agent === response)
  await handle.dispose()
  f.handles.splice(f.handles.indexOf(handle), 1)
  const resumed = await f.ctx.agents.resume({ resumeSessionId: response.session.id, agentOptions: { provider: 'test', model: 'model' } })
  f.handles.push(resumed)
  assert.equal(resumed.agent.inbox.hasPending, false, 'cleared inbox must survive cold resume')
  resumed.agent.followup(input('继续'))
  await resumed.agent.whenIdle()
  assert.equal(f.requests.length, 2)
  assert.deepEqual(userTexts(f.requests[1]), ['original task', '继续'])
  const assistant = f.requests[1].messages.find(m => m.role === 'assistant')
  assert.deepEqual(assistant.content.filter(b => b.type === 'reasoning' || b.type === 'text'), [{ type: 'reasoning', text: 'edited thought' }, { type: 'text', text: 'edited answer' }])
  const ends = resumed.agent.session.snapshotEvents().filter(e => e.type === 'turn/end')
  assert.deepEqual(ends.map(e => e.data.turn), [1, 2])
  assert.equal(ends.at(-1).data.reason.kind, 'completed')
})

for (const action of ['edit', 'retry', 'reroll']) {
  test(`real ${action} queues the intended user input exactly once`, { timeout: 15000 }, async t => {
    const f = await fixture(t)
    const user = f.source.session.snapshotEvents().find(e => e.type === 'user/message')
    const body = action === 'edit'
      ? { action, sessionId: 'source', eventSeq: user.seq, blockIndex: 0, text: 'changed task', cascade: 'truncate' }
      : { action, sessionId: 'source', turn: 1, cascade: 'truncate' }
    const child = await f.operation(body)
    await child.whenIdle()
    assert.equal(f.requests.length, 2)
    assert.deepEqual(userTexts(f.requests[1]), [action === 'edit' ? 'changed task' : 'original task'])
    assert.equal(child.inbox.hasPending, false)
  })
}
