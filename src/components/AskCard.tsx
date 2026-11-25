import { useMemo, useState } from 'react'
import { Check, CircleAlert, Loader2, MessageCircleQuestion } from 'lucide-react'
import type { Block } from '../types'
import { answerText, normalizeQuestions, submitAnswers, type AskAnswers, type AskQuestion } from '../lib/ask'
import { cn } from '../lib/utils'

type Sel = { picked: string[]; custom: string; customOn: boolean; text: string }
const empty = (): Sel => ({ picked: [], custom: '', customOn: false, text: '' })

function Box({ on, round }: { on: boolean; round?: boolean }) {
  return (
    <span className={cn('grid h-[18px] w-[18px] shrink-0 place-items-center border-[1.5px] transition-all duration-150', round ? 'rounded-full' : 'rounded-[6px]', on ? 'border-accent bg-accent text-accent-fg' : 'border-faint/60 bg-surface')}>
      {on && (round ? <span className="anim-pop h-1.5 w-1.5 rounded-full bg-accent-fg" /> : <Check size={12} strokeWidth={3.2} className="anim-pop" />)}
    </span>
  )
}

function answerOf(q: AskQuestion, s: Sel): string | string[] | undefined {
  if (q.type === 'text') return s.text.trim() || undefined
  const items = [...s.picked]
  if (s.customOn && s.custom.trim()) items.push(s.custom.trim())
  if (!items.length) return undefined
  return q.type === 'single' ? items[items.length - 1] : items
}

function Question({ q, n, s, set }: { q: AskQuestion; n: number; s: Sel; set: (f: (x: Sel) => Sel) => void }) {
  const toggle = (label: string) =>
    set((x) => {
      if (q.type === 'single') return { ...x, picked: [label], customOn: false }
      return { ...x, picked: x.picked.includes(label) ? x.picked.filter((l) => l !== label) : [...x.picked, label] }
    })
  const multi = q.type === 'multi'
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-px grid h-5 min-w-5 place-items-center rounded-full bg-accent-soft px-1 text-[11px] font-semibold text-accent">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium leading-snug">{q.question}</div>
          {q.type !== 'text' && <div className="mt-0.5 text-xs text-faint">{multi ? 'Select all that apply' : 'Choose one'}{!q.required && ' · optional'}</div>}
        </div>
      </div>

      {q.type === 'text' ? (
        <textarea
          value={s.text} onChange={(e) => set((x) => ({ ...x, text: e.target.value }))} rows={2} placeholder={q.placeholder ?? 'Type your answer…'}
          className="w-full resize-y rounded-2xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-sm leading-relaxed transition placeholder:text-faint focus:border-accent/60 focus:bg-surface"
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {q.options.map((o) => {
            const on = s.picked.includes(o.label)
            return (
              <button
                key={o.label} role={multi ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => toggle(o.label)}
                className={cn('flex items-start gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all duration-150 active:scale-[0.99]', on ? 'border-accent/60 bg-accent-soft' : 'border-line bg-surface/60 hover:border-faint/60 hover:bg-surface')}
              >
                <span className="mt-0.5"><Box on={on} round={!multi} /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug">{o.label}</span>
                  {o.description && <span className="mt-0.5 block text-[13px] leading-snug text-muted">{o.description}</span>}
                </span>
              </button>
            )
          })}
          {q.allowCustom && (
            <div className={cn('flex items-center gap-3 rounded-2xl border px-3.5 py-2 transition-all duration-150', s.customOn ? 'border-accent/60 bg-accent-soft' : 'border-line bg-surface/60 hover:border-faint/60')}>
              <button
                role={multi ? 'checkbox' : 'radio'} aria-checked={s.customOn} aria-label="Use my own answer"
                onClick={() => set((x) => ({ ...x, customOn: !x.customOn, picked: !multi && !x.customOn ? [] : x.picked }))}
              ><Box on={s.customOn} round={!multi} /></button>
              <input
                value={s.custom} placeholder="Input your own answer here"
                onFocus={() => set((x) => (x.customOn ? x : { ...x, customOn: true, picked: multi ? x.picked : [] }))}
                onChange={(e) => set((x) => ({ ...x, custom: e.target.value, customOn: true, picked: multi ? x.picked : [] }))}
                className="h-7 min-w-0 flex-1 bg-transparent text-sm placeholder:text-faint"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AskCard({ block }: { block: Extract<Block, { type: 'tool' }> }) {
  const qs = useMemo(() => {
    try { return normalizeQuestions(JSON.parse(block.args).questions) } catch { return null }
  }, [block.args])
  const [sel, setSel] = useState<Record<string, Sel>>({})
  const get = (id: string) => sel[id] ?? empty()

  const running = block.status === 'running'
  const asking = running && block.phase === 'asking' && !!qs?.length

  /* ------------ answered / finished summary ------------ */
  if (block.status === 'done' && qs) {
    const a = block.answers ?? {}
    return (
      <div className="glass anim-fade-up w-full max-w-xl rounded-3xl p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent"><Check size={14} strokeWidth={3} /></span>{block.skipped ? 'Questions skipped' : 'You answered'}</div>
        {!block.skipped && (
          <div className="flex flex-col gap-2.5">
            {qs.map((q) => (
              <div key={q.id} className="text-sm"><div className="text-muted">{q.question}</div><div className="mt-0.5 font-medium">{answerText(a[q.id]) || <span className="font-normal text-faint">No answer</span>}</div></div>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (block.status === 'error')
    return <div className="anim-fade-up flex w-fit items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-muted"><CircleAlert size={14} />Question cancelled</div>
  if (!asking)
    return <div className="glass anim-fade-up flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px]"><Loader2 size={14} className="spin text-accent" /><span className="shimmer font-medium">Preparing questions…</span></div>

  /* ------------------------ the form ------------------------ */
  const list = qs!
  const answers: AskAnswers = {}
  for (const q of list) { const v = answerOf(q, get(q.id)); if (v !== undefined) answers[q.id] = v }
  const missing = list.filter((q) => q.required && answers[q.id] === undefined).length
  const done = list.length - list.filter((q) => answers[q.id] === undefined).length
  const submit = () => missing === 0 && submitAnswers(block.callId, answers)

  return (
    <div
      className="glass-strong anim-fade-up w-full max-w-xl rounded-3xl p-4 sm:p-5"
      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
    >
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-soft text-accent"><MessageCircleQuestion size={17} /></span>
        <div><div className="text-sm font-semibold">A few quick questions</div><div className="text-xs text-muted">Answer so I don't have to guess</div></div>
      </div>
      <div className="flex flex-col gap-6">
        {list.map((q, i) => <Question key={q.id} q={q} n={i + 1} s={get(q.id)} set={(f) => setSel((x) => ({ ...x, [q.id]: f(x[q.id] ?? empty()) }))} />)}
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <button onClick={() => submitAnswers(block.callId, null)} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-muted transition hover:bg-fg/5 hover:text-fg">Skip</button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-faint sm:inline">{done} of {list.length} answered</span>
          <button disabled={missing > 0} onClick={submit} className="flex h-9 items-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-30">Continue</button>
        </div>
      </div>
    </div>
  )
}

