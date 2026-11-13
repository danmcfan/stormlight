// The thing you type in. Auto-growing textarea, image attach (picker, paste,
// drop) with upload progress chips, a model picker, and Send/Queue/Stop sized
// for a thumb. Shared by the compact sidebar panel and the full-screen chat.
import { For, Show, createSignal, onCleanup } from 'solid-js'
import { GemButton } from '../ui/GemButton'
import { ModelPicker } from './ModelPicker'
import type { Lead } from './useLead'
import './composer.css'

interface Attachment {
  localId: string
  file: File
  previewUrl: string
  name: string
  status: 'uploading' | 'done' | 'error'
  id?: string
  error?: string
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

async function uploadImage(file: File): Promise<{ id: string; url: string; name: string }> {
  const dataUrl = await readAsDataURL(file)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const res = await fetch('/api/lead/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: file.name, type: file.type, data: base64 }),
  })
  const j = await res.json()
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
  return j
}

function imageFiles(list: FileList | Iterable<File> | null | undefined): File[] {
  if (!list) return []
  return Array.from(list).filter((f) => f.type.startsWith('image/'))
}

/**
 * The composer. `onFillRequest` hands the parent a function it can call to
 * drop text into the box (the empty state's example prompts use it).
 */
export function Composer(props: {
  lead: Lead
  placeholder: string
  variant: 'panel' | 'chat'
  onFillRequest?: (fill: (text: string) => void) => void
  onSent?: () => void
}) {
  const [text, setText] = createSignal('')
  const [attachments, setAttachments] = createSignal<Attachment[]>([])
  const [dragOver, setDragOver] = createSignal(false)
  let fileInput: HTMLInputElement | undefined
  let textareaRef: HTMLTextAreaElement | undefined

  const lead = props.lead
  const running = () => !!lead.state()?.running
  const uploading = () => attachments().some((a) => a.status === 'uploading')
  const canSend = () => !!text().trim() && !lead.busy() && !uploading()

  props.onFillRequest?.((t) => {
    setText(t)
    textareaRef?.focus()
  })

  function addFiles(files: File[]) {
    for (const file of files) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const previewUrl = URL.createObjectURL(file)
      const att: Attachment = { localId, file, previewUrl, name: file.name, status: 'uploading' }
      setAttachments((list) => [...list, att])
      uploadImage(file)
        .then((saved) => {
          setAttachments((list) =>
            list.map((a) => (a.localId === localId ? { ...a, status: 'done', id: saved.id } : a)),
          )
        })
        .catch((e: Error) => {
          setAttachments((list) =>
            list.map((a) => (a.localId === localId ? { ...a, status: 'error', error: e.message } : a)),
          )
        })
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((list) => {
      const found = list.find((a) => a.localId === localId)
      if (found) URL.revokeObjectURL(found.previewUrl)
      return list.filter((a) => a.localId !== localId)
    })
  }

  onCleanup(() => {
    for (const a of attachments()) URL.revokeObjectURL(a.previewUrl)
  })

  async function send() {
    const p = text().trim()
    if (!p || lead.busy() || uploading()) return
    const imageIds = attachments()
      .filter((a) => a.status === 'done' && a.id)
      .map((a) => a.id!)
    const ok = await lead.act({ action: 'send', prompt: p, imageIds: imageIds.length ? imageIds : undefined })
    if (ok) {
      setText('')
      for (const a of attachments()) URL.revokeObjectURL(a.previewUrl)
      setAttachments([])
      props.onSent?.()
    }
  }

  return (
    <form
      class={['composer', `composer-${props.variant}`, { 'composer-drag': dragOver() }]}
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        addFiles(imageFiles(e.dataTransfer?.files))
      }}
    >
      <Show when={attachments().length > 0}>
        <ul class="composer-tray" aria-label="Attached images">
          <For each={attachments()}>
            {(a) => (
              <li class="composer-chip" data-status={a.status}>
                <img src={a.previewUrl} alt="" class="composer-chip-thumb" />
                <Show when={a.status === 'uploading'}>
                  <span class="composer-chip-spinner" aria-hidden="true" />
                </Show>
                <Show when={a.status === 'error'}>
                  <span class="composer-chip-error" title={a.error}>
                    Failed
                  </span>
                </Show>
                <button
                  type="button"
                  class="composer-chip-remove"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => removeAttachment(a.localId)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <textarea
        ref={textareaRef}
        class="composer-input"
        rows={props.variant === 'chat' ? 2 : 3}
        placeholder={props.placeholder}
        enterkeyhint="send"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter for a new line (hardware keyboard only).
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault()
            send()
          }
        }}
        onPaste={(e) => {
          const files = imageFiles(
            e.clipboardData ? Array.from(e.clipboardData.items).flatMap((i) => (i.kind === 'file' ? [i.getAsFile()].filter((f): f is File => !!f) : [])) : [],
          )
          if (files.length) addFiles(files)
        }}
        aria-label="Prompt for the lead agent"
      />

      <div class="composer-row">
        <div class="composer-row-left">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            class="composer-file-input"
            aria-hidden="true"
            tabindex="-1"
            onChange={(e) => {
              addFiles(imageFiles(e.currentTarget.files))
              e.currentTarget.value = ''
            }}
          />
          <GemButton class="icon" aria-label="Attach images" onClick={() => fileInput?.click()}>
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </GemButton>
          <ModelPicker lead={lead} />
        </div>
        <div class="composer-row-right">
          <GemButton class="primary" disabled={!canSend()} onClick={send}>
            <Show when={lead.busy()}>
              <span class="composer-busy" aria-hidden="true" />
            </Show>
            {running() ? 'Queue' : 'Send'}
          </GemButton>
          <Show when={running() || (lead.state()?.waiting.length ?? 0) > 0}>
            <GemButton disabled={lead.busy()} onClick={() => lead.act({ action: 'stop' })}>
              Stop
            </GemButton>
          </Show>
          <Show when={lead.state()?.sessionId && !running()}>
            <GemButton disabled={lead.busy()} onClick={() => lead.act({ action: 'reset' })}>
              New chat
            </GemButton>
          </Show>
        </div>
      </div>

      <Show when={lead.error()}>
        <p class="composer-error" role="alert">
          {lead.error()}
        </p>
      </Show>
    </form>
  )
}
