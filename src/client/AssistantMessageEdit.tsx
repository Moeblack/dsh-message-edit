/**
 * Per-message bubble edit entry for finalized assistant messages: contributes
 * one action to the `conversation.chat.assistant-actions` strip. Clicking it
 * opens a portaled textarea seeded with the message's current response text;
 * saving rewrites the whole response (reasoning preserved) by forking a new
 * session version through the host `/message-edit` endpoint.
 */
import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { IconEditOutline16, Tooltip, useAnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './AssistantMessageEdit.module.css'

const PANEL_MARGIN = 12
const PANEL_GAP = 4
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** One bubble-edit outcome surfaced in the action row. */
export type AssistantEditResult =
  | { ok: true; text?: string }
  | { ok: false; error: string }

/** Per-session verbs injected into every bubble-edit entry. */
export interface AssistantEditFace {
  /** Resolve the current response text of one assistant message. */
  loadText(messageId: string): Promise<AssistantEditResult>
  /** Rewrite the full response text of one assistant message into a new session version. */
  submit(messageId: string, text: string, cascade: 'truncate' | 'preserve'): Promise<AssistantEditResult>
}

type AssistantMessageEditProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<AssistantEditFace>

/** Edit affordance mounted once per finalized assistant message. */
export function AssistantMessageEdit({
  messageId, loadText, submit,
}: AssistantMessageEditProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [draft, setDraft] = useState('')
  const [cascade, setCascade] = useState<'truncate' | 'preserve'>('truncate')
  const [failure, setFailure] = useState<string | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const openEditor = useCallback(() => {
    setOpen(true)
    setLoading(true)
    setFailure(null)
    setCascade('truncate')
    void loadText(messageId).then((result) => {
      if (!alive.current) return
      setLoading(false)
      if (result.ok) {
        setDraft(result.text ?? '')
        return
      }
      setFailure(result.error)
    })
  }, [loadText, messageId])

  const closeEditor = useCallback(() => {
    setOpen(false)
    setPending(false)
    setFailure(null)
  }, [])

  const save = useCallback(() => {
    if (pending || loading) return
    setPending(true)
    setFailure(null)
    void submit(messageId, draft, cascade).then((result) => {
      if (!alive.current) return
      setPending(false)
      if (result.ok) {
        setOpen(false)
        return
      }
      setFailure(result.error)
    })
  }, [cascade, draft, loading, messageId, pending, submit])

  const pos = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      if (triggerRef.current?.contains(e.target) === true) return
      if (panelRef.current?.contains(e.target) === true) return
      closeEditor()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditor()
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, closeEditor, save])

  return (
    <>
      <Tooltip label="编辑此回复" side="bottom">
        <button
          ref={triggerRef}
          type="button"
          className={styles['action']}
          aria-label="编辑此回复"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openEditor}
        >
          <IconEditOutline16 size={16} />
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className={styles['panel']}
          role="dialog"
          aria-label="编辑助手回复"
          style={pos ?? MEASURE_STYLE}
        >
          <div className={styles['panelTitle']}>编辑助手回复</div>
          {loading
            ? <div className={styles['hint']}>正在读取原文…</div>
            : (
              <>
                <textarea
                  ref={inputRef}
                  className={styles['input']}
                  aria-label="回复文本"
                  value={draft}
                  rows={6}
                  spellCheck={false}
                  onChange={(event) => { setDraft(event.target.value) }}
                />
                <div className={styles['policy']} role="group" aria-label="后续策略">
                  <button
                    type="button"
                    className={cascade === 'truncate' ? styles['policyActive'] : styles['policyIdle']}
                    disabled={pending}
                    onClick={() => { setCascade('truncate') }}
                  >
                    截断后续
                  </button>
                  <button
                    type="button"
                    className={cascade === 'preserve' ? styles['policyActive'] : styles['policyIdle']}
                    disabled={pending}
                    onClick={() => { setCascade('preserve') }}
                  >
                    保留输入并重放后续
                  </button>
                </div>
                <div className={styles['hint']}>
                  保存后将保留思考链，从该回合边界重放为新版本会话，原版本可随时切回。
                </div>
                <div className={styles['actions']}>
                  <button
                    type="button"
                    className={styles['save']}
                    disabled={pending || draft.trim().length === 0}
                    onClick={save}
                  >
                    {pending ? '保存中…' : '保存并重放'}
                  </button>
                  <button type="button" className={styles['cancel']} disabled={pending} onClick={closeEditor}>
                    取消
                  </button>
                </div>
              </>
            )}
          {failure !== null && <div className={styles['failure']} role="status">{failure}</div>}
        </div>,
        document.body,
      )}
    </>
  )
}
