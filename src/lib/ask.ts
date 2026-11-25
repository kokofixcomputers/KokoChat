export type AskType = 'single' | 'multi' | 'text'
export interface AskOption { label: string; description?: string }
export interface AskQuestion { id: string; question: string; type: AskType; options: AskOption[]; allowCustom: boolean; placeholder?: string; required: boolean }
export type AskAnswers = Record<string, string | string[]>

/** Tolerant parser: models send strings or objects for options, omit ids, etc. */
export function normalizeQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: AskQuestion[] = []
  raw.slice(0, 6).forEach((q: any, i) => {
    const question = String(q?.question ?? q?.text ?? '').trim()
    if (!question) return
    const options: AskOption[] = (Array.isArray(q.options) ? q.options : [])
      .map((o: any) => (typeof o === 'string' ? { label: o } : { label: String(o?.label ?? o?.title ?? o?.value ?? ''), description: o?.description ? String(o.description) : undefined }))
      .filter((o: AskOption) => o.label.trim())
      .slice(0, 12)
    let type: AskType = ['single', 'multi', 'text'].includes(q.type) ? q.type : options.length ? 'single' : 'text'
    if (type !== 'text' && !options.length) type = 'text'
    out.push({
      id: String(q.id ?? `q${i + 1}`),
      question,
      type,
      options,
      allowCustom: q.allowCustomUserInput ?? q.allowCustom ?? true,
      placeholder: q.placeholder ? String(q.placeholder) : undefined,
      required: q.required !== false,
    })
  })
  return out
}

const waiters = new Map<string, (a: AskAnswers | null) => void>()

export function waitForAnswers(callId: string, signal: AbortSignal): Promise<AskAnswers | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    waiters.set(callId, (a) => { waiters.delete(callId); resolve(a) })
    signal.addEventListener('abort', () => { waiters.delete(callId); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}

export const submitAnswers = (callId: string, answers: AskAnswers | null) => waiters.get(callId)?.(answers)
export const isWaiting = (callId: string) => waiters.has(callId)

export const answerText = (a: string | string[] | undefined) => (Array.isArray(a) ? a.join(', ') : a ?? '')

export function formatAnswers(qs: AskQuestion[], a: AskAnswers | null) {
  if (!a) return 'The user chose to skip the questions. Proceed with sensible defaults and clearly state the assumptions you made.'
  const lines = qs.map((q, i) => {
    const t = answerText(a[q.id]).trim()
    return `${i + 1}. ${q.question}\n   Answer: ${t || '(no answer)'}`
  })
  return `The user answered your questions:\n\n${lines.join('\n')}\n\nContinue with the original request using these answers. Do not ask the same questions again.`
}
