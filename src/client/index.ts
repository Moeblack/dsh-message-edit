/** Message Edit browser half: Timeline view and compact conversation-header controls. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ISessions,
  SessionEventWindow,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { MESSAGE_EDIT_PATH, MESSAGE_EDIT_VIEW_ORDER } from '../shared.ts'
import { AssistantMessageEdit, type AssistantEditFace, type AssistantEditResult } from './AssistantMessageEdit.tsx'
import { MessageEditController } from './controller.ts'
import { MessageEditHeader } from './MessageEditHeader.tsx'
import { MessageEditTimelineView } from './MessageEditTimelineView.tsx'

/** Explicit value sources and slot declaration-order edges. */
export const inject = ['slots', 'sessions']

/** Locate one finalized assistant message event inside the loaded event window. */
function assistantEventIn(
  window: SessionEventWindow,
  messageId: string,
): { text: string } | undefined {
  for (const entry of window.entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type !== 'assistant/message') continue
    if (event.data.message.id !== messageId) continue
    const text = event.data.message.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (text.length === 0) return undefined
    return { text }
  }
  return undefined
}

function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null) as Promise<unknown>
}

function errorText(value: unknown): string {
  const record = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
  if (typeof record['error'] === 'string') return record['error']
  return '操作失败，请稍后重试。'
}

/** Resolve once the Session list publishes the child id, then select it. */
function openWhenListed(sessions: ISessions, sessionId: SessionId): Promise<void> {
  if (sessions.list.getSnapshot().byId[sessionId] !== undefined) {
    sessions.open(sessionId)
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let settled = false
    let dispose = (): void => {}
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      dispose()
      if (open) sessions.open(sessionId)
      resolve()
    }
    dispose = sessions.list.subscribe(() => {
      if (sessions.list.getSnapshot().byId[sessionId] === undefined) return
      finish(true)
    })
    if (sessions.list.getSnapshot().byId[sessionId] !== undefined) finish(true)
  })
}

/** Per-session verbs backing every assistant bubble-edit entry. */
function assistantEditFace(sessions: ISessions, sessionId: SessionId): AssistantEditFace {
  return {
    async loadText(messageId: string): Promise<AssistantEditResult> {
      const binding = sessions.binding(sessionId)
      const window = binding?.eventSource.getSnapshot()
      if (window === undefined) {
        return { ok: false, error: '会话尚未就绪，请稍后重试。' }
      }
      const found = assistantEventIn(window, messageId)
      if (found === undefined) {
        return { ok: false, error: '未找到该消息的完整原文（可能需要先加载更早的历史）。' }
      }
      return { ok: true, text: found.text }
    },
    async submit(messageId: string, text: string, cascade: 'truncate' | 'preserve'): Promise<AssistantEditResult> {
      try {
        const response = await fetch(MESSAGE_EDIT_PATH, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'editMessage',
            sessionId,
            messageId,
            text,
            cascade,
          }),
        })
        const value = await responseJson(response)
        if (!response.ok) return { ok: false, error: errorText(value) }
        const record = typeof value === 'object' && value !== null
          ? value as Record<string, unknown>
          : {}
        const childId = record['sessionId']
        if (typeof childId !== 'string' || childId.length === 0) {
          return { ok: false, error: '宿主未返回新版本会话。' }
        }
        await openWhenListed(sessions, childId as SessionId)
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : '网络错误，操作未完成。',
        }
      }
    },
  }
}

/** Register both UI contributions over one per-session controller identity. */
export function apply(ctx: Context): void {
  const sessions = ctx.get('sessions') as unknown as ISessions
  const controllers = new Map<SessionId, MessageEditController>()
  const controllerFor = (sessionId: SessionId): MessageEditController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new MessageEditController(ctx, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }
  const editFaces = new Map<SessionId, AssistantEditFace>()
  const faceFor = (sessionId: SessionId): AssistantEditFace => {
    let face = editFaces.get(sessionId)
    if (face === undefined) {
      face = assistantEditFace(sessions, sessionId)
      editFaces.set(sessionId, face)
    }
    return face
  }

  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.refreshIfLoaded()
  })

  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'message-edit-assistant',
    order: 20,
    inject: (sessionId: SessionId) => faceFor(sessionId),
  }, AssistantMessageEdit))

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'message-edit-timeline',
    order: MESSAGE_EDIT_VIEW_ORDER,
    label: 'Timeline',
    inject: (sessionId: SessionId) => controllerFor(sessionId).face,
  }, MessageEditTimelineView))

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'message-edit-controls',
    order: MESSAGE_EDIT_VIEW_ORDER,
    inject: (sessionId: SessionId) => controllerFor(sessionId).face,
  }, MessageEditHeader))
}
