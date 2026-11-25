import type { Prompt, PromptFieldMeta } from '../types'

/** Prompts can use {text} (what you type under the command), {{date}}, and named fields such as {language: English} (the part after | is the default). */
export const DEFAULT_PROMPTS: Prompt[] = [
  { id: 'p-summarize', name: 'Summarize', slash: 'summarize', text: 'Summarize the following in a few clear bullet points, then give a one-sentence takeaway:\n\n{text}' },
  { id: 'p-translate', name: 'Translate', slash: 'translate', text: 'Translate the following to {language}. Keep the tone and formatting, and only output the translation:\n\n{text}', fields: { language: { kind: 'select', options: ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Chinese'], def: 'English' } } },
  { id: 'p-explain', name: 'Explain simply', slash: 'eli5', text: 'Explain this simply, as if to a curious 12-year-old, with one good analogy:\n\n{text}' },
  { id: 'p-grammar', name: 'Fix grammar and style', slash: 'fix', text: 'Fix the grammar, spelling and clarity of the text below without changing its meaning. Return only the improved text:\n\n{text}' },
  { id: 'p-review', name: 'Code review', slash: 'review', text: 'Review this code like a careful senior engineer. List real bugs first, then risks, then small improvements, each with a short fix:\n\n{text}' },
  { id: 'p-email', name: 'Write an email', slash: 'email', text: 'Write a concise, {tone} email about the following. Give a subject line and the body:\n\n{text}', fields: { tone: { kind: 'select', options: ['polite', 'friendly', 'formal', 'direct', 'apologetic'], def: 'polite' } } },
  { id: 'p-currency', name: 'Convert currency', slash: 'convert', text: 'Convert {amount} from {from} to {to}. Use a recent exchange rate (search for it if you can), show the rate and the date it is from, and give the result.', fields: { amount: { kind: 'text', def: '100' }, from: { kind: 'select', options: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR'], def: 'USD' }, to: { kind: 'select', options: ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR'], def: 'EUR' } } },
  { id: 'p-prosCons', name: 'Pros and cons', slash: 'proscons', text: 'Give a balanced list of pros and cons for the following, then a short recommendation:\n\n{text}' },
  { id: 'p-brainstorm', name: 'Brainstorm ideas', slash: 'ideas', text: 'Brainstorm {count} varied, specific ideas for the following. Group them and mark the three most promising:\n\n{text}', fields: { count: { kind: 'select', options: ['5', '10', '20'], def: '10' } } },
]

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)

export interface PromptField { key: string; def: string; kind: 'text' | 'select'; options: string[] }
/** {name} or {name: placeholder}. The older {{name}} / {{name|default}} spelling still works. */
const FIELD = /\{\{\s*([a-zA-Z_][\w-]*)\s*(?:[|:]([^{}]*))?\}\}|\{\s*([a-zA-Z_][\w-]*)\s*(?:[:|]([^{}]*))?\}/g
/** {text} (or {input}) is the box you type in under the command; every other name is a small field of its own */
const MAIN = new Set(['text', 'input'])

/** The named fields a prompt asks for (everything except the main text and {date}), in the order they appear, with their type from the builder. */
export function promptFields(text: string, meta: Record<string, PromptFieldMeta> = {}): PromptField[] {
  const out: PromptField[] = []
  for (const m of text.matchAll(FIELD)) {
    const key = m[1] ?? m[3]
    if (MAIN.has(key) || key === 'date' || out.some((f) => f.key === key)) continue
    const mt = meta[key] ?? {}
    const options = mt.kind === 'select' ? (mt.options ?? []).filter(Boolean) : []
    out.push({ key, kind: mt.kind === 'select' ? 'select' : 'text', options, def: (mt.def ?? m[2] ?? m[4] ?? '').trim() || (mt.kind === 'select' ? options[0] ?? '' : '') })
  }
  return out
}
export const usesInput = (text: string) => [...text.matchAll(FIELD)].some((m) => MAIN.has(m[1] ?? m[3]))

/** The placeholder written inside the text slot, like {text: Bonjour}; used when nothing is typed there. */
export function mainDefault(text: string): string {
  for (const m of text.matchAll(FIELD)) if (MAIN.has(m[1] ?? m[3])) return (m[2] ?? m[4] ?? '').trim()
  return ''
}

function render(text: string, input: string, fields: Record<string, string>, main: string) {
  return text.replace(FIELD, (_all, k1: string | undefined, d1: string | undefined, k2: string | undefined, d2: string | undefined) => {
    const key = (k1 ?? k2)!, def = (d1 ?? d2 ?? '').trim()
    if (MAIN.has(key)) return main || def
    if (key === 'date') return new Date().toDateString()
    return fields[key]?.trim() || def
  })
}

export function fillPrompt(text: string, input: string, fields: Record<string, string> = {}): string {
  const filled = render(text, input, fields, input)
  return usesInput(text) ? filled : input ? `${filled}\n\n${input}` : filled
}

/** A one-line look at the prompt for the command box: your fields filled in, the text slot shown as "…". */
export const previewPrompt = (text: string, fields: Record<string, string> = {}) => render(text, '', fields, '…').replace(/\s+/g, ' ').trim()

/** "/translate bonjour" -> the filled-in prompt, or null if the text does not start with one of the user's commands. */
export function expandSlash(text: string, prompts: Prompt[]): string | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  const p = prompts.find((x) => x.slash === m[1].toLowerCase())
  return p ? fillPrompt(p.text, (m[2] ?? '').trim()) : null
}
