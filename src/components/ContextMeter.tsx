import { useMemo, useState } from 'react'
import { Loader2, Minimize2, Undo2 } from 'lucide-react'
import { useStore } from '../store'
import { resolveForModel } from '../lib/lanes'
import { canCompact, contextWindowFor, estimateContext, tokensOf } from '../lib/context'
import { Popover, Toggle } from './ui'
import { cn } from '../lib/utils'
import { limitsFor } from '../lib/modelLimits'

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export function ContextMeter({ draft }: { draft: { text: string; fileChars: number; images: number } }) {
  const { settings, setSettings, providers, mcpServers, selected, chats, activeId, compacting, compactChat, clearSummary } = useStore()
  const chat = chats.find((c) => c.id === activeId)
  const model = chat?.model ?? selected?.model
  const [focus, setFocus] = useState('')

  const est = useMemo(
    () => estimateContext({ settings, providers, mcpServers, chat: chat ?? { messages: [] }, model }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, providers, mcpServers, chat?.messages, chat?.summary, chat?.system, model],
  )
  if (!model) return null

  const draftTokens = tokensOf(draft.text) + Math.ceil(draft.fileChars / 3.6) + draft.images * 900
  const total = est.total + draftTokens
  const win = est.window
  const pct = Math.min(1, total / win)
  const busy = !!(activeId && compacting[activeId])
  const can = !!chat && canCompact(resolveForModel(chat.messages), chat.summary)
  const color = pct >= 0.85 ? 'var(--danger)' : pct >= 0.6 ? '#f59e0b' : 'var(--accent)'
  const segs = draftTokens ? [...est.segments, { id: 'draft' as const, label: 'Draft', tokens: draftTokens, color: '#d4d4d8', hint: 'What you are typing now' }] : est.segments
  const R = 8, C = 2 * Math.PI * R

  return (
    <Popover
      side="top" align="right" panelClassName="w-[22rem] max-w-[92vw]"
      button={(open, toggle) => (
        <button
          onClick={toggle} title={`Context: ~${k(total)} of ${k(win)} tokens (${Math.round(pct * 100)}%)`}
          className={cn('flex h-9 items-center gap-1.5 rounded-full px-2 text-[12px] font-medium tabular-nums text-muted transition hover:bg-fg/5 hover:text-fg', open && 'bg-fg/5 text-fg')}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
            <circle cx="10" cy="10" r={R} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
            <circle cx="10" cy="10" r={R} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(pct, total ? 0.03 : 0))} style={{ transition: 'stroke-dashoffset .4s' }} />
          </svg>
          <span className="hidden sm:inline">{Math.round(pct * 100)}%</span>
        </button>
      )}
    >
      <div className="p-2">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div className="min-w-0"><div className="text-sm font-semibold">Context window</div><div className="truncate text-xs text-muted" title={model}>{model}{limitsFor(model)?.maxOut ? ` · up to ${k(limitsFor(model)!.maxOut!)} output` : ''}</div></div>
          <div className="text-xs tabular-nums text-muted"><span className="font-medium text-fg">{k(total)}</span> / {k(win)} tokens · {Math.round(pct * 100)}%</div>
        </div>

        <div className="mb-3 flex h-3 overflow-hidden rounded-full bg-fg/8">
          {segs.map((s) => <div key={s.id} title={`${s.label}: ${k(s.tokens)}`} style={{ width: `${(s.tokens / Math.max(win, total)) * 100}%`, background: s.color, minWidth: 2 }} className="transition-all duration-500" />)}
        </div>

        <div className="flex flex-col">
          {segs.map((s) => (
            <div key={s.id} title={s.hint} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 text-[13px] hover:bg-fg/5">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="flex-1 truncate">{s.label}</span>
              <span className="tabular-nums text-muted">{k(s.tokens)}</span>
              <span className="w-9 text-right text-xs tabular-nums text-faint">{((s.tokens / win) * 100).toFixed(s.tokens / win < 0.01 ? 1 : 0)}%</span>
            </div>
          ))}
          <div className="flex items-center gap-2.5 px-1.5 py-1 text-[13px] text-faint"><span className="h-2.5 w-2.5 shrink-0 rounded-full border border-faint/50" /><span className="flex-1">Free space</span><span className="tabular-nums">{k(Math.max(0, win - total))}</span></div>
        </div>
        <div className="mt-1 px-1.5 text-[11px] text-faint">Estimates; real token counts vary by model.</div>

        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
          {chat?.summary && (
            <div className="flex items-center justify-between rounded-xl bg-fg/5 px-3 py-2 text-xs text-muted">
              <span>Compacted ~{k(chat.summary.tokensBefore)} → ~{k(chat.summary.tokensAfter)} tokens</span>
              <button onClick={() => clearSummary(chat.id)} className="flex items-center gap-1 text-fg hover:text-accent"><Undo2 size={12} />Undo</button>
            </div>
          )}
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Optional: what should the summary keep?" className="h-9 rounded-xl border border-line bg-surface-2/60 px-3 text-[13px] placeholder:text-faint focus:border-accent/60" />
          <button
            disabled={!can || busy || !chat} onClick={() => chat && compactChat(chat.id, focus || undefined)}
            title={can ? 'Summarize older messages to free up context. Your messages stay visible.' : 'Needs at least 3 of your messages'}
            className="flex h-9 items-center justify-center gap-2 rounded-full bg-fg text-[13px] font-medium text-bg transition active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? <><Loader2 size={14} className="spin" />Compacting…</> : <><Minimize2 size={14} />Compact conversation</>}
          </button>
          <div className="flex items-center justify-between gap-3 px-1">
            <div><div className="text-[13px] font-medium">Auto-compact</div><div className="text-xs text-muted">When above 80% of the window</div></div>
            <Toggle on={settings.autoCompact} onChange={(b) => setSettings({ autoCompact: b })} />
          </div>
          <label className="flex items-center justify-between gap-3 px-1 text-[13px]">
            <span><span className="font-medium">Window size</span><span className="block text-xs text-muted">Auto: {k(contextWindowFor(model))} for {model}{limitsFor(model) ? '' : ' (guessed)'}</span></span>
            <input
              type="number" min={0} step={1000} value={settings.contextWindow || ''} placeholder="auto"
              onChange={(e) => setSettings({ contextWindow: Math.max(0, Math.floor(+e.target.value || 0)) })}
              className="h-8 w-24 rounded-xl border border-line bg-surface-2/60 px-2.5 text-right text-sm tabular-nums placeholder:text-faint focus:border-accent/60"
            />
          </label>
        </div>
      </div>
    </Popover>
  )
}
