import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { apply, MESSAGE_EDIT_PATH } from '../index.mjs'

function turn(session, number, text) {
  const input = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [input] })
  session.append('turn/start', { turn: number })
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] })
  session.append('user/message', input, { surfaceOp: 'append' })
  session.append('step/start', { turn: number, step: 1 })
  session.append('assistant/message', {
    turn: number, step: 1, stream: [],
    message: createAssistantMessage({ content: [{ type: 'reasoning', text: 'thought' }, { type: 'text', text: `answer ${text}` }], source: { provider: 'test', model: 'model' } }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: number, step: 1 })
  session.append('turn/end', { turn: number, reason: { kind: 'completed' } })
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-message-edit-'))
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'))
    await rm(directory, { recursive: true, force: true })
  })
  const persistenceCtx = new Context()
  const persistenceFiber = await persistenceCtx.plugin(JsonlPersistence, { root: directory, compression: 'none' })
  t.after(async () => { await persistenceFiber.dispose() })
  const persistence = persistenceCtx.sessionPersistence
  const source = Session.create(SessionId('source'))
  turn(source, 1, 'same text')
  turn(source, 2, 'same text')
  const live = new Map([[source.id, source]])
  const agents = new Map()
  const resumes = []
  const queue = []
  let failResume = false
  let route
  const connection = new HostConnectionService(new Context(), [], {
    isAuthenticated: () => true,
    authenticateApi: () => undefined,
  })
  const transport = connection.createSharedFetchHandler('/api')
  const options = { provider: 'test', model: 'model', reasoningEffort: 'high', maxTokens: 1234 }
  const sourceAgent = { session: source, options, runMaintenance: fn => fn() }
  agents.set(source.id, sourceAgent)
  async function read(id) {
    const session = live.get(id)
    if (session) return { events: session.snapshotEvents(), inheritedEventCount: session.inheritedEventCount, session: session.header }
    const handle = await persistence.open(id, 'read')
    try { return { events: (await handle.read()).events, inheritedEventCount: handle.inheritedEventCount, session: handle.header } }
    finally { await handle.close() }
  }
  async function records() {
    const map = new Map((await persistence.list()).map(row => [row.header.id, { header: row.header, persisted: true, live: live.has(row.header.id) }]))
    for (const session of live.values()) if (!map.has(session.id)) map.set(session.id, { header: session.header, persisted: false, live: true })
    return map
  }
  const ctx = {
    effect: fn => fn(), get: () => undefined,
    connection: { fetch: { register: value => {
      route = value
      const dispose = connection.fetch.register(value)
      t.after(dispose)
      return dispose
    } } },
    sessionPersistence: persistence,
    sessions: { get: id => live.get(id), flush: async () => {} },
    workspaceRegistry: { list: () => [] },
    agents: {
      get: id => agents.get(id),
      resume: async args => {
        resumes.push(args)
        if (failResume) throw new Error('injected resume failure')
        // Real read handle/Session reconstruction, with Agent driving isolated.
        const value = await read(args.resumeSessionId)
        const session = Session.fromRestore(args.resumeSessionId, structuredClone(value.events), value.session, value.inheritedEventCount, 'detached')
        const agent = { session, options: args.agentOptions, runMaintenance: fn => fn(), followup: message => queue.push(message) }
        live.set(session.id, session); agents.set(session.id, agent)
        return { agent, dispose: async () => { live.delete(session.id); agents.delete(session.id) } }
      },
    },
    sessionQuery: {
      readSession: read,
      traceSession: async id => {
        const map = await records()
        const target = map.get(id)
        assert.ok(target)
        const ancestors = []
        let root = target
        while (root.header.parentSession) { root = map.get(root.header.parentSession); ancestors.push(root) }
        const descendants = record => [...map.values()].filter(row => row.header.parentSession === record.header.id)
          .map(session => ({ session, descendants: descendants(session) }))
        return { complete: true, root, target, ancestors, descendants: descendants(target) }
      },
    },
  }
  apply(ctx)
  assert.equal(MESSAGE_EDIT_PATH, '/api/message-edit')
  assert.deepEqual(route.methods, ['GET', 'POST'])
  assert.equal(route.requestBody, 'buffered')
  const request = async (operation) => {
    const response = await transport.fetch(new Request('http://localhost/api/message-edit', { method: 'POST', body: JSON.stringify(operation) }), connection.browserPeer)
    return { status: response.status, data: await response.json() }
  }
  const timeline = async id => {
    const response = await transport.fetch(new Request(`http://localhost/api/message-edit?sessionId=${id}`), connection.browserPeer)
    const data = await response.json()
    assert.equal(response.status, 200, JSON.stringify(data))
    return data
  }
  return { directory, source, live, queue, resumes, request, timeline, read, persistence, failResume: () => { failResume = true } }
}

test('manual assistant edit persists a valid v4 branch and keeps the original immutable', async t => {
  const f = await fixture(t)
  const before = JSON.stringify(f.source.snapshotEvents())
  const target = (await f.timeline('source')).messages.find(row => row.turn === 1 && row.kind === 'assistant.response')
  const result = await f.request({ action: 'edit', sessionId: 'source', eventSeq: target.eventSeq, blockIndex: target.blockIndex, text: 'edited', cascade: 'preserve' })
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(result.data.queuedTurns, 1)
  assert.equal(f.queue[0].content[0].text, 'same text')
  assert.equal(f.resumes[0].agentOptions.reasoningEffort, 'high')
  f.live.delete(result.data.sessionId)
  const cold = await f.read(result.data.sessionId)
  const version = cold.events.find(event => event.type === 'plugin:message-edit/version')
  assert.equal(version.ignorable, true)
  assert.equal(version.seq > cold.inheritedEventCount, true)
  assert.equal(cold.session.isSeeded, true)
  const assistant = cold.events.find(event => event.type === 'assistant/message')
  assert.deepEqual(assistant.data.stream, [])
  assert.equal(assistant.data.message.content[1].text, 'edited')
  assert.equal(cold.events.filter(event => event.type === 'turn/end').length, 1)
  assert.equal(JSON.stringify(f.source.snapshotEvents()), before)
  assert.deepEqual((await f.timeline(result.data.sessionId)).undoStack, ['source'])
})

test('nested branches distinguish ancestor metadata, retry queues and cold history', async t => {
  const f = await fixture(t)
  const first = await f.request({ action: 'retry', sessionId: 'source', turn: 2, cascade: 'truncate' })
  assert.equal(first.status, 200, JSON.stringify(first.data))
  const child = f.live.get(first.data.sessionId)
  turn(child, 2, 'new answer')
  const second = await f.request({ action: 'reroll', sessionId: child.id })
  assert.equal(second.status, 200, JSON.stringify(second.data))
  const view = await f.timeline(second.data.sessionId)
  assert.deepEqual(view.undoStack, [child.id, 'source'])
  assert.equal(view.versions.filter(row => row.effectId).length, 2)
  assert.equal(f.queue.length, 2)
  f.live.delete(first.data.sessionId)
  assert.equal((await f.timeline(second.data.sessionId)).versions.length, 3)
})

test('failed Agent resume reports a durable recoverable branch id', async t => {
  const f = await fixture(t)
  f.failResume()
  const result = await f.request({ action: 'reroll', sessionId: 'source' })
  assert.equal(result.status, 409)
  assert.match(result.data.error, /已保存/)
  const id = f.resumes[0].resumeSessionId
  assert.ok(result.data.error.includes(id))
  const log = await f.read(id)
  assert.ok(log.events.some(event => event.type === 'plugin:message-edit/version'))
})

test('invalid edits and open-tail retries leave no stored branches', async t => {
  const f = await fixture(t)
  f.source.append('turn/start', { turn: 3 })
  const result = await f.request({ action: 'retry', sessionId: 'source', turn: 3, cascade: 'truncate' })
  assert.equal(result.status, 409)
  assert.equal((await f.persistence.list()).length, 0)
  const invalid = await f.request({ action: 'retry', sessionId: 'source', turn: -1, cascade: 'truncate' })
  assert.equal(invalid.status, 400)
})
