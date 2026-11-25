import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Plus, Trash2, X } from 'lucide-react'
import type { Prompt, PromptFieldMeta } from '../types'
import { promptFields } from '../lib/prompts'
import { cn } from '../lib/utils'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** every spelling of one field in the prompt text: {name}, {name: x}, {{name|x}} */
const token = (key: string) => new RegExp(`\\{\\{?\\s*${esc(key)}\\s*(?:[|:][^{}]*)?\\}\\}?`, 'g')
const RESERVED = new Set(['text', 'input', 'date'])
const clean = (s: string) => s.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '').replace(/^[^a-zA-Z_]+/, '').slice(0, 24)

function NameInput({ value, taken, onCommit }: { value: string; taken: (k: string) => boolean; onCommit: (k: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { const k = clean(v); if (!k || k === value || RESERVED.has(k) || taken(k)) setV(value); else onCommit(k) }
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder="name" spellCheck={false} className="h-9 w-32 shrink-0 rounded-xl bg-surface-2/60 px-3 font-mono text-[13px] ring-1 ring-line focus:ring-accent/50" />
}

function Options({ value, onChange }: { value: string[]; onChange: (o: string[]) => void }) {
  const [q, setQ] = useState('')
  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter((s) => s && !value.includes(s))
    if (parts.length) onChange([...value, ...parts])
    setQ('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-surface-2/60 p-1.5 ring-1 ring-line focus-within:ring-accent/50">
      {value.map((o) => <span key={o} className="flex items-center gap-1 rounded-lg bg-accent-soft py-0.5 pl-2 pr-1 text-[13px] text-accent">{o}<button onClick={() => onChange(value.filter((x) => x !== o))} className="grid h-4 w-4 place-items-center rounded hover:bg-accent/20"><X size={11} /></button></span>)}
      <input value={q} onChange={(e) => { const v = e.target.value; if (v.includes(',') || v.includes('\n')) add(v); else setQ(v) }} onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[,\n]/.test(t)) { e.preventDefault(); add(t) } }} onBlur={() => q.trim() && add(q)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(q) } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1)) }} placeholder={value.length ? 'Add another…' : 'Type an option and press Enter (or paste a list)'} className="h-7 min-w-[8rem] flex-1 bg-transparent px-1.5 text-[13px] placeholder:text-faint" />
    </div>
  )
}

/** Prompt text plus a builder for its inputs: add a field, name it, make it a text box or a menu of choices. */
export function PromptEditor({ prompt, onChange, textClass }: { prompt: Prompt; onChange: (x: Partial<Prompt>) => void; textClass: string }) {
  const ta = useRef<HTMLTextAreaElement>(null)
  /** where the cursor was last in the prompt text (clicking a button moves focus away); the end if it was never used */
  const sel = useRef<[number, number] | null>(null)
  const remember = () => { const el = ta.current; if (el) sel.current = [el.selectionStart, el.selectionEnd] }
  const meta = prompt.fields ?? {}
  const fields = promptFields(prompt.text, meta)
  const setMeta = (key: string, m: Partial<PromptFieldMeta>) => onChange({ fields: { ...meta, [key]: { ...meta[key], ...m } } })

  const insert = (tok: string) => {
    const el = ta.current
    const [a, b] = sel.current ?? [prompt.text.length, prompt.text.length]
    const before = prompt.text.slice(0, a), after = prompt.text.slice(b)
    onChange({ text: before + tok + after })
    sel.current = [a + tok.length, a + tok.length]
    setTimeout(() => { el?.focus(); el?.setSelectionRange(a + tok.length, a + tok.length) }, 0)
  }
  const add = () => {
    let n = 1
    while (fields.some((f) => f.key === `field${n}`)) n++
    const key = `field${n}`
    const [a, b] = sel.current ?? [prompt.text.length, prompt.text.length]
    onChange({ text: prompt.text.slice(0, a) + `{${key}}` + prompt.text.slice(b), fields: { ...meta, [key]: { kind: 'text' } } })
    sel.current = [a + key.length + 2, a + key.length + 2]
  }
  const rename = (old: string, next: string) => {
    const { [old]: m, ...rest } = meta
    onChange({ text: prompt.text.replace(token(old), (t) => t.replace(old, next)), fields: { ...rest, ...(m ? { [next]: m } : {}) } })
  }
  const remove = (key: string) => {
    const { [key]: _gone, ...rest } = meta
    onChange({ text: prompt.text.replace(token(key), ''), fields: rest })
  }

  return (
    <>
      <textarea ref={ta} value={prompt.text} onChange={(e) => { onChange({ text: e.target.value }); remember() }} onSelect={remember} onBlur={remember} rows={3} placeholder="Prompt text… write {text} where your own message goes" className={textClass} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted">Inputs</span>
          <span className="text-xs text-faint">{fields.length ? 'shown above the message box when you use the command' : 'Add fields like a language or a currency that you pick each time'}</span>
          <button onClick={add} className="ml-auto flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-fg/8 px-3 text-[13px] font-medium transition hover:bg-fg/12 active:scale-95"><Plus size={13} />Add input</button>
        </div>
        {fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/30 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <NameInput value={f.key} taken={(k) => fields.some((x) => x.key === k)} onCommit={(k) => rename(f.key, k)} />
              <div className="inline-flex rounded-full bg-fg/5 p-0.5">
                {(['text', 'select'] as const).map((k) => <button key={k} onClick={() => setMeta(f.key, { kind: k })} className={cn('rounded-full px-3 py-1 text-[13px] font-medium transition', f.kind === k ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>{k === 'text' ? 'Text' : 'Menu'}</button>)}
              </div>
              <input value={meta[f.key]?.def ?? f.def} onChange={(e) => setMeta(f.key, { def: e.target.value })} placeholder={f.kind === 'select' ? 'Default choice' : 'Placeholder / default'} className="h-9 min-w-[7rem] flex-1 rounded-xl bg-surface-2/60 px-3 text-[13px] ring-1 ring-line placeholder:text-faint focus:ring-accent/50" />
              <button title={`Insert {${f.key}} at the cursor`} onClick={() => insert(`{${f.key}}`)} className="grid h-8 w-8 place-items-center rounded-full text-faint transition hover:bg-fg/8 hover:text-fg"><CornerDownLeft size={14} /></button>
              <button title="Remove this input" onClick={() => remove(f.key)} className="grid h-8 w-8 place-items-center rounded-full text-faint transition hover:bg-danger/10 hover:text-danger"><Trash2 size={14} /></button>
            </div>
            {f.kind === 'select' && <Options value={meta[f.key]?.options ?? []} onChange={(o) => setMeta(f.key, { options: o })} />}
          </div>
        ))}
      </div>
    </>
  )
}
