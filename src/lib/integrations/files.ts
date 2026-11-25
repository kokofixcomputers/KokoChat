import type { ToolDef } from '../tools'
import { kbFilesFor, readKb, searchKb } from '../kb'
import type { Describe, Integration, RunCtx } from './types'

const TOOLS: ToolDef[] = [
  {
    name: 'kb_search',
    description: 'Search inside the user\'s uploaded files and project files (PDFs, documents, notes). Returns the most relevant passages with file name and page. Use it for any question about their files; search again with different wording if the first results are not enough.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for, in natural language.' }, file: { type: 'string', description: 'Only search this file (name).' }, limit: { type: 'number', description: 'Passages to return, default 6, max 12.' } }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'kb_read',
    description: 'Read consecutive parts of one uploaded file in order (each part is about 1,000 characters). Use it to read a whole short file or to continue after a search hit.',
    parameters: { type: 'object', properties: { file: { type: 'string', description: 'File name.' }, from: { type: 'number', description: 'First part number, starting at 1.' }, count: { type: 'number', description: 'Parts to read, default 4, max 10.' } }, required: ['file'], additionalProperties: false },
  },
]

const pick = (files: ReturnType<typeof kbFilesFor>, name: unknown) => {
  const n = String(name ?? '').trim().toLowerCase()
  if (!n) return undefined
  return files.find((f) => f.name.toLowerCase() === n) ?? files.find((f) => f.name.toLowerCase().includes(n))
}

async function run(tool: string, a: Record<string, any>, ctx: RunCtx) {
  const files = kbFilesFor(ctx.chatId)
  if (!files.length) return { output: 'No files are available in this conversation (they may have been uploaded on another device).' }
  const meta = (m: Record<string, unknown>) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), ...m } })
  if (tool === 'kb_search') {
    const query = String(a.query ?? '').trim()
    if (!query) throw new Error('Provide a search query.')
    const only = a.file ? pick(files, a.file) : undefined
    if (a.file && !only) return { output: `No file named "${a.file}". Files: ${files.map((f) => f.name).join(', ')}` }
    const hits = await searchKb(only ? [only] : files, query, Math.min(12, Math.max(1, Number(a.limit) || 6)))
    meta({ summary: `${hits.length} passage${hits.length === 1 ? '' : 's'}` })
    if (!hits.length) return { output: `Nothing matched "${query}" in ${only ? only.name : 'the files'}. Try different words, or read the file in order with kb_read.` }
    return { output: hits.map((h) => `[${h.file.name}${h.page ? `, page ${h.page}` : ''}, part ${h.index + 1} of ${h.file.chunks}]\n${h.text}`).join('\n\n---\n\n') }
  }
  const f = pick(files, a.file)
  if (!f) return { output: `No file named "${a.file ?? ''}". Files: ${files.map((x) => x.name).join(', ')}` }
  const r = await readKb(f, Math.max(1, Number(a.from) || 1), Math.min(10, Math.max(1, Number(a.count) || 4)))
  if (!r) return { output: `${f.name} is not stored on this device any more.` }
  meta({ label: f.name, summary: `${r.total} parts in total` })
  return { output: `${f.name} (${r.total} parts)\n\n${r.text}` }
}

function describe(tool: string, a: Record<string, any>): Describe {
  if (tool === 'kb_search') return { present: 'Searching your files for', past: 'Searched your files for', subject: a.query ? `“${a.query}”` : undefined, in: a.file ? `in ${a.file}` : undefined, failed: "Couldn't search your files for" }
  return { present: 'Reading', past: 'Read', subject: a.file ? String(a.file) : 'a file', failed: "Couldn't read" }
}

export const files: Integration = {
  id: 'files',
  name: 'Your files',
  icon: 'files',
  tools: TOOLS,
  // offered only in chats that actually have files (their own uploads or their project's)
  toolsFor: (_s, chatId) => (kbFilesFor(chatId).length ? TOOLS : []),
  prompt: 'The user has uploaded files for this conversation (listed under "Files" above). Use kb_search to find relevant passages before answering anything about them, and kb_read to read a file in order. Quote or paraphrase what you find and mention the file name (and page when given). If the files do not contain the answer, say so instead of guessing.',
  enabled: () => true,
  owns: (t) => t === 'kb_search' || t === 'kb_read',
  describe,
  run,
  triggers: /\b(files?|pdfs?|documents?|docs?|uploaded|attached|attachment|paper|report|manuscript|contract|according to|summari[sz]e (?:it|this|that|them))\b/i,
}
