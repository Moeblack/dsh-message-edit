/** Browser controller for one session's Timeline projection and branch mutations. */
import type {
  ClientContext,
  ConversationSnapshot,
  ISessions,
  ObservableSnapshot,
  SessionFace,
  SessionId,
  SessionListState,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  MESSAGE_EDIT_PATH,
  type CascadePolicy,
  type EditableBlockKind,
  type EditableMessageBlock,
  type EditOperation,
  type MessageEditChange,
  type MessageEditOperation,
  type MessageEditOperationResult,
  type MessageEditTimeline,
  type RetryableTurn,
  type VersionOperation,
  type VersionSummary,
} from '../shared.ts'

/** Reactive controller state shared by the Timeline and header entries. */
export interface MessageEditState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  pending: VersionOperation | null
  timeline: MessageEditTimeline | null
  drafts: MessageEditDrafts
}

/** Session-local edits that remain client-side until the user creates a fork. */
export interface MessageEditDrafts {
  textByKey: Record<string, string>
  deletedEventSeqs: number[]
}

/** Plain business face; the renderer binds the reserved source compartment. */
export interface MessageEditFace {
  hooks: { messageEdit: ObservableSnapshot<MessageEditState> }
  load(): void
  save(message: EditableMessageBlock, text: string): void
  delete(message: EditableMessageBlock): void
  restore(message: EditableMessageBlock): void
  commit(message: EditableMessageBlock, text: string, cascade: CascadePolicy): Promise<boolean>
  commitTurn(turn: number, cascade: CascadePolicy): Promise<boolean>
  retry(turn: number, cascade: CascadePolicy): Promise<boolean>
  reroll(): Promise<boolean>
  openVersion(sessionId: string): Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} 不是对象`)
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} 不是字符串`)
  return value
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} 不是数字`)
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} 不是布尔值`)
  return value
}

function blockKind(value: unknown): EditableBlockKind {
  if (value !== 'user' && value !== 'assistant.reasoning' && value !== 'assistant.response') {
    throw new TypeError('消息块类型无效')
  }
  return value
}

function decodeMessage(value: unknown, index: number): EditableMessageBlock {
  const row = objectValue(value, `messages[${String(index)}]`)
  return {
    key: stringValue(row['key'], '消息 key'),
    turn: numberValue(row['turn'], '消息 turn'),
    eventSeq: numberValue(row['eventSeq'], '消息 eventSeq'),
    blockIndex: numberValue(row['blockIndex'], '消息 blockIndex'),
    kind: blockKind(row['kind']),
    text: stringValue(row['text'], '消息 text'),
    time: numberValue(row['time'], '消息 time'),
  }
}

function decodeRetryable(value: unknown, index: number): RetryableTurn {
  const row = objectValue(value, `retryableTurns[${String(index)}]`)
  return {
    turn: numberValue(row['turn'], '回合 turn'),
    ...row['userEventSeq'] === undefined
      ? {}
      : { userEventSeq: numberValue(row['userEventSeq'], '回合 userEventSeq') },
    preview: stringValue(row['preview'], '回合 preview'),
    time: numberValue(row['time'], '回合 time'),
    retryable: booleanValue(row['retryable'], '回合 retryable'),
  }
}

function optionalOperation(value: unknown): VersionOperation | undefined {
  if (value === undefined) return undefined
  if (value === 'edit' || value === 'reroll' || value === 'retry') return value
  throw new TypeError('版本 operation 无效')
}

function decodeVersion(value: unknown, index: number): VersionSummary {
  const row = objectValue(value, `versions[${String(index)}]`)
  const operation = optionalOperation(row['operation'])
  const cascade = row['cascade']
  if (cascade !== undefined && cascade !== 'truncate' && cascade !== 'preserve') {
    throw new TypeError('版本 cascade 无效')
  }
  const kind = row['blockKind'] === undefined ? undefined : blockKind(row['blockKind'])
  return {
    sessionId: stringValue(row['sessionId'], '版本 sessionId'),
    ...row['parentSessionId'] === undefined
      ? {}
      : { parentSessionId: stringValue(row['parentSessionId'], '版本 parentSessionId') },
    ...row['effectId'] === undefined
      ? {}
      : { effectId: stringValue(row['effectId'], '版本 effectId') },
    ...row['inverseSessionId'] === undefined
      ? {}
      : { inverseSessionId: stringValue(row['inverseSessionId'], '版本 inverseSessionId') },
    createdAt: numberValue(row['createdAt'], '版本 createdAt'),
    depth: numberValue(row['depth'], '版本 depth'),
    current: booleanValue(row['current'], '版本 current'),
    onCurrentEffectPath: booleanValue(row['onCurrentEffectPath'], '版本 onCurrentEffectPath'),
    ...operation === undefined ? {} : { operation },
    ...cascade === undefined ? {} : { cascade },
    ...row['targetTurn'] === undefined ? {} : { targetTurn: numberValue(row['targetTurn'], '版本 targetTurn') },
    ...kind === undefined ? {} : { blockKind: kind },
    ...row['before'] === undefined ? {} : { before: stringValue(row['before'], '版本 before') },
    ...row['after'] === undefined ? {} : { after: stringValue(row['after'], '版本 after') },
  }
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} 不是数组`)
  return value
}

function stringArray(value: unknown, label: string): string[] {
  return arrayValue(value, label).map((item, index) => stringValue(item, `${label}[${String(index)}]`))
}

function decodeTimeline(value: unknown): MessageEditTimeline {
  const data = objectValue(value, 'Timeline 响应')
  return {
    sessionId: stringValue(data['sessionId'], 'Timeline sessionId'),
    messages: arrayValue(data['messages'], 'Timeline messages').map(decodeMessage),
    retryableTurns: arrayValue(data['retryableTurns'], 'Timeline retryableTurns').map(decodeRetryable),
    versions: arrayValue(data['versions'], 'Timeline versions').map(decodeVersion),
    undoStack: stringArray(data['undoStack'], 'Timeline undoStack'),
    redoSessionIds: stringArray(data['redoSessionIds'], 'Timeline redoSessionIds'),
  }
}

function decodeOperationResult(value: unknown): MessageEditOperationResult {
  const data = objectValue(value, '操作响应')
  return {
    sessionId: stringValue(data['sessionId'], '操作 sessionId'),
    queuedTurns: numberValue(data['queuedTurns'], '操作 queuedTurns'),
  }
}

function emptyDrafts(): MessageEditDrafts {
  return { textByKey: {}, deletedEventSeqs: [] }
}

function pruneDrafts(drafts: MessageEditDrafts, timeline: MessageEditTimeline): MessageEditDrafts {
  const messagesByKey = new Map(timeline.messages.map(message => [message.key, message]))
  const textByKey = Object.fromEntries(Object.entries(drafts.textByKey)
    .filter(([key, text]) => messagesByKey.get(key)?.text !== undefined && messagesByKey.get(key)?.text !== text))
  const messageEventSeqs = new Set(timeline.messages.map(message => message.eventSeq))
  return {
    textByKey,
    deletedEventSeqs: drafts.deletedEventSeqs.filter(eventSeq => messageEventSeqs.has(eventSeq)),
  }
}

async function responseValue(response: Response): Promise<unknown> {
  const value = await response.json() as unknown
  if (response.ok) return value
  const error = objectValue(value, '错误响应')['error']
  throw new Error(typeof error === 'string' ? error : `请求失败：HTTP ${String(response.status)}`)
}

function conversationRevision(snapshot: ConversationSnapshot): string {
  const turnEnds = [...snapshot.turnEnds.entries()]
    .map(([turn, seq]) => `${String(turn)}:${String(seq)}`)
    .join(',')
  return [snapshot.openState, snapshot.removed, snapshot.hasMore, turnEnds].join('|')
}

function lineageRevision(snapshot: SessionListState, sessionId: SessionId): string {
  let root = sessionId
  const ancestorIds = new Set<SessionId>()
  while (!ancestorIds.has(root)) {
    ancestorIds.add(root)
    const parent = snapshot.byId[root]?.parentId
    if (parent === undefined || snapshot.byId[parent] === undefined) break
    root = parent
  }

  const connected: string[] = []
  for (const rawId of Object.keys(snapshot.byId).sort()) {
    const id = rawId as SessionId
    const seen = new Set<SessionId>()
    let cursor: SessionId | undefined = id
    while (cursor !== undefined && !seen.has(cursor)) {
      if (cursor === root) {
        connected.push(`${id}>${snapshot.byId[id]?.parentId ?? ''}`)
        break
      }
      seen.add(cursor)
      cursor = snapshot.byId[cursor]?.parentId
    }
  }
  return connected.join('|')
}

/** One stable controller is shared by all entries mounted for the same session. */
export class MessageEditController {
  readonly store: SnapshotStore<MessageEditState> = createSnapshotStore<MessageEditState>({
    status: 'idle',
    error: null,
    pending: null,
    timeline: null,
    drafts: emptyDrafts(),
  })

  readonly face: MessageEditFace
  private generation = 0
  private readonly sessions: ISessions
  private sessionSource: SessionFace | undefined
  private sessionSourceDispose: (() => void) | undefined
  private sessionRevision: string | undefined
  private listRevision = ''
  private refreshScheduled = false
  private observing = false
  private readonly navigationWaits = new Set<() => void>()

  constructor(
    ctx: ClientContext,
    private readonly sessionId: SessionId,
  ) {
    this.sessions = ctx.get('sessions') as unknown as ISessions
    this.face = {
      hooks: { messageEdit: this.store },
      load: () => { void this.load() },
      save: (message, text) => { this.saveDraft(message, text) },
      delete: message => { this.deleteDraft(message) },
      restore: message => { this.restoreDraft(message) },
      commit: (message, text, cascade) => this.commitDraft(message, text, cascade),
      commitTurn: (turn, cascade) => this.commitTurn(turn, cascade),
      retry: (turn, cascade) => this.mutate({
        action: 'retry',
        sessionId: this.sessionId,
        turn,
        cascade,
      }),
      reroll: () => this.mutate({ action: 'reroll', sessionId: this.sessionId }),
      openVersion: sessionId => this.openWhenListed(sessionId as SessionId),
    }
    ctx.effect(() => this.observeDependencies(), `message-edit: observe ${sessionId}`)
  }

  /** Bind to replaceable value sources instead of retaining a Session object. */
  private observeDependencies(): () => void {
    this.observing = true
    this.listRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId)
    this.bindSessionSource()
    const disposeList = this.sessions.list.subscribe(() => {
      const rebound = this.bindSessionSource()
      const nextRevision = lineageRevision(this.sessions.list.getSnapshot(), this.sessionId)
      if (nextRevision === this.listRevision && !rebound) return
      this.listRevision = nextRevision
      this.invalidate()
    })
    return () => {
      this.observing = false
      this.generation += 1
      disposeList()
      this.sessionSourceDispose?.()
      this.sessionSourceDispose = undefined
      this.sessionSource = undefined
      this.sessionRevision = undefined
      for (const cancel of [...this.navigationWaits]) cancel()
    }
  }

  private bindSessionSource(): boolean {
    const source = this.sessions.binding(this.sessionId)?.session
    if (source === this.sessionSource) return false
    this.sessionSourceDispose?.()
    this.sessionSource = source
    this.sessionRevision = source === undefined ? undefined : conversationRevision(source.getSnapshot())
    this.sessionSourceDispose = source?.subscribe(() => {
      if (this.sessionSource !== source) return
      const revision = conversationRevision(source.getSnapshot())
      if (revision === this.sessionRevision) return
      this.sessionRevision = revision
      this.invalidate()
    })
    return true
  }

  private invalidate(): void {
    if (!this.observing || this.store.getSnapshot().status === 'idle' || this.refreshScheduled) return
    this.refreshScheduled = true
    queueMicrotask(() => {
      this.refreshScheduled = false
      if (this.observing && this.store.getSnapshot().status !== 'idle') void this.load()
    })
  }

  /** Refetch the full value-level projection; only the newest request commits. */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((state) => {
      state.status = 'loading'
      state.error = null
    })
    try {
      const response = await fetch(`${MESSAGE_EDIT_PATH}?sessionId=${encodeURIComponent(this.sessionId)}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const timeline = decodeTimeline(await responseValue(response))
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'ready'
        state.error = null
        state.timeline = timeline
        state.drafts = pruneDrafts(state.drafts, timeline)
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((state) => {
        state.status = 'error'
        state.error = messageOf(error)
      })
    }
  }

  /** Refresh only controllers whose projection has already been requested. */
  refreshIfLoaded(): void {
    if (this.store.getSnapshot().status !== 'idle') void this.load()
  }

  private saveDraft(message: EditableMessageBlock, text: string): void {
    this.store.update((state) => {
      const timeline = state.timeline
      if (timeline === null || !timeline.messages.some(candidate => candidate.key === message.key)) {
        state.error = '要保存的消息已不在当前会话中。'
        return
      }
      const textByKey = { ...state.drafts.textByKey }
      if (text === message.text) delete textByKey[message.key]
      else textByKey[message.key] = text
      state.drafts = { ...state.drafts, textByKey }
      state.error = null
    })
  }

  private deleteDraft(message: EditableMessageBlock): void {
    this.store.update((state) => {
      const textByKey = { ...state.drafts.textByKey }
      for (const key of Object.keys(textByKey)) {
        if (key.startsWith(`${String(message.eventSeq)}:`)) delete textByKey[key]
      }
      state.drafts = {
        textByKey,
        deletedEventSeqs: [...new Set([...state.drafts.deletedEventSeqs, message.eventSeq])],
      }
      state.error = null
    })
  }

  private restoreDraft(message: EditableMessageBlock): void {
    this.store.update((state) => {
      state.drafts = {
        ...state.drafts,
        deletedEventSeqs: state.drafts.deletedEventSeqs.filter(eventSeq => eventSeq !== message.eventSeq),
      }
      state.error = null
    })
  }

  private draftChangesForTurn(turn: number): MessageEditChange[] | undefined {
    const state = this.store.getSnapshot()
    const timeline = state.timeline
    if (timeline === null) return undefined
    const deleted = new Set(state.drafts.deletedEventSeqs)
    const deletedAdded = new Set<number>()
    const changes: MessageEditChange[] = []
    for (const message of timeline.messages) {
      if (message.turn !== turn) continue
      if (deleted.has(message.eventSeq)) {
        if (!deletedAdded.has(message.eventSeq)) {
          changes.push({ action: 'delete', eventSeq: message.eventSeq })
          deletedAdded.add(message.eventSeq)
        }
        continue
      }
      const text = state.drafts.textByKey[message.key]
      if (text !== undefined && text !== message.text) {
        changes.push({
          action: 'replace',
          eventSeq: message.eventSeq,
          blockIndex: message.blockIndex,
          text,
        })
      }
    }
    return changes
  }

  private async commitDraft(
    message: EditableMessageBlock,
    text: string,
    cascade: CascadePolicy,
  ): Promise<boolean> {
    this.saveDraft(message, text)
    return this.commitTurn(message.turn, cascade)
  }

  private async commitTurn(turn: number, cascade: CascadePolicy): Promise<boolean> {
    const changes = this.draftChangesForTurn(turn)
    if (changes === undefined) return false
    if (changes.length === 0) {
      this.store.update((state) => { state.error = '此回合没有已保存的编辑草稿。' })
      return false
    }
    const applied = await this.mutate({
      action: 'edit',
      sessionId: this.sessionId,
      turn,
      changes,
      cascade,
    } satisfies EditOperation)
    if (applied) this.clearTurnDraft(turn)
    return applied
  }

  private clearTurnDraft(turn: number): void {
    this.store.update((state) => {
      const messages = state.timeline?.messages.filter(message => message.turn === turn) ?? []
      const keys = new Set(messages.map(message => message.key))
      const eventSeqs = new Set(messages.map(message => message.eventSeq))
      const textByKey = Object.fromEntries(Object.entries(state.drafts.textByKey)
        .filter(([key]) => !keys.has(key)))
      state.drafts = {
        textByKey,
        deletedEventSeqs: state.drafts.deletedEventSeqs.filter(eventSeq => !eventSeqs.has(eventSeq)),
      }
    })
  }

  private async mutate(operation: MessageEditOperation): Promise<boolean> {
    const current = this.store.getSnapshot()
    if (current.pending !== null || current.status !== 'ready') return false
    this.store.update((state) => {
      state.pending = operation.action
      state.error = null
    })
    try {
      const response = await fetch(MESSAGE_EDIT_PATH, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(operation),
      })
      const result = decodeOperationResult(await responseValue(response))
      this.store.update((state) => { state.pending = null })
      await this.openWhenListed(result.sessionId as SessionId)
      return true
    } catch (error) {
      this.store.update((state) => {
        state.pending = null
        state.error = messageOf(error)
      })
      return false
    }
  }

  /** Session-list publication is the reactive dependency for navigation. */
  private openWhenListed(sessionId: SessionId): Promise<void> {
    if (this.sessions.list.getSnapshot().byId[sessionId] !== undefined) {
      this.sessions.open(sessionId)
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      let settled = false
      let dispose = (): void => {}
      const finish = (open: boolean): void => {
        if (settled) return
        settled = true
        dispose()
        this.navigationWaits.delete(cancel)
        if (open) this.sessions.open(sessionId)
        resolve()
      }
      const cancel = (): void => { finish(false) }
      this.navigationWaits.add(cancel)
      dispose = this.sessions.list.subscribe(() => {
        if (this.sessions.list.getSnapshot().byId[sessionId] === undefined) return
        finish(true)
      })
      if (this.sessions.list.getSnapshot().byId[sessionId] !== undefined) finish(true)
    })
  }
}
