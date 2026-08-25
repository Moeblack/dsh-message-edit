/** Host half of Message Edit: turn-atomic forks and structurally reversible versions. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, AgentOptions, AgentSetup } from '@deepseek-ai/dsh-agent'
import type { PresetBearingSession } from '@deepseek-ai/dsh-agent-presets'
import type {
  SessionId,
  Session,
  SessionEvent,
  SessionEventType,
  SurfaceEventType,
  SurfaceIntent,
} from '@deepseek-ai/dsh-session'
import type {
  SessionLineageNode,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import type {
  AssistantMessage,
  ContentBlock,
  UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  MESSAGE_EDIT_PATH,
  MESSAGE_EDIT_VERSION_SCHEMA,
  type CascadePolicy,
  type EditOperation,
  type EditableBlockKind,
  type EditableMessageBlock,
  type LegacyMessageEditVersionEvent,
  type MessageEditEffect,
  type MessageEditOperation,
  type MessageEditOperationResult,
  type MessageEditTimeline,
  type MessageEditVersionEvent,
  type RetryableTurn,
  type StoredMessageEditVersionEvent,
  type VersionSummary,
} from './shared.ts'

export {
  MESSAGE_EDIT_PATH,
  MESSAGE_EDIT_VERSION_SCHEMA,
  MESSAGE_EDIT_VIEW_ORDER,
} from './shared.ts'
export type {
  CascadePolicy,
  EditOperation,
  EditableBlockKind,
  EditableMessageBlock,
  MessageEditOperation,
  MessageEditOperationResult,
  MessageEditTimeline,
  MessageEditEffect,
  MessageEditInverse,
  MessageEditVersionEvent,
  RerollOperation,
  RetryableTurn,
  RetryOperation,
  VersionOperation,
  VersionSummary,
} from './shared.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Durable branch provenance owned by moeblack/message-edit. */
    'message-edit/version': StoredMessageEditVersionEvent
  }
}

interface HttpRequestLike {
  method?: string
  url?: string
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): this
  on(event: 'end', listener: () => void): this
  on(event: 'error', listener: (error: unknown) => void): this
}

interface HttpResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): void
}

interface HttpServerLike {
  register(route: {
    kind: 'exact'
    path: string
    handler: (request: HttpRequestLike, response: HttpResponseLike) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: HttpServerLike
  }
}

/** Stable Cordis plugin name. */
export const name = 'message-edit'

/** Public services used by the branch transaction and timeline projection. */
export const inject = [
  'sessions',
  'agents',
  'sessionPersistence',
  'sessionQuery',
  'workspaceRegistry',
  'webServer',
]

type UserEvent = SessionEvent<'user/message'>
type AssistantEvent = SessionEvent<'assistant/message'>

interface ClosedTurn {
  turn: number
  startSeq: number
  endSeq: number
  user?: UserEvent
  assistants: AssistantEvent[]
}

interface ManualAssistantTurn {
  turn: number
  user: UserMessage
  assistant: AssistantMessage
}

interface OperationPlan {
  boundary: number
  version: MessageEditVersionEvent
  manualTurn?: ManualAssistantTurn
  queuedUsers: UserMessage[]
}

interface VersionProjection {
  effect: MessageEditEffect
  inverseSessionId: string
  time: number
}

type MessageEditEffectDraft = Omit<MessageEditEffect, 'id'>

function pairVersionEffect(
  sourceSessionId: string,
  effect: MessageEditEffectDraft,
): MessageEditVersionEvent {
  return {
    schemaVersion: MESSAGE_EDIT_VERSION_SCHEMA,
    effect: { ...effect, id: crypto.randomUUID() },
    inverse: { kind: 'restore-version', sessionId: sourceSessionId },
  }
}

function isTextualBlock(block: ContentBlock | undefined): block is Extract<ContentBlock, { type: 'text' | 'reasoning' }> {
  return block?.type === 'text' || block?.type === 'reasoning'
}

function userText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function cloneUser(message: UserMessage, content: ContentBlock[] = structuredClone(message.content)): UserMessage {
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'user' as const,
    content: Object.freeze(content),
    source: Object.freeze({ kind: 'user' as const }),
  }) as UserMessage
}

function replaceTextBlock(content: readonly ContentBlock[], blockIndex: number, text: string): ContentBlock[] {
  const block = content[blockIndex]
  if (!isTextualBlock(block)) throw new Error('所选内容块不是可编辑文本。')
  return content.map((candidate, index) => index === blockIndex
    ? { ...candidate, text } as ContentBlock
    : structuredClone(candidate))
}

/** Fold complete turn brackets; an open tail is deliberately absent. */
function closedTurns(events: readonly SessionEvent[]): ClosedTurn[] {
  const result: ClosedTurn[] = []
  let current: Omit<ClosedTurn, 'endSeq'> | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      current = {
        turn: event.data.turn,
        startSeq: event.seq,
        assistants: [],
      }
      continue
    }
    if (current === undefined) continue
    if (event.type === 'user/message'
      && current.user === undefined
      && event.data.source.kind === 'user') {
      current.user = event
      continue
    }
    if (event.type === 'assistant/message' && event.data.turn === current.turn) {
      current.assistants.push(event)
      continue
    }
    if (event.type === 'turn/end' && event.data.turn === current.turn) {
      result.push({ ...current, endSeq: event.seq })
      current = undefined
    }
  }
  return result
}

function editableMessages(turns: readonly ClosedTurn[]): EditableMessageBlock[] {
  const result: EditableMessageBlock[] = []
  for (const turn of turns) {
    if (turn.user !== undefined) {
      for (const [blockIndex, block] of turn.user.data.content.entries()) {
        if (block.type !== 'text') continue
        result.push({
          key: `${String(turn.user.seq)}:${String(blockIndex)}`,
          turn: turn.turn,
          eventSeq: turn.user.seq,
          blockIndex,
          kind: 'user',
          text: block.text,
          time: turn.user.time,
        })
      }
    }
    for (const event of turn.assistants) {
      for (const [blockIndex, block] of event.data.message.content.entries()) {
        if (!isTextualBlock(block)) continue
        result.push({
          key: `${String(event.seq)}:${String(blockIndex)}`,
          turn: turn.turn,
          eventSeq: event.seq,
          blockIndex,
          kind: block.type === 'reasoning' ? 'assistant.reasoning' : 'assistant.response',
          text: block.text,
          time: event.time,
        })
      }
    }
  }
  return result
}

function retryableTurns(turns: readonly ClosedTurn[]): RetryableTurn[] {
  return turns.flatMap((turn): RetryableTurn[] => turn.user === undefined ? [] : [{
    turn: turn.turn,
    userEventSeq: turn.user.seq,
    preview: userText(turn.user.data),
    time: turn.user.time,
  }])
}

function downstreamUsers(turns: readonly ClosedTurn[], start: number): UserMessage[] {
  return turns.slice(start).flatMap((turn): UserMessage[] => turn.user === undefined
    ? []
    : [cloneUser(turn.user.data)])
}

function assistantReplacement(event: AssistantEvent, blockIndex: number, text: string): AssistantMessage {
  const replaced = replaceTextBlock(event.data.message.content, blockIndex, text)
    .filter(block => block.type === 'text' || block.type === 'reasoning')
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'assistant' as const,
    content: Object.freeze(replaced),
    source: Object.freeze({
      kind: 'model' as const,
      provider: event.data.message.source.provider,
      model: event.data.message.source.model,
    }),
  }) as AssistantMessage
}

function editPlan(operation: EditOperation, turns: readonly ClosedTurn[]): OperationPlan {
  const turnIndex = turns.findIndex(turn => operation.eventSeq > turn.startSeq && operation.eventSeq < turn.endSeq)
  const turn = turns[turnIndex]
  if (turn === undefined) throw new Error('所选消息不属于已落定回合。')
  const event = turn.user?.seq === operation.eventSeq
    ? turn.user
    : turn.assistants.find(candidate => candidate.seq === operation.eventSeq)
  if (event === undefined) throw new Error('所选消息不存在或不可编辑。')

  if (event.type === 'user/message') {
    const before = event.data.content[operation.blockIndex]
    if (before?.type !== 'text') throw new Error('所选用户消息块不是文本。')
    const edited = cloneUser(event.data, replaceTextBlock(event.data.content, operation.blockIndex, operation.text))
    const later = operation.cascade === 'preserve' ? downstreamUsers(turns, turnIndex + 1) : []
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(operation.sessionId, {
        operation: 'edit',
        cascade: operation.cascade,
        targetTurn: turn.turn,
        targetEventSeq: event.seq,
        targetBlockIndex: operation.blockIndex,
        blockKind: 'user',
        before: before.text,
        after: operation.text,
      }),
      queuedUsers: [edited, ...later],
    }
  }

  const before = event.data.message.content[operation.blockIndex]
  if (!isTextualBlock(before)) throw new Error('所选助手消息块不是文本或思考。')
  const blockKind: EditableBlockKind = before.type === 'reasoning'
    ? 'assistant.reasoning'
    : 'assistant.response'
  if (turn.user === undefined) throw new Error('所选助手消息没有可重建的用户输入。')
  return {
    boundary: turn.startSeq - 1,
    version: pairVersionEffect(operation.sessionId, {
      operation: 'edit',
      cascade: operation.cascade,
      targetTurn: turn.turn,
      targetEventSeq: event.seq,
      targetBlockIndex: operation.blockIndex,
      blockKind,
      before: before.text,
      after: operation.text,
    }),
    manualTurn: {
      turn: turn.turn,
      user: cloneUser(turn.user.data),
      assistant: assistantReplacement(event, operation.blockIndex, operation.text),
    },
    queuedUsers: operation.cascade === 'preserve'
      ? downstreamUsers(turns, turnIndex + 1)
      : [],
  }
}

function retryPlan(
  sessionId: string,
  turnNumber: number,
  cascade: CascadePolicy,
  turns: readonly ClosedTurn[],
): OperationPlan {
  const turnIndex = turns.findIndex(turn => turn.turn === turnNumber)
  const turn = turns[turnIndex]
  if (turn?.user === undefined) throw new Error('所选回合没有可重放的用户输入。')
  return {
    boundary: turn.startSeq - 1,
    version: pairVersionEffect(sessionId, {
      operation: 'retry',
      cascade,
      targetTurn: turn.turn,
      targetEventSeq: turn.user.seq,
    }),
    queuedUsers: cascade === 'preserve'
      ? downstreamUsers(turns, turnIndex)
      : [cloneUser(turn.user.data)],
  }
}

function rerollPlan(sessionId: string, turns: readonly ClosedTurn[]): OperationPlan {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn?.user === undefined) continue
    const target = turn.assistants.findLast(event => event.data.message.content.some(isTextualBlock))
    if (target === undefined) continue
    return {
      boundary: turn.startSeq - 1,
      version: pairVersionEffect(sessionId, {
        operation: 'reroll',
        cascade: 'truncate',
        targetTurn: turn.turn,
        targetEventSeq: target.seq,
      }),
      queuedUsers: [cloneUser(turn.user.data)],
    }
  }
  throw new Error('当前会话没有可重生成的已落定助手回复。')
}

function planOperation(operation: MessageEditOperation, events: readonly SessionEvent[]): OperationPlan {
  const turns = closedTurns(events)
  switch (operation.action) {
    case 'edit':
      return editPlan(operation, turns)
    case 'reroll':
      return rerollPlan(operation.sessionId, turns)
    case 'retry':
      return retryPlan(operation.sessionId, operation.turn, operation.cascade, turns)
  }
}

function agentOptions(events: readonly SessionEvent[], fallback?: AgentOptions): AgentOptions {
  const config = events.findLast(event => event.type === 'request/header')?.data.header.config
  const provider = config?.provider ?? fallback?.provider
  const model = config?.model ?? fallback?.model
  if (provider === undefined || provider.length === 0 || model === undefined || model.length === 0) {
    throw new Error('无法从会话历史解析模型路由。')
  }
  const maxTokens = config?.maxTokens ?? fallback?.maxTokens
  return {
    provider,
    model,
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

async function withSourceAgent<T>(
  ctx: Context,
  sessionId: SessionId,
  operation: (agent: Agent) => Promise<T>,
): Promise<T> {
  let handle: AgentHandle | undefined
  let agent = ctx.agents.get(sessionId)
  if (agent === undefined) {
    const snapshot = await ctx.sessionQuery.readSession(sessionId)
    handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: agentOptions(snapshot.events),
    })
    agent = handle.agent
  }
  try {
    return await agent.runMaintenance(async () => operation(agent))
  } finally {
    await handle?.dispose()
  }
}

function inheritedSeed(source: Session, boundary: number): SessionEvent[] {
  if (boundary === -1) return []
  const boundaryEvent = source.events[boundary]
  if (boundary < 0 || boundaryEvent === undefined || boundaryEvent.seq !== boundary) {
    throw new Error('分支边界不是连续会话事件。')
  }
  return source.events.slice(0, boundary + 1)
}

/** Build seed envelopes locally; Session construction performs canonical validation and freezing. */
function appendLogSeedEvent<T extends Exclude<SessionEventType, SurfaceEventType>>(
  events: SessionEvent[],
  type: T,
  data: SessionEvent<T>['data'],
): void {
  events.push({
    type,
    seq: events.length,
    time: Date.now(),
    data,
    // Plugin-owned types (message-edit/*) live outside the harness event
    // vocabulary, so the persistence read path refuses the whole log after a
    // restart unless the envelope carries this marker. The seed envelope is
    // the only public surface that accepts it — Session.append() cannot set
    // it. The prefix check keeps every future plugin event marked by default.
    ...type.startsWith('message-edit/') ? { ignorable: true } : {},
  } as SessionEvent<T>)
}

function appendSurfaceSeedEvent<T extends SurfaceEventType>(
  events: SessionEvent[],
  type: T,
  data: SessionEvent<T>['data'],
  intent: SurfaceIntent,
): void {
  events.push({
    type,
    seq: events.length,
    time: Date.now(),
    data,
    surfaceOp: intent.surfaceOp,
    ...intent.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: intent.sourceEventSeqs },
  } as SessionEvent<T>)
}

function appendManualTurn(events: SessionEvent[], manual: ManualAssistantTurn): void {
  const { turn, user, assistant } = manual
  appendLogSeedEvent(events, 'turn/start', { turn })
  appendSurfaceSeedEvent(events, 'user/message', user, { surfaceOp: 'append' })
  appendLogSeedEvent(events, 'step/start', { turn, step: 1 })
  appendSurfaceSeedEvent(events, 'assistant/message', { turn, step: 1, message: assistant }, {
    surfaceOp: 'append',
    sourceEventSeqs: [],
  })
  appendLogSeedEvent(events, 'step/end', { turn, step: 1 })
  appendLogSeedEvent(events, 'turn/end', { turn, reason: { kind: 'completed' } })
}

function versionSeed(source: Session, plan: OperationPlan): {
  events: SessionEvent[]
  inheritedLength: number
} {
  const events = inheritedSeed(source, plan.boundary)
  const inheritedLength = events.length
  appendLogSeedEvent(events, 'message-edit/version', plan.version)
  if (plan.manualTurn !== undefined) appendManualTurn(events, plan.manualTurn)
  return { events, inheritedLength }
}

function sessionPreset(session: PresetBearingSession): string | undefined {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'agent-preset/selected') return event.data.agentPreset
  }
  return session.header.agentPreset
}

async function createVersionAgent(
  ctx: Context,
  source: Session,
  childId: SessionId,
  plan: OperationPlan,
  options: AgentOptions,
): Promise<AgentHandle> {
  const seed = versionSeed(source, plan)
  const presets = ctx.get('agentPresets')
  const presetId = sessionPreset(source)
  let agentPreset: string | undefined
  let setup: AgentSetup | undefined
  if (presets !== undefined && presetId !== undefined) {
    const resolved = (await presets.resolve(presetId)).id
    agentPreset = resolved
    setup = async (agentCtx) => { await presets.mount(agentCtx, resolved) }
  }
  const child = await ctx.agents.create({
    sessionId: childId,
    seed: seed.events,
    meta: {
      ...source.header.cwd === undefined ? {} : { cwd: source.header.cwd },
      parentSession: source.id,
      seedLength: seed.inheritedLength,
      ...agentPreset === undefined ? {} : { agentPreset },
    },
    agentOptions: options,
    ...setup === undefined ? {} : { setup },
  })
  try {
    await ctx.sessions.flush(child.agent.session)
    return child
  } catch (error: unknown) {
    await child.dispose()
    throw error
  }
}

function sourceWorkspace(ctx: Context, sessionId: SessionId): Workspace | undefined {
  return ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(sessionId))
}

type OperationInverse = () => void | Promise<void>

async function recoverOperation(inverses: OperationInverse[]): Promise<void> {
  const failures: unknown[] = []
  for (const inverse of inverses.reverse()) {
    try {
      await inverse()
    } catch (error: unknown) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, '版本操作恢复失败。')
}

async function runOperation(ctx: Context, operation: MessageEditOperation): Promise<MessageEditOperationResult> {
  const sourceId = sessionIdOf(operation.sessionId)
  return withSourceAgent(ctx, sourceId, async (source) => {
    const childId = sessionIdOf(`session-${crypto.randomUUID()}`)
    const inverses: OperationInverse[] = []
    try {
      const events = source.session.events
      const plan = planOperation(operation, events)
      const options = agentOptions(events, source.options)
      const child = await createVersionAgent(ctx, source.session, childId, plan, options)
      inverses.push(() => child.dispose())

      const workspace = sourceWorkspace(ctx, sourceId)
      if (workspace !== undefined) {
        await workspace.attachSession(childId)
        inverses.push(() => workspace.detachSession(childId))
      }
      for (const message of plan.queuedUsers) child.agent.followup(message)

      inverses.length = 0
      return { sessionId: childId, queuedTurns: plan.queuedUsers.length }
    } catch (error: unknown) {
      try {
        await recoverOperation(inverses)
      } catch (recoveryError: unknown) {
        throw new AggregateError([error, recoveryError], '版本操作及其恢复均失败。')
      }
      throw error
    }
  })
}

function ownVersionEvent(
  header: SessionRecord['header'],
  events: readonly SessionEvent[],
): VersionProjection | undefined {
  const inherited = header.seedLength ?? 0
  const ownEvents = events.filter((event): event is SessionEvent<'message-edit/version'> => (
    event.type === 'message-edit/version' && event.seq >= inherited
  ))
  if (ownEvents.length === 0) return undefined
  if (ownEvents.length > 1) {
    throw new Error(`会话 ${header.id} 包含多个自身版本效果。`)
  }
  const event = ownEvents[0]
  if (event === undefined) return undefined
  const parent = header.parentSession
  if ('schemaVersion' in event.data) {
    const version = event.data
    if (version.schemaVersion !== MESSAGE_EDIT_VERSION_SCHEMA) {
      throw new Error(`会话 ${header.id} 使用不支持的版本效果结构。`)
    }
    if (version.inverse.kind !== 'restore-version'
      || parent === undefined
      || version.inverse.sessionId !== parent) {
      throw new Error(`会话 ${header.id} 的版本效果与逆不匹配。`)
    }
    return { effect: version.effect, inverseSessionId: version.inverse.sessionId, time: event.time }
  }

  const legacy: LegacyMessageEditVersionEvent = event.data
  if (parent === undefined || legacy.sourceSessionId !== parent) {
    throw new Error(`会话 ${header.id} 的旧版恢复目标与父版本不匹配。`)
  }
  return {
    effect: {
      id: `legacy:${header.id}:${String(event.seq)}`,
      operation: legacy.operation,
      cascade: legacy.cascade,
      targetTurn: legacy.targetTurn,
      targetEventSeq: legacy.targetEventSeq,
      ...legacy.targetBlockIndex === undefined ? {} : { targetBlockIndex: legacy.targetBlockIndex },
      ...legacy.blockKind === undefined ? {} : { blockKind: legacy.blockKind },
      ...legacy.before === undefined ? {} : { before: legacy.before },
      ...legacy.after === undefined ? {} : { after: legacy.after },
    },
    inverseSessionId: legacy.sourceSessionId,
    time: event.time,
  }
}

function flattenLineage(
  root: SessionRecord,
  descendants: readonly SessionLineageNode[],
): Array<{ record: SessionRecord; depth: number }> {
  const result: Array<{ record: SessionRecord; depth: number }> = [{ record: root, depth: 0 }]
  const visit = (nodes: readonly SessionLineageNode[], depth: number): void => {
    const ordered = [...nodes].sort((left, right) => (
      left.session.header.createdAt - right.session.header.createdAt
      || String(left.session.header.id).localeCompare(String(right.session.header.id))
    ))
    for (const node of ordered) {
      result.push({ record: node.session, depth })
      visit(node.descendants, depth + 1)
    }
  }
  visit(descendants, 1)
  return result
}

/** Minimal read face of the optional persistence service; borrowed events are
 * consumed synchronously inside one timeline projection. */
interface PersistenceReaderLike {
  inspect(sessionId: SessionId, signal?: AbortSignal): Promise<{ events: readonly SessionEvent[] }>
  readFrom(sessionId: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ events: readonly SessionEvent[] }>
}

/** Bounded parallel inspection of persisted branches; matches the corpus worker shape. */
const TIMELINE_READ_CONCURRENCY = 4

async function mapConcurrent<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as T)
    }
  }
  const workers = Math.min(TIMELINE_READ_CONCURRENCY, items.length)
  await Promise.all(Array.from({ length: workers }, () => run()))
  return results
}

/** Full log for the requested session: live borrow, persisted inspection, query fallback. */
async function readCurrentLog(ctx: Context, sessionId: SessionId): Promise<readonly SessionEvent[]> {
  const live = ctx.sessions.get(sessionId)
  if (live !== undefined) return live.events
  const persistence = ctx.get('sessionPersistence') as PersistenceReaderLike | undefined
  if (persistence !== undefined) return (await persistence.inspect(sessionId)).events
  return (await ctx.sessionQuery.readSession(sessionId)).events
}

/** Own-version scan window for one lineage node: the tail from the durable
 * seed boundary is enough, and root nodes cannot carry a version effect. */
async function versionLog(ctx: Context, record: SessionRecord): Promise<readonly SessionEvent[]> {
  const inherited = record.header.seedLength ?? 0
  const live = ctx.sessions.get(record.header.id)
  if (live !== undefined) return live.events.slice(inherited)
  const persistence = ctx.get('sessionPersistence') as PersistenceReaderLike | undefined
  if (persistence !== undefined) return (await persistence.readFrom(record.header.id, inherited)).events
  return (await ctx.sessionQuery.readSession(record.header.id)).events.slice(inherited)
}

async function timeline(ctx: Context, sessionId: SessionId): Promise<MessageEditTimeline> {
  const targetTrace = await ctx.sessionQuery.traceSession(sessionId)
  const rootId = targetTrace.complete
    ? targetTrace.root.header.id
    : targetTrace.ancestors.at(-1)?.header.id ?? sessionId
  const rootTrace = rootId === sessionId ? targetTrace : await ctx.sessionQuery.traceSession(rootId)
  const lineage = flattenLineage(rootTrace.target, rootTrace.descendants)
  const logs = await mapConcurrent(lineage, async ({ record }): Promise<readonly SessionEvent[]> => {
    if (record.header.id === sessionId) return readCurrentLog(ctx, sessionId)
    if (record.header.parentSession === undefined) return []
    return versionLog(ctx, record)
  })
  const recordsById = new Map(lineage.map(({ record }) => [record.header.id, record]))
  const currentPath = new Set<SessionId>()
  let pathId: SessionId | undefined = sessionId
  while (pathId !== undefined && !currentPath.has(pathId)) {
    currentPath.add(pathId)
    pathId = recordsById.get(pathId)?.header.parentSession
  }

  const versions: VersionSummary[] = lineage.map(({ record, depth }, index) => {
    const version = ownVersionEvent(record.header, logs[index] ?? [])
    return {
      sessionId: record.header.id,
      ...record.header.parentSession === undefined ? {} : { parentSessionId: record.header.parentSession },
      ...version === undefined ? {} : {
        effectId: version.effect.id,
        inverseSessionId: version.inverseSessionId,
      },
      createdAt: version?.time ?? record.header.createdAt,
      depth,
      current: record.header.id === sessionId,
      onCurrentEffectPath: currentPath.has(record.header.id),
      ...version === undefined ? {} : {
        operation: version.effect.operation,
        cascade: version.effect.cascade,
        targetTurn: version.effect.targetTurn,
        ...version.effect.blockKind === undefined ? {} : { blockKind: version.effect.blockKind },
        ...version.effect.before === undefined ? {} : { before: version.effect.before },
        ...version.effect.after === undefined ? {} : { after: version.effect.after },
      },
    }
  })
  const effectIds = new Set<string>()
  for (const version of versions) {
    if (version.effectId === undefined) continue
    if (effectIds.has(version.effectId)) throw new Error(`版本效果 ${version.effectId} 重复。`)
    effectIds.add(version.effectId)
  }

  const versionsById = new Map(versions.map(version => [version.sessionId, version]))
  const undoStack: string[] = []
  let undoCursor = versionsById.get(sessionId)
  while (undoCursor?.inverseSessionId !== undefined) {
    const inverseId = undoCursor.inverseSessionId
    if (undoStack.includes(inverseId)) throw new Error('版本效果逆链包含循环。')
    if (!versionsById.has(inverseId)) throw new Error(`恢复目标 ${inverseId} 不在可见版本树中。`)
    undoStack.push(inverseId)
    undoCursor = versionsById.get(inverseId)
  }
  const redoSessionIds = versions
    .filter(version => version.inverseSessionId === sessionId)
    .map(version => version.sessionId)

  const currentIndex = versions.findIndex(version => version.current)
  const currentLog = logs[currentIndex]
  if (currentIndex < 0 || currentLog === undefined) throw new Error('当前版本不在版本树中。')
  const turns = closedTurns(currentLog)
  return {
    sessionId,
    messages: editableMessages(turns),
    retryableTurns: retryableTurns(turns),
    versions,
    undoStack,
    redoSessionIds,
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('请求体必须是 JSON 对象。')
  }
  return value as Record<string, unknown>
}

function sessionIdOf(value: unknown): SessionId {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('sessionId 必须是非空字符串。')
  return value as SessionId
}

function integerOf(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} 必须是非负安全整数。`)
  }
  return value as number
}

function cascadeOf(value: unknown): CascadePolicy {
  if (value !== 'truncate' && value !== 'preserve') throw new TypeError('cascade 必须是 truncate 或 preserve。')
  return value
}

function decodeOperation(value: unknown): MessageEditOperation {
  const record = objectValue(value)
  const sessionId = sessionIdOf(record['sessionId'])
  switch (record['action']) {
    case 'edit':
      if (typeof record['text'] !== 'string') throw new TypeError('text 必须是字符串。')
      return {
        action: 'edit',
        sessionId,
        eventSeq: integerOf(record['eventSeq'], 'eventSeq'),
        blockIndex: integerOf(record['blockIndex'], 'blockIndex'),
        text: record['text'],
        cascade: cascadeOf(record['cascade']),
      }
    case 'reroll':
      return { action: 'reroll', sessionId }
    case 'retry':
      return {
        action: 'retry',
        sessionId,
        turn: integerOf(record['turn'], 'turn'),
        cascade: cascadeOf(record['cascade']),
      }
    default:
      throw new TypeError('action 必须是 edit、reroll 或 retry。')
  }
}

function requestJson(request: HttpRequestLike): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder()
    let text = ''
    request.on('data', (chunk) => {
      text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    })
    request.on('end', () => {
      try {
        text += decoder.decode()
        resolve(JSON.parse(text) as unknown)
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function respondJson(response: HttpResponseLike, status: number, value: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function handleRoute(ctx: Context, request: HttpRequestLike, response: HttpResponseLike): Promise<void> {
  try {
    if (request.method === 'GET') {
      const url = new URL(request.url ?? MESSAGE_EDIT_PATH, 'http://message-edit.local')
      const sessionId = sessionIdOf(url.searchParams.get('sessionId'))
      respondJson(response, 200, await timeline(ctx, sessionId))
      return
    }
    if (request.method === 'POST') {
      respondJson(response, 200, await runOperation(ctx, decodeOperation(await requestJson(request))))
      return
    }
    response.writeHead(405)
    response.end()
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    respondJson(response, error instanceof TypeError ? 400 : 409, { error: message })
  }
}

/** Register the reversible route contribution. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MESSAGE_EDIT_PATH,
    handler: (request, response) => handleRoute(ctx, request, response),
  }), 'message-edit: HTTP route')
}
