import { useStore } from '../store'
import { PARAMS, type Param } from '../lib/advanced'
import type { AdvancedSettings as Values } from '../types'
import { Toggle } from './ui'

function ParamRow({ p, value, onChange }: { p: Param; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const set = value !== undefined
  return (
    <div className="border-t border-line pt-3.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1 text-sm font-medium">{p.label} <code className="ml-1 rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted">{p.api}</code></div>
        <span className="text-xs text-muted">{set ? 'Custom' : 'Model default'}</span>
        <Toggle on={set} onChange={(on) => onChange(on ? p.start : undefined)} />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{p.description}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">{p.works}</p>
      {set && (
        <div className="mt-2.5 flex items-center gap-3">
          <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" />
          <input type="number" aria-label={`${p.label} value`} min={p.min} max={p.max} step={p.step} value={value} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) onChange(Math.min(p.max, n)) }} onBlur={() => { if (value < p.min) onChange(p.min) }} className="h-8 w-24 rounded-xl border border-line bg-surface-2/60 px-2.5 text-right font-mono text-xs" />
        </div>
      )}
    </div>
  )
}

export function AdvancedSettings() {
  const adv = useStore((s) => s.settings.advanced)
  const setSettings = useStore((s) => s.setSettings)
  const change = (patch: Partial<Values>) => setSettings({ advanced: { ...adv, enabled: !!adv?.enabled, ...patch } })
  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-sm font-medium">Advanced model settings</div><div className="text-xs text-muted">Control how models write, such as temperature and reply length. Applies to chat replies with every model, not to Code sessions. Turning this off keeps your values but stops sending them.</div></div>
        <Toggle on={!!adv?.enabled} onChange={(enabled) => change({ enabled })} />
      </div>
      {adv?.enabled && (
        <>
          <p className="text-xs leading-relaxed text-muted">Leave a setting on “Model default” unless you want to change it. Not every model accepts every setting: if a reply fails after changing one, set it back.</p>
          {PARAMS.map((p) => <ParamRow key={p.key} p={p} value={adv[p.key]} onChange={(v) => change({ [p.key]: v })} />)}
          <button onClick={() => setSettings({ advanced: { enabled: true } })} className="self-start rounded-full bg-fg/8 px-3.5 py-1.5 text-xs font-medium hover:bg-fg/12">Reset all to model defaults</button>
        </>
      )}
    </section>
  )
}
