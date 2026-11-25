import type { Chat } from '../types'
import { download } from './utils'

export function chatToMarkdown(c: Chat) {
  const out = [`# ${c.title}`, `_Exported ${new Date().toLocaleString()}_`]
  for (const m of c.messages) {
    if (m.role === 'user') {
      out.push(`## You\n\n${[...(m.quotes ?? []).map((q) => q.split('\n').map((l) => `> ${l}`).join('\n')), ...(m.attachments ?? []).map((a) => `*(attachment: ${a.name})*`), m.text ?? ''].filter(Boolean).join('\n\n')}`)
    } else {
      const body = (m.blocks ?? []).filter((b) => b.type === 'text').map((b: any) => b.text).join('\n\n')
      const src = m.sources?.length ? `\n\n**Sources**\n${m.sources.map((s) => `${s.n}. [${s.title}](${s.url})`).join('\n')}` : ''
      const arts = (m.artifacts ?? []).map((a) => a.kind === 'video' ? `\n\n*(Generated video: ${a.title} — prompt: ${a.meta?.prompt ?? ''})*` : a.kind === 'image' ? `\n\n*(Generated image: ${a.title} — prompt: ${a.meta?.prompt ?? ''})*` : `\n\n### Artifact: ${a.title}\n\n\`\`\`\`${a.kind === 'html' ? 'html' : a.kind === 'svg' ? 'xml' : a.kind === 'chart' || a.kind === 'diagram' ? 'json' : a.language ?? ''}\n${a.content}\n\`\`\`\``).join('')
      out.push(`## Assistant${m.model ? ` (${m.model})` : ''}\n\n${body}${src}${arts}`)
    }
  }
  return out.join('\n\n')
}

const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'chat'
export const exportChatMd = (c: Chat) => download(`${safe(c.title)}.md`, chatToMarkdown(c), 'text/markdown')
export const exportChatsJson = (chats: Chat[]) => download(`kokochat-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'kokochat', version: 1, chats }, null, 2), 'application/json')

export async function readChatsJson(file: File): Promise<Chat[]> {
  const j = JSON.parse(await file.text())
  const list = Array.isArray(j) ? j : j.chats
  if (!Array.isArray(list)) throw new Error('Not a Koko Chat export')
  return list.filter((c: any) => c?.id && Array.isArray(c.messages))
}
