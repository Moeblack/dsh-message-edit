import { useEffect, type ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageEditFace } from './controller.ts'
import { InlineMessageEdit } from './InlineMessageEdit.tsx'
import styles from './MessageEditHeader.module.css'

type MessageEditHeaderProps = PropsRuntime<'conversation.session.header.actions'> & InjectFace<MessageEditFace>

/** Header contribution shared with the Timeline controller. */
export function MessageEditHeader({
  useMessageEdit,
  load,
  openVersion,
  reroll,
  save,
  delete: deleteDraft,
  commit,
  retry,
}: MessageEditHeaderProps): ReactNode {
  const state = useMessageEdit(value => value)

  useEffect(() => { load() }, [load])

  const timeline = state.timeline
  const versions = state.timeline?.versions ?? []
  const undoSessionId = timeline?.undoStack[0]
  const redoSessionId = timeline?.redoSessionIds.at(-1)
  const effectDepth = timeline?.undoStack.length ?? 0
  const busy = state.pending !== null || state.status !== 'ready'

  return (
    <>
      <InlineMessageEdit
        messages={state.status === 'ready' && state.pending === null ? timeline?.messages ?? [] : []}
        drafts={state.drafts}
        save={save}
        delete={deleteDraft}
        commit={commit}
        retry={retry}
      />
      <div className={styles['root']}>
        <button
          type="button"
          className={styles['iconButton']}
          aria-label="撤销当前版本效果"
          title="撤销当前效果，保留更早效果"
          disabled={undoSessionId === undefined || busy}
          onClick={() => { if (undoSessionId !== undefined) void openVersion(undoSessionId) }}
        >
          ←
        </button>
        <span className={styles['counter']}>
          {versions.length === 0 ? '效果 —' : `效果 ${String(effectDepth)} 层 · ${String(versions.length)} 版`}
        </span>
        <button
          type="button"
          className={styles['iconButton']}
          aria-label="重施加下一版本效果"
          title={timeline !== null && timeline.redoSessionIds.length > 1
            ? `重施加最新效果（另有 ${String(timeline.redoSessionIds.length - 1)} 个分支）`
            : '重施加下一效果'}
          disabled={redoSessionId === undefined || busy}
          onClick={() => { if (redoSessionId !== undefined) void openVersion(redoSessionId) }}
        >
          →
        </button>
        <button
          type="button"
          className={styles['rerollButton']}
          disabled={busy || state.timeline === null}
          onClick={() => { void reroll() }}
        >
          {state.pending === 'reroll' ? '正在重生成…' : '重生成'}
        </button>
      </div>
    </>
  )
}
