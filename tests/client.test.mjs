import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

const require = createRequire(import.meta.url)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('built browser bundle loads on current module table, refreshes on turn end and targets duplicate text by node identity', async () => {
  const dom = new JSDOM('<div id="pane"><header id="header"></header><div data-chat-flow><div data-chat-flow-key="13:input-messagefirst" data-chat-flow-kind="user" data-chat-turn="1"><p>same text</p><div class="actions"><button>copy</button></div></div><div data-chat-flow-key="13:input-messagesecond" data-chat-flow-kind="user" data-chat-turn="2"><p>same text</p><div class="actions"><button>copy</button></div></div></div></div><div id="other"><div data-chat-flow-key="13:input-messagefirst"><div class="actions">same text<button>copy</button></div></div></div>', { url: 'http://localhost' })
  const globals = ['window', 'document', 'HTMLElement', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'fetch']
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  const table = new Set(['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'])
  let plugin
  window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(id => { assert.ok(table.has(id), `unknown module ${id}`); return require(id) }) } }
  const slots = []
  const effects = []
  const list = createSnapshotStore({ byId: { source: { id: 'source' } }, current: 'source' })
  const session = createSnapshotStore({ openState: 'open', removed: false, hasMore: false, running: false })
  const events = createSnapshotStore({ change: { kind: 'replace', entries: [] } })
  const ctx = {
    effect: fn => { const dispose = fn(); effects.push(dispose); return async () => dispose?.() },
    on: () => {},
    sessions: { list, binding: () => ({ session, eventSource: events }) },
    uiWorkspace: { openSession: () => {} },
    slots: {
      inject: (_key, callback) => { callback() },
      register: (definition, component) => slots.push({ definition, component }),
    },
  }
  const messages = ['first', 'second'].map((id, index) => ({ key: String(index), chatNodeKey: `13:input-message${id}`, turn: index + 1, eventSeq: index * 10 + 1, blockIndex: 0, kind: 'user', text: 'same text', time: 1 }))
  const timeline = { sessionId: 'source', messages, retryableTurns: [], versions: [], undoStack: [], redoSessionIds: [] }
  const posts = []
  let reads = 0
  globalThis.fetch = async (_url, init) => {
    assert.equal(new URL(_url, 'http://localhost').pathname, '/api/message-edit')
    if (init?.method === 'POST') { posts.push(JSON.parse(init.body)); return Response.json({ sessionId: 'source', queuedTurns: 1 }) }
    reads += 1
    return Response.json(timeline)
  }
  const root = createRoot(document.getElementById('header'))
  try {
    runInThisContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'))
    plugin.apply(ctx)
    assert.equal(slots.length, 2)
    const header = slots.find(slot => slot.definition.name === 'conversation.session.header.actions')
    const face = header.definition.inject('source')
    const useMessageEdit = selector => React.useSyncExternalStore(face.hooks.messageEdit.subscribe, () => selector(face.hooks.messageEdit.getSnapshot()))
    await act(async () => {
      root.render(React.createElement(header.component, { ...face, useMessageEdit }))
      await delay(20)
    })
    assert.equal(reads, 1)
    const buttons = [...document.querySelectorAll('#pane button[aria-label="编辑消息"]')]
    assert.equal(buttons.length, 2)
    assert.equal(document.querySelectorAll('#other button[aria-label="编辑消息"]').length, 0)
    await act(async () => {
      buttons[1].click()
      document.querySelector('textarea').value = 'changed second'
      ;[...document.querySelectorAll('button')].find(button => button.textContent === '保存').click()
      await delay(20)
    })
    assert.equal(posts[0].eventSeq, 11)
    assert.equal(posts[0].text, 'changed second')
    await act(async () => {
      events.set({ change: { kind: 'append', entries: [{ type: 'event', event: { type: 'turn/end' } }] } })
      await delay(350)
    })
    assert.equal(reads, 2)
    // When this pane switches to Timeline, never search a sibling Chat pane.
    const flow = document.querySelector('#pane [data-chat-flow]')
    document.getElementById('other').appendChild(flow)
    await act(async () => {
      events.set({ change: { kind: 'replace', entries: [] } })
      await delay(350)
    })
    assert.equal(document.querySelectorAll('#other button[aria-label="编辑消息"]').length, 0)
    await act(async () => { root.unmount(); await delay(10) })
    assert.equal(document.querySelectorAll('[aria-label="编辑消息"]').length, 0)
  } finally {
    for (const dispose of effects) await dispose?.()
    dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
