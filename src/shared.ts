/** Same-origin endpoint owned by the Message Edit host plugin. */
export const MESSAGE_EDIT_PATH = '/message-edit'

/** Timeline sits between Trajectory (10) and Prompt Studio (20). */
export const MESSAGE_EDIT_VIEW_ORDER = 15

/** Downstream-history policy after a historical turn changes. */
export type CascadePolicy = 'truncate' | 'preserve'

/** User-visible operation represented by one child version. */
export type VersionOperation = 'edit' | 'reroll' | 'retry'

/** Editable model-surface block classification. */
export type EditableBlockKind = 'user' | 'assistant.reasoning' | 'assistant.response'

/** Current durable event schema for structurally paired version effects. */
export const MESSAGE_EDIT_VERSION_SCHEMA = 2

/** Forward half of one atomic version effect. */
export interface MessageEditEffect {
  id: string
  operation: VersionOperation
  cascade: CascadePolicy
  targetTurn: number
  targetEventSeq?: number
  targetBlockIndex?: number
  blockKind?: EditableBlockKind
  before?: string
  after?: string
  /** Every cached change atomically applied when this version was created. */
  changes?: readonly MessageEditEffectChange[]
}

/** One durable replacement or whole-message removal within an edit effect. */
export interface MessageEditEffectChange {
  eventSeq: number
  blockIndex: number
  blockKind: EditableBlockKind
  before: string
  after?: string
  deleted?: boolean
}

/** Inverse half generated together with a version effect. */
export interface MessageEditInverse {
  kind: 'restore-version'
  sessionId: string
}

/** Durable effect/inverse pair appended to each branch created by this plugin. */
export interface MessageEditVersionEvent {
  schemaVersion: typeof MESSAGE_EDIT_VERSION_SCHEMA
  effect: MessageEditEffect
  inverse: MessageEditInverse
}

/** Read compatibility for branches written before structural pairing. */
export interface LegacyMessageEditVersionEvent {
  sourceSessionId: string
  operation: VersionOperation
  cascade: CascadePolicy
  targetTurn: number
  targetEventSeq: number
  targetBlockIndex?: number
  blockKind?: EditableBlockKind
  before?: string
  after?: string
}

/** Every durable event shape accepted by the lineage reader. */
export type StoredMessageEditVersionEvent = MessageEditVersionEvent | LegacyMessageEditVersionEvent

/** One text-bearing block that the Timeline editor can replace. */
export interface EditableMessageBlock {
  key: string
  turn: number
  eventSeq: number
  blockIndex: number
  kind: EditableBlockKind
  text: string
  time: number
}

/** One completed message-triggered turn eligible for Retry. */
export interface RetryableTurn {
  turn: number
  userEventSeq?: number
  preview: string
  time: number
  retryable: boolean
}

/** One session version in the complete known lineage tree. */
export interface VersionSummary {
  sessionId: string
  parentSessionId?: string
  effectId?: string
  inverseSessionId?: string
  createdAt: number
  depth: number
  current: boolean
  onCurrentEffectPath: boolean
  operation?: VersionOperation
  cascade?: CascadePolicy
  targetTurn?: number
  blockKind?: EditableBlockKind
  before?: string
  after?: string
}

/** Complete value-level projection consumed by both Timeline and header controls. */
export interface MessageEditTimeline {
  sessionId: string
  messages: EditableMessageBlock[]
  retryableTurns: RetryableTurn[]
  versions: VersionSummary[]
  /** Atomic inverses from the current version outward, in application order. */
  undoStack: string[]
  /** Direct child effects that can be re-applied from the current version. */
  redoSessionIds: string[]
}

/** Edit one text/reasoning block and regenerate from its turn boundary. */
export type MessageEditChange = {
  action: 'replace'
  eventSeq: number
  blockIndex: number
  text: string
} | {
  /** Remove the entire message event, rather than blanking its text. */
  action: 'delete'
  eventSeq: number
}

/** Atomically apply every cached change within one settled turn. */
export interface EditOperation {
  action: 'edit'
  sessionId: string
  turn: number
  changes: MessageEditChange[]
  cascade: CascadePolicy
}

/** Regenerate the latest completed assistant reply. */
export interface RerollOperation {
  action: 'reroll'
  sessionId: string
}

/** Regenerate any selected historical turn. */
export interface RetryOperation {
  action: 'retry'
  sessionId: string
  turn: number
  cascade: CascadePolicy
}

/** Mutation accepted by the host route. */
export type MessageEditOperation = EditOperation | RerollOperation | RetryOperation

/** Host acknowledgement after the child Agent has been published and queued. */
export interface MessageEditOperationResult {
  sessionId: string
  queuedTurns: number
}
