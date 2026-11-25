import { useStore } from '../store'
import type { Chat, Memory } from '../types'
import type { ToolDef } from './tools'
import { uid } from './utils'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const MEMORY_TOOLS: ToolDef[] = [
  {
    name: 'memory_save',
    description: 'Save one durable fact about the user to long-term memory (it is shown to you in every future conversation). Call it as soon as the user reveals something worth remembering, alongside your normal answer, without asking first. One short, self-contained sentence in the third person, for example "Prefers TypeScript over JavaScript". If it corrects or updates an existing memory, pass that memory\'s id as replaces.',
    parameters: obj({ text: { type: 'string', description: 'The fact, one sentence.' }, replaces: { type: 'string', description: 'Id of an existing memory this replaces.' }, project: { type: 'boolean', description: 'In a coding session: true when the fact only applies to this project folder.' } }, ['text']),
  },
  {
    name: 'memory_forget',
    description: 'Delete a memory by its id (when it is wrong, outdated, or the user asked you to forget it).',
    parameters: obj({ id: { type: 'string' } }, ['id']),
  },
  {
    name: 'memory_search',
    description: 'Look through all saved memories for a topic. Use it when the memory list you were given is not complete and the topic might be in there.',
    parameters: obj({ query: { type: 'string' } }, ['query']),
  },
]
export const isMemoryTool = (name: string) => name === 'memory_save' || name === 'memory_forget' || name === 'memory_search'

const MAX_MEMORIES = 400
const MAX_SHOWN = 60
const MAX_CHARS = 300

const words = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** The memories that apply to this chat (a project's own ones only show in that project). */
export const memoriesFor = (cwd?: string): Memory[] => useStore.getState().memories.filter((m) => !m.cwd || m.cwd === cwd)

function pick(all: Memory[], query: string): Memory[] {
  if (all.length <= MAX_SHOWN) return [...all].sort((a, b) => a.createdAt - b.createdAt)
  const q = words(query)
  const scored = all.map((m) => { const w = words(m.text); let s = 0; for (const x of w) if (q.has(x)) s++; return { m, s } })
  const relevant = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || b.m.updatedAt - a.m.updatedAt).slice(0, 35).map((x) => x.m)
  const have = new Set(relevant.map((m) => m.id))
  const recent = [...all].sort((a, b) => b.updatedAt - a.updatedAt).filter((m) => !have.has(m.id)).slice(0, MAX_SHOWN - relevant.length)
  return [...relevant, ...recent]
}

/** The memory section of the system prompt: what is known, and how (and when) to keep it up to date. */
export function memoryBlock(chat?: Pick<Chat, 'cwd' | 'messages'>): string {
  const { settings, memories } = useStore.getState()
  if (!settings.memory.enabled) return ''
  const all = memories.filter((m) => !m.cwd || m.cwd === chat?.cwd)
  const lastUser = [...(chat?.messages ?? [])].reverse().find((m) => m.role === 'user')?.text ?? ''
  const shown = pick(all, lastUser)
  const canWrite = settings.memory.auto
  const list = shown.length ? shown.map((m) => `- [${m.id}] ${m.text}${m.cwd ? ' (this project)' : ''}`).join('\n') : '(nothing saved yet)'
  return [
    '# Long-term memory',
    'You have a persistent memory that carries over between conversations, so the user never has to repeat themselves. What you know so far:',
    list,
    all.length > shown.length ? `(${all.length - shown.length} more memories exist. Use memory_search if the topic might be in there.)` : '',
    'How to use it:',
    '- Treat this as things you already know about the user. Let it quietly shape your answers (their stack, tone, preferences, projects). Do not announce that you remember, and do not recite the list unless asked.',
    canWrite
      ? '- SAVE PROACTIVELY. Whenever the user reveals something that will still matter later, call memory_save in that same turn, together with your normal answer, without asking permission and without mentioning it beforehand. That includes: preferences and dislikes, name, role and background, projects and their tech stack or conventions, people and relationships they mention, goals, constraints, tools they use, and corrections to how you behave ("stop using bullet points", "always use tabs"). Write one short third-person sentence per fact ("Uses pnpm, not npm"). If a fact changes or was wrong, pass the old memory\'s id as replaces instead of adding a duplicate.\n- Do not save secrets, passwords, API keys, one-off details that only matter for this conversation, or sensitive personal data (health, finances, politics) unless the user asks you to remember it.\n- When the user says "remember that…" or "forget …", do it with the tools, then confirm in a few words. If they ask what you remember, answer from the list.'
      : '- You cannot save new memories right now (the user turned off automatic saving). If they ask you to remember something, tell them they can add it in Settings → Memory.',
  ].filter(Boolean).join('\n')
}

/** Used by the tool pill in the chat to offer "undo". */
export interface MemoryMeta { memory?: { action: 'saved' | 'updated' | 'forgot' | 'found'; id?: string; text?: string; before?: Memory; count?: number } }

export async function runMemoryTool(name: string, a: Record<string, any>, ctx: { chatId: string; update: (fn: (b: any) => void) => void }): Promise<{ output: string }> {
  const st = useStore.getState()
  const meta = (m: MemoryMeta['memory']) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), memory: m } })
  const cwd = st.chats.find((c) => c.id === ctx.chatId)?.cwd

  if (name === 'memory_search') {
    const q = words(String(a.query ?? '')), query = norm(String(a.query ?? ''))
    const hits = memoriesFor(cwd).map((m) => { let s = norm(m.text).includes(query) ? 3 : 0; for (const w of words(m.text)) if (q.has(w)) s++; return { m, s } }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 20)
    meta({ action: 'found', count: hits.length })
    return { output: hits.length ? hits.map((h) => `[${h.m.id}] ${h.m.text}`).join('\n') : 'No matching memories.' }
  }

  if (name === 'memory_forget') {
    const m = st.memories.find((x) => x.id === String(a.id ?? ''))
    if (!m) return { output: 'There is no memory with that id.' }
    st.deleteMemory(m.id)
    meta({ action: 'forgot', id: m.id, text: m.text, before: m })
    return { output: 'Forgotten.' }
  }

  // memory_save
  const text = String(a.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)
  if (text.length < 3) throw new Error('text is required')
  const dup = st.memories.find((m) => norm(m.text) === norm(text))
  if (dup) { meta({ action: 'saved', id: dup.id, text: dup.text }); return { output: 'Already remembered.' } }
  const target = a.replaces ? st.memories.find((m) => m.id === String(a.replaces)) : undefined
  if (target) {
    st.updateMemory(target.id, { text, source: 'ai' })
    meta({ action: 'updated', id: target.id, text, before: target })
    return { output: 'Memory updated.' }
  }
  if (st.memories.length >= MAX_MEMORIES) throw new Error('Memory is full. Forget something that is no longer useful first.')
  const m: Memory = { id: uid(), text, createdAt: Date.now(), updatedAt: Date.now(), source: 'ai', ...(a.project && cwd ? { cwd } : {}) }
  st.addMemory(m)
  meta({ action: 'saved', id: m.id, text })
  return { output: 'Saved to memory.' }
}
