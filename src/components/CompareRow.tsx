import { ArrowRightToLine, Check, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import type { Message } from '../types'
import { MessageView } from './Message'
import { ModelIcon } from './ModelIcon'
import { cn, fmtDuration } from '../lib/utils'

/** The replies of several models to one message, shown side by side (swipeable on phones). */
export function CompareRow({ chatId, items, last, readOnly, presets }: { chatId: string; items: { m: Message; i: number }[]; last: boolean; readOnly?: boolean; presets?: Record<string, string | undefined> }) {
  const providers = useStore((s) => s.providers)
  const wide = useStore((s) => !s.panel)
  const pickLane = useStore((s) => s.pickLane)
  const keepLane = useStore((s) => s.keepLane)
  const n = items.length
  const anyPicked = items.some((x) => x.m.cmp?.picked)

  return (
    <div className={cn(wide && 'cmp-wide')}>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 cmp-grid" style={{ ['--cols' as any]: n }}>
        {items.map(({ m }) => {
          const provider = providers.find((p) => p.id === m.cmp?.providerId) ?? providers.find((p) => p.models.some((x) => x.id === m.model))
          const picked = !!m.cmp?.picked
          const running = m.status === 'streaming'
          return (
            <div key={m.id} className={cn('flex min-w-[88%] snap-center flex-col rounded-3xl border bg-surface/60 transition-colors cmp-col', picked ? 'border-accent/60 ring-1 ring-accent/30' : 'border-line', anyPicked && !picked && 'opacity-80')}>
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                <ModelIcon model={m.model ?? ''} preset={provider?.preset ?? presets?.[m.id] ?? 'custom'} name={provider?.name ?? ''} size={22} />
                <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{m.model}</div><div className="truncate text-[11px] text-muted">{provider?.name}</div></div>
                {running ? <Loader2 size={14} className="spin shrink-0 text-accent" /> : m.durationMs ? <span className="shrink-0 text-[11px] tabular-nums text-faint">{fmtDuration(m.durationMs)}</span> : null}
                {!readOnly && <><button
                  title={picked ? 'This reply continues the conversation' : 'Use this reply as the one the conversation continues from'}
                  onClick={() => pickLane(chatId, m.id)}
                  className={cn('flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition active:scale-95', picked ? 'bg-accent text-accent-fg' : 'bg-fg/6 text-muted hover:text-fg')}
                >
                  <Check size={12} strokeWidth={3} />{picked ? 'Picked' : 'Use'}
                </button>
                <button title="Continue with only this model" onClick={() => keepLane(chatId, m.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fg/6 hover:text-fg"><ArrowRightToLine size={14} /></button></>}
              </div>
              <div className="min-w-0 flex-1 px-4 pb-3 pt-3">
                <MessageView chatId={chatId} m={m} last={last} latestUser={false} readOnly={readOnly} sharedPreset={presets?.[m.id]} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
