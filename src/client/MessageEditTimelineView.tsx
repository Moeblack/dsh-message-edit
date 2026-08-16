/** Timeline tab: durable version tree plus turn/block edit and retry controls. */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CascadePolicy,
  EditableBlockKind,
  EditableMessageBlock,
  RetryableTurn,
  VersionOperation,
  VersionSummary,
} from '../shared.ts'
import type { MessageEditFace } from './controller.ts'
import styles from './MessageEditTimelineView.module.css'

type MessageEditTimelineViewProps = ConvViewProps & InjectFace<MessageEditFace>

interface TurnSection {
  retry: RetryableTurn
  messages: EditableMessageBlock[]
}

interface EditingState {
  message: EditableMessageBlock
  text: string
}

const BLOCK_LABEL: Record<EditableBlockKind, string> = {
  user: '用户消息',
  'assistant.reasoning': '助手思考',
  'assistant.response': '助手回复',
}

const OPERATION_LABEL: Record<VersionOperation, string> = {
  edit: '编辑',
  reroll: '重生成',
  retry: '重试',
}

function timeLabel(value: number): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function turnSections(
  turns: readonly RetryableTurn[],
  messages: readonly EditableMessageBlock[],
): TurnSection[] {
  return turns.map(retry => ({
    retry,
    messages: messages.filter(message => message.turn === retry.turn),
  }))
}

function draftedText(message: EditableMessageBlock, textByKey: Record<string, string>): string {
  return textByKey[message.key] ?? message.text
}

function isDraftDeleted(message: EditableMessageBlock, deletedEventSeqs: readonly number[]): boolean {
  return deletedEventSeqs.includes(message.eventSeq)
}

function turnDraftCount(
  messages: readonly EditableMessageBlock[],
  textByKey: Record<string, string>,
  deletedEventSeqs: readonly number[],
): number {
  const deleted = new Set(deletedEventSeqs)
  const deletedCount = new Set(messages
    .filter(message => deleted.has(message.eventSeq))
    .map(message => message.eventSeq)).size
  const replacementCount = messages.filter(message => (
    !deleted.has(message.eventSeq) && draftedText(message, textByKey) !== message.text
  )).length
  return deletedCount + replacementCount
}

function VersionRow({ version, disabled, onOpen }: {
  version: VersionSummary
  disabled: boolean
  onOpen: (sessionId: string) => void
}): ReactNode {
  const depthStyle = { '--message-edit-depth': String(version.depth) } as CSSProperties
  const operation = version.operation === undefined
    ? version.parentSessionId === undefined ? '原始版本' : '外部分支'
    : OPERATION_LABEL[version.operation]
  return (
    <li className={styles['versionItem']} style={depthStyle}>
      <button
        type="button"
        className={styles['versionButton']}
        data-current={version.current || undefined}
        disabled={version.current || disabled}
        onClick={() => { onOpen(version.sessionId) }}
      >
        <span className={styles['versionLine']} aria-hidden />
        <span className={styles['versionDot']} aria-hidden />
        <span className={styles['versionMain']}>
          <span className={styles['versionTitle']}>
            {operation}
            {version.targetTurn === undefined ? null : ` · 回合 ${String(version.targetTurn)}`}
          </span>
          <span className={styles['versionMeta']}>
            {timeLabel(version.createdAt)} · {version.sessionId.slice(0, 12)}
          </span>
          {version.before === undefined && version.after === undefined
            ? null
            : (
              <span className={styles['versionDiff']}>
                <span>原：{version.before || '（空）'}</span>
                <span>新：{version.after || '（空）'}</span>
              </span>
            )}
        </span>
        {version.current
          ? <span className={styles['currentBadge']}>当前</span>
          : version.onCurrentEffectPath
            ? <span className={styles['pathBadge']}>链上</span>
            : null}
      </button>
    </li>
  )
}

function MessageCard({
  message,
  editing,
  textByKey,
  deletedEventSeqs,
  disabled,
  cascade,
  onBeginEdit,
  onCancelEdit,
  onTextChange,
  onSave,
  onCommit,
  onDelete,
  onRestore,
}: {
  message: EditableMessageBlock
  editing: EditingState | null
  textByKey: Record<string, string>
  deletedEventSeqs: readonly number[]
  disabled: boolean
  cascade: CascadePolicy
  onBeginEdit: (message: EditableMessageBlock) => void
  onCancelEdit: () => void
  onTextChange: (text: string) => void
  onSave: (message: EditableMessageBlock, text: string) => void
  onCommit: (message: EditableMessageBlock, text: string, cascade: CascadePolicy) => Promise<boolean>
  onDelete: (message: EditableMessageBlock) => void
  onRestore: (message: EditableMessageBlock) => void
}): ReactNode {
  const active = editing?.message.key === message.key
  const deleted = isDraftDeleted(message, deletedEventSeqs)
  const text = draftedText(message, textByKey)
  const hasDraft = deleted || text !== message.text
  return (
    <article className={styles['messageCard']} data-draft={hasDraft || undefined} data-deleted={deleted || undefined}>
      <div className={styles['messageHeader']}>
        <span className={styles['kindBadge']} data-kind={message.kind}>{BLOCK_LABEL[message.kind]}</span>
        <span className={styles['messageTime']}>{timeLabel(message.time)}</span>
        {hasDraft ? <span className={styles['draftBadge']}>草稿</span> : null}
        {deleted
          ? (
            <button
              type="button"
              className={styles['textButton']}
              disabled={disabled}
              onClick={() => { onRestore(message) }}
            >
              撤销删除
            </button>
          )
          : (
            <>
              <button
                type="button"
                className={styles['textButton']}
                disabled={disabled}
                onClick={() => { active ? onCancelEdit() : onBeginEdit(message) }}
              >
                {active ? '取消' : '编辑'}
              </button>
            </>
          )}
      </div>
      {deleted
        ? <p className={styles['deletedNotice']}>已保存到草稿；保存并重新生成后，这条消息将不存在于新分支中。</p>
        : active && editing !== null
        ? (
          <div className={styles['editor']}>
            <textarea
              className={styles['textarea']}
              value={editing.text}
              rows={6}
              autoFocus
              onChange={(event) => { onTextChange(event.currentTarget.value) }}
            />
            <div className={styles['editorActions']}>
              <span className={styles['editorHint']}>保存只写入草稿；保存并重新生成才会创建分支。</span>
              <div className={styles['editorButtons']}>
                <button
                  type="button"
                  className={styles['secondaryButton']}
                  disabled={disabled}
                  onClick={() => { onSave(message, editing.text) }}
                >
                  保存
                </button>
                <button
                  type="button"
                  className={styles['dangerButton']}
                  disabled={disabled}
                  onClick={() => { onDelete(message) }}
                >
                  删除
                </button>
                <button
                  type="button"
                  className={styles['primaryButton']}
                  disabled={disabled}
                  onClick={() => { void onCommit(message, editing.text, cascade) }}
                >
                  保存并重新生成
                </button>
              </div>
            </div>
          </div>
        )
        : <pre className={styles['messageText']}>{text || '（空内容）'}</pre>}
    </article>
  )
}

/** Conversation-view entry point. */
export function MessageEditTimelineView({
  useMessageEdit,
  load,
  save,
  delete: deleteDraft,
  restore,
  commit,
  commitTurn,
  retry,
  reroll,
  openVersion,
}: MessageEditTimelineViewProps): ReactNode {
  const state = useMessageEdit(value => value)
  const [cascade, setCascade] = useState<CascadePolicy>('truncate')
  const [editing, setEditing] = useState<EditingState | null>(null)

  useEffect(() => { load() }, [load])

  const timeline = state.timeline
  const sections = useMemo(
    () => timeline === null ? [] : turnSections(timeline.retryableTurns, timeline.messages),
    [timeline],
  )
  const busy = state.pending !== null || state.status !== 'ready'

  useEffect(() => {
    setEditing((current) => {
      if (current === null || timeline === null) return current
      return timeline.messages.some(message => message.key === current.message.key) ? current : null
    })
  }, [timeline])

  if (timeline === null && (state.status === 'idle' || state.status === 'loading')) {
    return <div className={styles['status']}>正在载入消息时间线…</div>
  }
  if (timeline === null && state.status === 'error') {
    return (
      <div className={styles['status']}>
        <p className={styles['error']}>{state.error}</p>
        <button type="button" className={styles['secondaryButton']} onClick={load}>重新载入</button>
      </div>
    )
  }
  if (timeline === null) return null

  const saveEdit = (message: EditableMessageBlock, text: string): void => {
    save(message, text)
    setEditing(null)
  }

  const commitEdit = async (message: EditableMessageBlock, text: string, policy: CascadePolicy): Promise<boolean> => {
    const applied = await commit(message, text, policy)
    if (applied) setEditing(null)
    return applied
  }

  const deleteEdit = (message: EditableMessageBlock): void => {
    deleteDraft(message)
    setEditing(current => current?.message.eventSeq === message.eventSeq ? null : current)
  }

  return (
    <div className={styles['root']}>
      <header className={styles['pageHeader']}>
        <div>
          <h1 className={styles['title']}>消息编辑与重生成</h1>
          <p className={styles['intro']}>每次修改都会与其恢复版本成对记录；回合及其完整工具链作为一个整体重新计算。</p>
        </div>
        <div className={styles['headerActions']}>
          <label className={styles['cascadeField']}>
            <span>后续策略</span>
            <select
              className={styles['select']}
              value={cascade}
              disabled={busy}
              onChange={(event) => { setCascade(event.currentTarget.value as CascadePolicy) }}
            >
              <option value="truncate">截断后续（默认）</option>
              <option value="preserve">保留输入并重生成后续</option>
            </select>
          </label>
          <button
            type="button"
            className={styles['primaryButton']}
            disabled={busy}
            onClick={() => { void reroll() }}
          >
            {state.pending === 'reroll' ? '正在重生成…' : '重生成最后回复'}
          </button>
        </div>
      </header>

      {state.error === null ? null : <p className={styles['error']}>{state.error}</p>}
      {state.status === 'loading' ? <p className={styles['notice']}>正在刷新时间线…</p> : null}

      <div className={styles['columns']}>
        <aside className={styles['versionsPanel']} aria-label="版本时间线">
          <div className={styles['sectionHeading']}>
            <h2 className={styles['subtitle']}>版本时间线</h2>
            <span className={styles['count']}>{String(timeline.versions.length)}</span>
          </div>
          <div className={styles['effectControls']}>
            <span className={styles['effectDepth']}>当前效果链 {String(timeline.undoStack.length)} 层</span>
            <div className={styles['effectButtons']}>
              <button
                type="button"
                className={styles['secondaryButton']}
                disabled={busy || timeline.undoStack[0] === undefined}
                onClick={() => {
                  const target = timeline.undoStack[0]
                  if (target !== undefined) void openVersion(target)
                }}
              >
                撤销当前效果
              </button>
              <button
                type="button"
                className={styles['secondaryButton']}
                disabled={busy || timeline.redoSessionIds.length === 0}
                onClick={() => {
                  const target = timeline.redoSessionIds.at(-1)
                  if (target !== undefined) void openVersion(target)
                }}
              >
                {timeline.redoSessionIds.length > 1
                  ? `重施加最新分支（${String(timeline.redoSessionIds.length)}）`
                  : '重施加下一效果'}
              </button>
            </div>
          </div>
          <ol className={styles['versionList']}>
            {timeline.versions.map(version => (
              <VersionRow
                key={version.sessionId}
                version={version}
                disabled={busy}
                onOpen={(sessionId) => { void openVersion(sessionId) }}
              />
            ))}
          </ol>
        </aside>

        <main className={styles['turnsPanel']}>
          <div className={styles['sectionHeading']}>
            <h2 className={styles['subtitle']}>已落定消息</h2>
            <span className={styles['count']}>{String(timeline.messages.length)}</span>
          </div>
          {sections.length === 0
            ? <p className={styles['empty']}>当前会话还没有可编辑的已落定回合。</p>
            : (
              <ol className={styles['turnList']}>
                {sections.map(section => (
                  <li key={section.retry.turn} className={styles['turnSection']}>
                    <div className={styles['turnHeader']}>
                      <div>
                        <h3 className={styles['turnTitle']}>回合 {String(section.retry.turn)}</h3>
                        <p className={styles['turnPreview']}>{section.retry.preview || '（空用户输入）'}</p>
                      </div>
                      <div className={styles['turnActions']}>
                        {section.retry.retryable
                          ? (
                            <button
                              type="button"
                              className={styles['secondaryButton']}
                              disabled={busy}
                              onClick={() => { void retry(section.retry.turn, cascade) }}
                            >
                              {state.pending === 'retry' ? '正在重试…' : '重试此回合'}
                            </button>
                          )
                          : null}
                        <button
                          type="button"
                          className={styles['primaryButton']}
                          disabled={busy || turnDraftCount(section.messages, state.drafts.textByKey, state.drafts.deletedEventSeqs) === 0}
                          onClick={() => { void commitTurn(section.retry.turn, cascade) }}
                        >
                          {state.pending === 'edit'
                            ? '正在保存并重新生成…'
                            : `保存并重新生成 (${String(turnDraftCount(section.messages, state.drafts.textByKey, state.drafts.deletedEventSeqs))})`}
                        </button>
                      </div>
                    </div>
                    <div className={styles['messageList']}>
                      {section.messages.map(message => (
                        <MessageCard
                          key={message.key}
                          message={message}
                          editing={editing}
                          textByKey={state.drafts.textByKey}
                          deletedEventSeqs={state.drafts.deletedEventSeqs}
                          disabled={busy}
                          cascade={cascade}
                          onBeginEdit={value => {
                            setEditing({ message: value, text: draftedText(value, state.drafts.textByKey) })
                          }}
                          onCancelEdit={() => { setEditing(null) }}
                          onTextChange={(text) => {
                            setEditing(current => current === null ? null : { ...current, text })
                          }}
                          onSave={saveEdit}
                          onCommit={commitEdit}
                          onDelete={deleteEdit}
                          onRestore={restore}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            )}
        </main>
      </div>
    </div>
  )
}
