import type { Chat, Message } from '../types'

let target: string | null = null
/** Open a message after switching chats (ChatView scrolls to it once it is on screen). */
export const requestGoto = (id: string) => { target = id; window.dispatchEvent(new Event('koko:goto')) }
export const takeGoto = () => { const t = target; target = null; return t }

/** Everything a person can read in a message, as one string. */
export function messageText(m: Message): string {
  if (m.role === 'user') return [m.text, ...(m.quotes ?? []), ...(m.attachments ?? []).map((a) => a.name)].filter(Boolean).join('\n')
  const text = (m.blocks ?? []).filter((b) => b.type === 'text').map((b: any) => b.text).join('\n\n')
  return [text, ...(m.artifacts ?? []).map((a) => a.title)].filter(Boolean).join('\n')
}

export interface Snippet { before: string; hit: string; after: string }
export interface MsgHit { chat: Chat; message: Message; snippet: Snippet; score: number }

export const queryTokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Words must all appear (any order); an exact phrase ranks higher, then title matches, then recency. */
export function searchMessages(chats: Chat[], q: string, limit = 40): MsgHit[] {
  const toks = queryTokens(q)
  if (!toks.length) return []
  const phrase = q.trim().toLowerCase()
  const out: MsgHit[] = []
  for (const chat of chats) {
    const titleHit = toks.every((t) => chat.title.toLowerCase().includes(t))
    for (const m of chat.messages) {
      if (m.cmp && !m.cmp.picked && chat.messages.some((x) => x.cmp?.group === m.cmp!.group && x.cmp?.picked)) continue
      const text = messageText(m)
      if (!text) continue
      const low = text.toLowerCase()
      if (!toks.every((t) => low.includes(t))) continue
      const exact = low.indexOf(phrase)
      const at = exact >= 0 ? exact : low.indexOf(toks[0])
      const len = exact >= 0 ? phrase.length : toks[0].length
      const from = Math.max(0, at - 50)
      const clean = (s: string) => s.replace(/\s+/g, ' ')
      out.push({
        chat, message: m,
        snippet: { before: (from > 0 ? '…' : '') + clean(text.slice(from, at)), hit: clean(text.slice(at, at + len)), after: clean(text.slice(at + len, at + len + 110)) + (at + len + 110 < text.length ? '…' : '') },
        score: (exact >= 0 ? 4 : 0) + (titleHit ? 2 : 0) + (m.role === 'user' ? 0.5 : 0) + chat.updatedAt / 1e14,
      })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
