/** Message Edit browser half: Timeline view and compact conversation-header controls. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MESSAGE_EDIT_VIEW_ORDER } from '../shared.ts'
import { MessageEditController } from './controller.ts'
import { MessageEditHeader } from './MessageEditHeader.tsx'
import { MessageEditTimelineView } from './MessageEditTimelineView.tsx'

/** Required services: slot declaration, Session Retain access, and navigation. */
export const inject = ['slots', 'sessions', 'uiWorkspace']

/** Register both UI contributions over one per-session controller identity. */
export function apply(ctx: ClientContext): void {
  const controllers = new Map<SessionId, MessageEditController>()
  const controllerFor = (sessionId: SessionId): MessageEditController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new MessageEditController(ctx, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.shutdown()
    controllers.clear()
  }, 'message-edit: per-session controllers')

  ctx.on('connection/reset', () => {
    for (const controller of controllers.values()) controller.refreshIfLoaded()
  })

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
