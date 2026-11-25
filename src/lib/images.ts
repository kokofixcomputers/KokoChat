import type { Attachment } from '../types'
import { uid } from './utils'

/** Reads an image file and downsizes it so persisted chats stay small. */
export async function fileToAttachment(file: File, max = 1568): Promise<Attachment> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return { id: uid(), name: file.name, mime: file.type, dataUrl: src }
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src
  })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  if (scale === 1 && file.size < 1_500_000) return { id: uid(), name: file.name, mime: file.type, dataUrl: src }
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return { id: uid(), name: file.name, mime, dataUrl: c.toDataURL(mime, 0.88) }
}

const TEXT_EXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|yaml|yml|toml|ini|log|html?|css|scss|js|jsx|ts|tsx|mjs|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|sql|r|lua|tex|env|conf|diff|patch)$/i
export const isTextFile = (f: File) => f.type.startsWith('text/') || TEXT_EXT.test(f.name) || f.type === 'application/json'
export const isImageFile = (f: File) => f.type.startsWith('image/')

export async function textToAttachment(file: File, max = 300_000): Promise<Attachment> {
  let text = await file.text()
  if (text.length > max) text = text.slice(0, max) + '\n…[file truncated]'
  return { id: uid(), name: file.name, mime: file.type || 'text/plain', dataUrl: '', kind: 'text', text }
}

export async function filesToAttachments(list: FileList | File[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (const f of [...list]) {
    if (isImageFile(f)) out.push(await fileToAttachment(f))
    else if (isTextFile(f)) out.push(await textToAttachment(f))
  }
  return out
}

/** Text of a user message with attached text files and quoted passages inlined for the model. */
export function userTextForModel(text: string | undefined, atts?: Attachment[], quotes?: string[]) {
  const files = (atts ?? []).filter((a) => a.kind === 'text').map((a) => (a.kbId ? `<uploaded_file name="${a.name}">Indexed for search. Use kb_search or kb_read to read it.</uploaded_file>` : `<file name="${a.name}">\n${a.text}\n</file>`))
  const q = (quotes ?? []).map((x) => `<quoted_text>\n${x}\n</quoted_text>`)
  const hint = q.length ? 'The user is quoting these passages from earlier in the conversation:' : ''
  return [...files, hint, ...q, text ?? ''].filter(Boolean).join('\n\n')
}

/** Re-encode a data-URL image as WebP (optionally downscaled). Returns the original if that would not be smaller. */
export async function recompressImage(dataUrl: string, opts: { maxSide?: number; quality?: number } = {}): Promise<string> {
  if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg')) return dataUrl
  const { maxSide = 2048, quality = 0.9 } = opts
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl })
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const out = c.toDataURL('image/webp', quality)
    return out.startsWith('data:image/webp') && out.length < dataUrl.length ? out : dataUrl
  } catch { return dataUrl }
}

/** Shrink every large image inside a chat (generated images, pasted screenshots) so it fits the sync quota. */
export async function shrinkChatImages<T extends { messages: any[] }>(chat: T): Promise<T> {
  let changed = false
  const messages = await Promise.all(
    chat.messages.map(async (m) => {
      let arts = m.artifacts
      let atts = m.attachments
      if (m.artifacts?.some((a: any) => a.kind === 'image' && a.content.length > 150_000)) {
        arts = await Promise.all(m.artifacts.map(async (a: any) => {
          if (a.kind !== 'image' || a.content.length <= 150_000) return a
          const content = await recompressImage(a.content, { maxSide: 1600, quality: 0.78 })
          return content === a.content ? a : { ...a, content }
        }))
      }
      if (m.attachments?.some((a: any) => a.kind !== 'text' && a.dataUrl.length > 150_000)) {
        atts = await Promise.all(m.attachments.map(async (a: any) => {
          if (a.kind === 'text' || a.dataUrl.length <= 150_000) return a
          const dataUrl = await recompressImage(a.dataUrl, { maxSide: 1400, quality: 0.78 })
          return dataUrl === a.dataUrl ? a : { ...a, dataUrl, mime: dataUrl.startsWith('data:image/webp') ? 'image/webp' : a.mime }
        }))
      }
      if (arts !== m.artifacts || atts !== m.attachments) { changed = true; return { ...m, artifacts: arts, attachments: atts } }
      return m
    }),
  )
  return changed ? { ...chat, messages } : chat
}
