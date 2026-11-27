import { modelBadges } from '../lib/modelBadges'
import type { ModelInfo, Provider } from '../types'
import { cn } from '../lib/utils'

/** The small labels beside a model's name in a model list. `compact` keeps only the cost ones, for narrow lists. */
export function ModelBadges({ provider, id, info, compact }: { provider: Pick<Provider, 'preset'> & { baseUrl?: string; models?: ModelInfo[] }; id: string; info?: ModelInfo; compact?: boolean }) {
  const list = modelBadges(provider.preset, id, info ?? provider.models?.find((m) => m.id === id), provider.baseUrl).filter((b) => !compact || b.tone === 'free')
  if (!list.length) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {list.map((b) => <span key={b.label} title={b.hint} className={cn('rounded-md px-1.5 py-px text-[10.5px] font-semibold leading-4', b.tone === 'free' ? 'bg-accent-soft text-accent' : 'bg-fg/6 font-medium text-muted')}>{b.label}</span>)}
    </span>
  )
}
