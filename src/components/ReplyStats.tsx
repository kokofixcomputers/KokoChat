import { useEffect, useState } from 'react'
import { Gauge } from 'lucide-react'
import type { ReplyStats } from '../types'
import { fmtUsd } from '../lib/pricing'
import { liveMeters } from '../lib/stats'
import { Popover } from './ui'

const time = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s` : `${Math.floor(Math.round(ms / 1000) / 60)}m ${Math.round(ms / 1000) % 60}s`)
const num = (n: number, est?: boolean) => `${est ? '~' : ''}${n.toLocaleString()}`
const speed = (n: number, est?: boolean) => `${est ? '~' : ''}${n < 10 ? n.toFixed(1) : Math.round(n)} tok/s`

const LIVE_TICK_MS = 200
const NOTHING_YET: ReplyStats = { via: '', in: 0, out: 0, modelMs: 0 }
const tenths = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** The same measurements while the reply is being generated. Only this redraws on each tick; nothing is saved. */
export function LiveReplyStats({ messageId, startedAt, model }: { messageId: string; startedAt: number; model?: string }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), LIVE_TICK_MS)
    return () => clearInterval(timer)
  }, [])
  const live = liveMeters.get(messageId)?.live()
  if (!live) return null
  const s = live.stats
  const label = [
    s?.ttft !== undefined && `${time(s.ttft)} to first`,
    s?.tps !== undefined && speed(s.tps, s.estTps),
    !!s?.out && `${num(s.out, s.estOut)} tokens`,
    live.inTools ? 'tools and waiting' : live.waitingMs !== undefined && `waiting ${tenths(live.waitingMs)}`,
  ].filter(Boolean).join(' · ') || 'generating'
  return <ReplyStatsChip live label={label} stats={s ?? NOTHING_YET} durationMs={Date.now() - startedAt} model={model} />
}

/** Compact measurements under a reply: two numbers, with the rest on hover (a summary) or select (everything). */
export function ReplyStatsChip({ stats: s, durationMs, model, live, label }: { stats: ReplyStats; durationMs?: number; model?: string; live?: boolean; label?: string }) {
  const short = label ?? ([s.ttft !== undefined && `${time(s.ttft)} to first`, s.tps !== undefined && speed(s.tps, s.estTps)].filter(Boolean).join(' · ') || `${num(s.out, s.estOut)} tokens out`)
  const hover = `First token: ${s.ttft !== undefined ? time(s.ttft) : '—'}\nOutput speed: ${s.tps !== undefined ? speed(s.tps, s.estTps) : '—'}\nTokens: ${num(s.in, s.estIn)} in, ${num(s.out, s.estOut)} out\nSelect for details`
  return (
    <Popover
      align="left" className="ml-2" panelClassName="w-72"
      button={(open, toggle) => (
        <button onClick={toggle} title={open || live ? undefined : hover} aria-expanded={open} aria-label="Reply measurements" className="flex min-h-6 items-center gap-1.5 rounded-full text-left px-2 text-xs tabular-nums text-faint transition hover:bg-fg/5 hover:text-fg">
          <Gauge size={13} className="shrink-0" />{short}
        </button>
      )}
    >
      {() => <Details s={s} durationMs={durationMs} model={model} live={live} />}
    </Popover>
  )
}

function Details({ s, durationMs, model, live }: { s: ReplyStats; durationMs?: number; model?: string; live?: boolean }) {
  const rows: [string, string | undefined | false][] = [
    ['Time to first token', s.ttft !== undefined ? time(s.ttft) : '—'],
    ['Output speed', s.tps !== undefined ? speed(s.tps, s.estTps) : '—'],
    [live ? 'Elapsed' : 'Total duration', durationMs !== undefined && time(durationMs)],
    ['Model time', time(s.modelMs)],
    ['Tools and waiting', !!s.toolMs && time(s.toolMs)],
    ['Input tokens', num(s.in, s.estIn)],
    ['  read from cache', !!s.cached && num(s.cached, s.estIn)],
    ['  written to cache', !!s.cacheWrite && num(s.cacheWrite)],
    ['Output tokens', num(s.out, s.estOut)],
    ['  reasoning', !!s.reasoning && num(s.reasoning)],
    ['Model requests', !!s.requests && String(s.requests)],
    ['Cost', s.cost !== undefined && `~${fmtUsd(s.cost)}`],
    ['Model', model],
    ['Served as', s.served],
    ['Provider', s.via || undefined],
  ]
  const notes = [
    live && 'Updating live. Estimates give way to the provider’s counts as they arrive, so numbers can shift.',
    (s.estIn || s.estOut) && '~ is an estimate from the text length: the provider did not report that count.',
    s.partial && 'The reply was stopped or failed part-way, so these cover only what arrived.',
    s.hidden && 'Hidden or summarized reasoning is left out of the speed.',
    !live && s.tps === undefined && 'No speed: too little was streamed gradually to measure it fairly.',
    !!s.requests && 'Token counts add up every request; each one sends the conversation again.',
    'First token: the first reasoning, text or tool call. Speed does not count tools or waiting for you.',
  ].filter(Boolean) as string[]
  return (
    <div className="px-2.5 py-2 text-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.filter((r) => r[1]).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className={k.startsWith('  ') ? 'pl-3 text-faint' : 'text-muted'}>{k.trim()}</dt>
            <dd className="min-w-0 break-words text-right tabular-nums text-fg">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-[11px] leading-snug text-faint">{notes.map((n) => <p key={n}>{n}</p>)}</div>
    </div>
  )
}
