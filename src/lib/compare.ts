import { useStore } from '../store'
import { toast } from './toast'

/** Turn compare mode (several models answer every message) on or off. */
export function setCompare(on?: boolean) {
  const st = useStore.getState()
  const c = st.settings.compare
  const next = on ?? !c.enabled
  if (!next) return st.setSettings({ compare: { ...c, enabled: false } })
  const all = st.providers.flatMap((p) => p.models.map((m) => ({ providerId: p.id, model: m.id })))
  if (all.length < 2) return void toast.error('Add at least two models in Settings → Providers to compare.')
  let models = c.models.filter((x) => all.some((a) => a.providerId === x.providerId && a.model === x.model))
  if (models.length < 2) {
    const sel = st.selected
    const first = sel && all.some((a) => a.providerId === sel.providerId && a.model === sel.model) ? sel : all[0]
    const second = all.find((a) => a.providerId !== first.providerId) ?? all.find((a) => a.model !== first.model)!
    models = [first, second]
  }
  st.setSettings({ compare: { enabled: true, models } })
}
