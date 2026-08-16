/**
 * Message-row edit affordance: injects retry + edit icon buttons into each
 * settled message's icon-actions row (the official MessageIconActions has no
 * plugin slot, so injection rides a MutationObserver over action rows).
 * Icons are the official outline-16 SVGs inlined to avoid bundling the
 * primitives package.
 */
import { useEffect } from 'react'
import type { EditableMessageBlock } from '../shared.ts'
import type { MessageEditDrafts, MessageEditFace } from './controller.ts'
import styles from './InlineMessageEdit.module.css'

const BLOCK_TITLE: Record<EditableMessageBlock['kind'], string> = {
  user: '编辑用户消息',
  'assistant.reasoning': '编辑助手思考',
  'assistant.response': '编辑助手回复',
}

const STYLE = {
  overlay: styles['overlay'] ?? '',
  panel: styles['panel'] ?? '',
  title: styles['title'] ?? '',
  input: styles['input'] ?? '',
  footer: styles['footer'] ?? '',
  iconButton: styles['iconButton'] ?? '',
  picker: styles['picker'] ?? '',
  pickerItem: styles['pickerItem'] ?? '',
  pickerItemActive: styles['pickerItemActive'] ?? '',
  primaryButton: styles['primaryButton'] ?? '',
  dangerButton: styles['dangerButton'] ?? '',
}

/** Official ic_ds_refresh_outline_16 path (dsh-client-ui-primitives). */
const REFRESH_PATH = 'M7.92136 0.349152C10.3744 0.349234 12.5564 1.5052 13.9557 3.29894L15.1281 2.12759C15.3303 1.92546 15.6767 2.06943 15.6767 2.35538V5.53923C15.6766 5.71626 15.5329 5.85976 15.3559 5.86002H12.171C11.8854 5.8597 11.7426 5.51465 11.9443 5.31249L12.9641 4.29056C11.8237 2.74305 9.98908 1.74106 7.92136 1.74097C4.46436 1.74097 1.66233 4.543 1.66233 8C1.66233 11.457 4.46436 14.259 7.92136 14.259C11.3782 14.2589 14.1804 11.4569 14.1804 8H15.5722C15.5722 12.2251 12.1465 15.6507 7.92136 15.6508C3.69614 15.6508 0.270508 12.2252 0.270508 8C0.270508 3.77478 3.69614 0.349152 7.92136 0.349152Z'

/** Official ic_ds_edit_outline_16 path (dsh-client-ui-primitives). */
const EDIT_PATH = 'M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z'

function svgIcon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', path)
  p.setAttribute('fill', 'currentColor')
  svg.appendChild(p)
  return svg
}

function blockTitle(kind: EditableMessageBlock['kind']): string {
  return BLOCK_TITLE[kind] ?? '编辑消息'
}

type OverlayCleanup = () => void

/** Mount one editor DOM effect and return its exact inverse. */
function mountEditor(
  block: EditableMessageBlock,
  text: string,
  saveDraft: MessageEditFace['save'],
  deleteDraft: MessageEditFace['delete'],
  commit: MessageEditFace['commit'],
  close: () => void,
): OverlayCleanup {
  const overlay = document.createElement('div')
  overlay.className = STYLE.overlay
  const panel = document.createElement('div')
  panel.className = STYLE.panel
  const title = document.createElement('div')
  title.className = STYLE.title
  title.textContent = blockTitle(block.kind)
  const input = document.createElement('textarea')
  input.className = STYLE.input
  input.value = text
  const footer = document.createElement('div')
  footer.className = STYLE.footer
  const save = document.createElement('button')
  save.textContent = '保存'
  const apply = document.createElement('button')
  apply.className = STYLE.primaryButton
  apply.textContent = '保存并重新生成'
  const remove = document.createElement('button')
  remove.className = STYLE.dangerButton
  remove.textContent = '删除'
  const cancel = document.createElement('button')
  cancel.textContent = '取消'
  footer.append(save)
  footer.append(remove)
  footer.append(apply, cancel)
  panel.append(title, input, footer)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  let mounted = true
  let committing = false
  const saveEdit = (): void => {
    if (committing) return
    saveDraft(block, input.value)
    close()
  }
  const commitEdit = (): void => {
    if (committing) return
    committing = true
    save.disabled = true
    apply.disabled = true
    void commit(block, input.value, 'truncate').then((applied) => {
      if (!mounted) return
      if (applied) {
        close()
        return
      }
      committing = false
      save.disabled = false
      apply.disabled = false
    })
  }
  const deleteEdit = (): void => {
    if (committing) return
    deleteDraft(block)
    close()
  }
  const cancelEdit = (): void => { close() }
  const dismiss = (event: MouseEvent): void => { if (event.target === overlay) close() }
  save.addEventListener('click', saveEdit)
  remove.addEventListener('click', deleteEdit)
  apply.addEventListener('click', commitEdit)
  cancel.addEventListener('click', cancelEdit)
  overlay.addEventListener('click', dismiss)
  return () => {
    mounted = false
    save.removeEventListener('click', saveEdit)
    remove.removeEventListener('click', deleteEdit)
    apply.removeEventListener('click', commitEdit)
    cancel.removeEventListener('click', cancelEdit)
    overlay.removeEventListener('click', dismiss)
    overlay.remove()
  }
}

/** Mount one block-picker DOM effect and return its exact inverse. */
function mountPicker(
  blocks: readonly EditableMessageBlock[],
  select: (block: EditableMessageBlock) => void,
  close: () => void,
): OverlayCleanup {
  const overlay = document.createElement('div')
  overlay.className = STYLE.overlay
  const panel = document.createElement('div')
  panel.className = STYLE.panel
  const title = document.createElement('div')
  title.className = STYLE.title
  title.textContent = blocks.some(block => block.kind === 'user') ? '编辑消息' : '编辑助手消息'
  const picker = document.createElement('div')
  picker.className = STYLE.picker
  const itemListeners: Array<{ item: HTMLButtonElement; listener: () => void }> = []
  for (const block of blocks) {
    const item = document.createElement('button')
    item.className = STYLE.pickerItem
    item.textContent = `${blockTitle(block.kind)}：${block.text.slice(0, 24)}${block.text.length > 24 ? '…' : ''}`
    const listener = (): void => { select(block) }
    item.addEventListener('click', listener)
    itemListeners.push({ item, listener })
    picker.appendChild(item)
  }
  const cancel = document.createElement('button')
  cancel.textContent = '取消'
  cancel.className = STYLE.pickerItemActive
  const cancelPicker = (): void => { close() }
  cancel.addEventListener('click', cancelPicker)
  panel.append(title, picker, cancel)
  overlay.appendChild(panel)
  document.body.appendChild(overlay)
  return () => {
    for (const { item, listener } of itemListeners) item.removeEventListener('click', listener)
    cancel.removeEventListener('click', cancelPicker)
    overlay.remove()
  }
}

/** Compose every overlay with a single idempotent active inverse. */
function createOverlayHost(
  saveDraft: MessageEditFace['save'],
  deleteDraft: MessageEditFace['delete'],
  commit: MessageEditFace['commit'],
  drafts: MessageEditDrafts,
): {
  editBlock(block: EditableMessageBlock): void
  chooseBlock(blocks: readonly EditableMessageBlock[]): void
  dispose(): void
} {
  let active: OverlayCleanup | undefined
  const mount = (effect: (close: () => void) => OverlayCleanup): void => {
    active?.()
    let cleanup: OverlayCleanup = () => {}
    let mounted = true
    const close = (): void => {
      if (!mounted) return
      mounted = false
      cleanup()
      if (active === close) active = undefined
    }
    active = close
    try {
      cleanup = effect(close)
    } catch (error: unknown) {
      active = undefined
      mounted = false
      throw error
    }
  }
  const editBlock = (block: EditableMessageBlock): void => {
    mount(close => mountEditor(block, drafts.textByKey[block.key] ?? block.text, saveDraft, deleteDraft, commit, close))
  }
  const chooseBlock = (blocks: readonly EditableMessageBlock[]): void => {
    mount(close => mountPicker(blocks, (block) => {
      close()
      editBlock(block)
    }, close))
  }
  return {
    editBlock,
    chooseBlock,
    dispose: () => { active?.() },
  }
}

/** Inject retry + edit icon buttons into each message action row. */
export function InlineMessageEdit({
  messages,
  drafts,
  save,
  delete: deleteDraft,
  commit,
  retry,
}: {
  messages: readonly EditableMessageBlock[]
  drafts: MessageEditDrafts
  save: MessageEditFace['save']
  delete: MessageEditFace['delete']
  commit: MessageEditFace['commit']
  retry: MessageEditFace['retry']
}): null {
  useEffect(() => {
    const cleanups: Array<() => void> = []
    const overlays = createOverlayHost(save, deleteDraft, commit, drafts)
    let observer: MutationObserver | undefined

    const sync = (): void => {
      const actionRows = Array.from(document.querySelectorAll<HTMLElement>('[class*="actions"]'))
      const claimedEvents = new Set<number>()
      for (const row of actionRows) {
        const marker = row as HTMLElement & {
          __messageEditInjected?: boolean
          __messageEditEventSeq?: number
        }
        if (marker.__messageEditInjected === true) {
          if (marker.__messageEditEventSeq !== undefined) claimedEvents.add(marker.__messageEditEventSeq)
          continue
        }
        const text = (row.parentElement?.parentElement?.textContent ?? '').trim()
        if (text.length === 0) continue
        const matchingEvents = [...new Set(messages
          .filter(message => message.text.length > 0 && text.includes(message.text.slice(0, 24)))
          .map(message => message.eventSeq))]
        const eventSeq = matchingEvents.find(candidate => !claimedEvents.has(candidate))
        if (eventSeq === undefined) continue
        const blocks = messages.filter(message => message.eventSeq === eventSeq)
        if (blocks.length === 0) continue
        const previousMarker = marker.__messageEditInjected
        const previousEventSeq = marker.__messageEditEventSeq
        marker.__messageEditInjected = true
        marker.__messageEditEventSeq = eventSeq
        claimedEvents.add(eventSeq)

        const editButton = document.createElement('button')
        editButton.className = STYLE.iconButton
        editButton.setAttribute('aria-label', '编辑消息')
        editButton.title = '编辑消息'
        editButton.appendChild(svgIcon(EDIT_PATH))
        const editMessage = (): void => {
          if (blocks.length === 1 && blocks[0] !== undefined) overlays.editBlock(blocks[0])
          else overlays.chooseBlock(blocks)
        }
        editButton.addEventListener('click', editMessage)

        const retryButton = document.createElement('button')
        retryButton.className = STYLE.iconButton
        retryButton.setAttribute('aria-label', '重试此回合')
        retryButton.title = '重试此回合'
        retryButton.appendChild(svgIcon(REFRESH_PATH))
        const turn = blocks[0]?.turn
        const retryTurn = (): void => {
          if (turn !== undefined) void retry(turn, 'truncate')
        }
        retryButton.addEventListener('click', retryTurn)

        // Insert after the last official action button so injected icons
        // stay contiguous with copy/branch and the clock keeps its side.
        const officialButtons = Array.from(row.querySelectorAll('button'))
          .filter(button => button !== editButton && button !== retryButton)
        const lastOfficial = officialButtons.at(-1)
        if (lastOfficial !== undefined) {
          lastOfficial.insertAdjacentElement('afterend', retryButton)
          lastOfficial.insertAdjacentElement('afterend', editButton)
        } else {
          row.appendChild(editButton)
          row.appendChild(retryButton)
        }
        cleanups.push(() => {
          editButton.removeEventListener('click', editMessage)
          retryButton.removeEventListener('click', retryTurn)
          editButton.remove()
          retryButton.remove()
          if (previousMarker === undefined) delete marker.__messageEditInjected
          else marker.__messageEditInjected = previousMarker
          if (previousEventSeq === undefined) delete marker.__messageEditEventSeq
          else marker.__messageEditEventSeq = previousEventSeq
        })
      }
    }

    sync()
    observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })

    return () => {
      observer?.disconnect()
      overlays.dispose()
      for (const cleanup of cleanups.reverse()) cleanup()
    }
  }, [messages, drafts, save, deleteDraft, commit, retry])

  return null
}
