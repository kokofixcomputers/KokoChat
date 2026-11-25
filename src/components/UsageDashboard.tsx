import { useMemo, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { Segmented } from './ui'
import { ModelIcon } from './ModelIcon'
import { PRICES_AS_OF, costOf, fmtTokens, fmtUsd } from '../lib/pricing'
import { dayKey, type UsageRow } from '../lib/usage'
import { download } from '../lib/utils'
import { cn } from '../lib/utils'

type Range = '7' | '30' | '90' | 'all'
const field = 'h-8 w-full rounded-lg border border-line bg-surface-2/60 px-2.5 text-right text-xs tabular-nums placeholder:text-faint focus:border-accent/60 focus:bg-surface'

/** What a ledger row cost: what was priced when it happened, plus anything that has a price now (a price set later back-fills). */
const rowCost = (r: UsageRow, ov: ReturnType<typeof useStore.getState>['priceOverrides']) => r.cost + (r.u ? costOf(r.model, r.u, ov) ?? 0 : 0)
const rowUnpriced = (r: UsageRow, ov: ReturnType<typeof useStore.getState>['priceOverrides']) => !!r.u && costOf(r.model, r.u, ov) === null

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/50 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-faint">{sub}</div>}
    </div>
  )
}

export function UsageDashboard() {
  const { usage, priceOverrides, providers } = useStore()
  const [range, setRange] = useState<Range>('30')
  const [hover, setHover] = useState<string | null>(null)

  const rows = useMemo(() => {
    const all = Object.values(usage)
    if (range === 'all') return all
    const from = dayKey(Date.now() - (Number(range) - 1) * 864e5)
    return all.filter((r) => r.day >= from)
  }, [usage, range])

  const total = useMemo(() => {
    const t = { cost: 0, input: 0, output: 0, cached: 0, requests: 0 }
    for (const r of rows) { t.cost += rowCost(r, priceOverrides); t.input += r.input + r.cacheWrite; t.output += r.output; t.cached += r.cached; t.requests += r.requests }
    return t
  }, [rows, priceOverrides])

  const days = useMemo(() => {
    const n = range === 'all' ? Math.min(90, Math.max(7, rows.length ? Math.round((Date.now() - new Date(rows.reduce((a, r) => (r.day < a ? r.day : a), rows[0].day) + 'T00:00').getTime()) / 864e5) + 1 : 7)) : Number(range)
    const out: { day: string; cost: number; tokens: number }[] = []
    for (let i = n - 1; i >= 0; i--) out.push({ day: dayKey(Date.now() - i * 864e5), cost: 0, tokens: 0 })
    const idx = new Map(out.map((d, i) => [d.day, i]))
    for (const r of rows) { const i = idx.get(r.day); if (i !== undefined) { out[i].cost += rowCost(r, priceOverrides); out[i].tokens += r.input + r.output + r.cached + r.cacheWrite } }
    return out
  }, [rows, range, priceOverrides])

  const byModel = useMemo(() => {
    const m = new Map<string, { model: string; providerId: string; cost: number; input: number; output: number; cached: number; requests: number; images: number; unpriced: boolean }>()
    for (const r of rows) {
      const k = r.providerId + '|' + r.model
      const e = m.get(k) ?? { model: r.model, providerId: r.providerId, cost: 0, input: 0, output: 0, cached: 0, requests: 0, images: 0, unpriced: false }
      e.cost += rowCost(r, priceOverrides); e.input += r.input + r.cacheWrite; e.output += r.output; e.cached += r.cached; e.requests += r.requests; e.images += r.images ?? 0
      e.unpriced ||= rowUnpriced(r, priceOverrides)
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output))
  }, [rows, priceOverrides])

  const max = Math.max(1e-9, ...days.map((d) => d.cost))
  const anyCost = total.cost > 0
  const hit = total.input + total.cached ? Math.round((total.cached / (total.input + total.cached)) * 100) : 0
  const setPrice = (model: string, patch: Partial<{ in: number; out: number }>) => {
    const cur = useStore.getState().priceOverrides[model] ?? { in: 0, out: 0 }
    const next = { ...cur, ...patch }
    useStore.setState((s) => ({ priceOverrides: { ...s.priceOverrides, [model]: next } }))
  }
  const csv = () => {
    const head = 'day,provider,model,requests,input_tokens,output_tokens,cached_tokens,cache_write_tokens,cost_usd'
    const lines = Object.values(usage).sort((a, b) => a.day.localeCompare(b.day)).map((r) => [r.day, providers.find((p) => p.id === r.providerId)?.name ?? r.providerId, r.model, r.requests, r.input, r.output, r.cached, r.cacheWrite, rowCost(r, priceOverrides).toFixed(6)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))
    download('koko-usage.csv', [head, ...lines].join('\n'), 'text/csv')
  }

  if (!Object.keys(usage).length) {
    return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Nothing here yet. Token usage and estimated cost are recorded as you chat, and they stay on this device.</p>
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Estimated from the token counts your providers report.</p>
        <Segmented value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All time' }]} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Estimated cost" value={fmtUsd(total.cost)} sub={`${total.requests.toLocaleString()} request${total.requests === 1 ? '' : 's'}`} />
        <Stat label="Input tokens" value={fmtTokens(total.input + total.cached)} sub={total.cached ? `${hit}% from cache` : undefined} />
        <Stat label="Output tokens" value={fmtTokens(total.output)} />
        <Stat label="Per request" value={total.requests ? fmtUsd(total.cost / total.requests) : '$0'} sub="average" />
      </div>

      <section className="rounded-2xl border border-line bg-surface/50 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">{anyCost ? 'Cost per day' : 'Tokens per day'}</h3>
          <span className="text-xs tabular-nums text-muted">{hover ? (() => { const d = days.find((x) => x.day === hover)!; return `${new Date(d.day + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${anyCost ? fmtUsd(d.cost) : ''}${anyCost ? ' · ' : ''}${fmtTokens(d.tokens)} tokens` })() : ''}</span>
        </div>
        <div className="flex h-36 items-end gap-[3px]" onMouseLeave={() => setHover(null)}>
          {days.map((d) => {
            const v = anyCost ? d.cost : d.tokens
            const m = anyCost ? max : Math.max(1, ...days.map((x) => x.tokens))
            return (
              <button key={d.day} onMouseEnter={() => setHover(d.day)} onFocus={() => setHover(d.day)} title={`${d.day}: ${fmtUsd(d.cost)}`} className="group flex h-full min-w-0 flex-1 items-end">
                <span style={{ height: `${v ? Math.max(3, (v / m) * 100) : 1.5}%` }} className={cn('w-full rounded-t-[4px] transition-colors', v ? 'bg-accent group-hover:bg-fg' : 'bg-line')} />
              </button>
            )
          })}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-faint"><span>{days[0]?.day.slice(5)}</span><span>{days[days.length - 1]?.day.slice(5)}</span></div>
      </section>

      <section className="rounded-2xl border border-line bg-surface/50 p-2 sm:p-4">
        <h3 className="mb-2 px-2 text-sm font-medium sm:px-0">By model</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="text-left text-xs text-faint"><th className="py-1.5 pl-2 font-normal sm:pl-0">Model</th><th className="py-1.5 pl-5 text-right font-normal">Requests</th><th className="py-1.5 pl-5 text-right font-normal">Input</th><th className="py-1.5 pl-5 text-right font-normal">Output</th><th className="py-1.5 pl-5 pr-2 text-right font-normal sm:pr-0">Cost</th></tr></thead>
            <tbody>
              {byModel.map((m) => {
                const p = providers.find((x) => x.id === m.providerId)
                return (
                  <tr key={m.providerId + m.model} className="border-t border-line">
                    <td className="py-2.5 pl-2 sm:pl-0">
                      <div className="flex items-center gap-2.5">
                        <ModelIcon model={m.model} preset={p?.preset ?? 'custom'} name={p?.name ?? ''} size={22} />
                        <div className="min-w-0"><div className="truncate font-medium">{m.model}</div><div className="truncate text-xs text-faint">{p?.name ?? 'Removed provider'}</div></div>
                      </div>
                      {m.unpriced && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                          <span className="shrink-0">No known price. USD per 1M tokens:</span>
                          <input inputMode="decimal" placeholder="input" defaultValue={priceOverrides[m.model]?.in || ''} onBlur={(e) => setPrice(m.model, { in: Math.max(0, parseFloat(e.target.value) || 0) })} className={cn(field, 'w-20')} />
                          <input inputMode="decimal" placeholder="output" defaultValue={priceOverrides[m.model]?.out || ''} onBlur={(e) => setPrice(m.model, { out: Math.max(0, parseFloat(e.target.value) || 0) })} className={cn(field, 'w-20')} />
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pl-5 text-right tabular-nums text-muted">{m.requests.toLocaleString()}</td>
                    <td className="py-2.5 pl-5 text-right tabular-nums text-muted">{m.images && !m.input && !m.output ? `${m.images} image${m.images === 1 ? '' : 's'}` : fmtTokens(m.input + m.cached)}</td>
                    <td className="py-2.5 pl-5 text-right tabular-nums text-muted">{m.images && !m.input && !m.output ? '–' : fmtTokens(m.output)}</td>
                    <td className="py-2.5 pl-5 pr-2 text-right font-medium tabular-nums sm:pr-0">{m.unpriced && !m.cost ? <span className="text-faint">–</span> : fmtUsd(m.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs leading-relaxed text-faint">List prices from the OpenAI and Anthropic docs ({PRICES_AS_OF}). Providers that resell models (OpenRouter, relays) may charge differently. Video generation, web search and sandbox time are not included. Kept on this device only.</p>
        <div className="flex gap-2">
          <button onClick={csv} className="flex h-9 items-center gap-2 rounded-full bg-fg/8 px-4 text-sm font-medium transition hover:bg-fg/12 active:scale-95"><Download size={14} />Export CSV</button>
          <button onClick={() => { if (confirm('Erase the usage history on this device?')) useStore.setState({ usage: {} }) }} className="flex h-9 items-center gap-2 rounded-full px-3 text-sm text-muted transition hover:bg-danger/10 hover:text-danger"><Trash2 size={14} />Reset</button>
        </div>
      </div>
    </div>
  )
}
