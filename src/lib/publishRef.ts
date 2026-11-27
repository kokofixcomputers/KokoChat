/**
 * Which published page an artifact belongs to. The AI picks artifact ids ("flowchart"), so two chats often share one:
 * the chat id is part of the reference. Pages published before that are stored under the bare artifact id.
 */
import type { Chat } from '../types'

/** the sync server keeps at most this many characters of a reference */
const MAX_REF = 80

function hash(s: string) {
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x85ebca6b) }
  return `${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`
}

export function artifactRef(chatId: string, artifactId: string) {
  const ref = `${chatId}/${artifactId}`
  // cutting a long one short could make two the same, so end it with a hash of the whole thing
  return ref.length <= MAX_REF ? ref : `${ref.slice(0, MAX_REF - 15)}~${hash(ref)}`
}

/**
 * May this chat take over a page published under the bare artifact id? Only when it is the one chat that could have
 * published it: it has an artifact with that id, title and kind, and is older than the page. When in doubt the answer is
 * no, which costs a new link; a wrong yes would replace someone's page.
 */
export function ownsOldPage(chats: Chat[], chatId: string, artifactId: string, page: { ref: string; title: string; kind?: string; created: number }) {
  if (page.ref !== artifactId) return false
  const could = chats.filter((c) => c.createdAt <= page.created && c.messages.some((m) =>
    [m, ...(m.alts ?? [])].some((v) => v.artifacts?.some((a) => a.id === artifactId && a.title.slice(0, 200) === page.title && a.kind === (page.kind ?? 'html')))))
  return could.length === 1 && could[0].id === chatId
}
