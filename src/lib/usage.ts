import { useStore } from '../store'
import { costOf, type Tokens } from './pricing'

/** One row of the usage ledger: everything one model used on one day. */
export interface UsageRow {
  day: string // YYYY-MM-DD (local)
  providerId: string
  model: string
  input: number
  output: number
  cached: number
  cacheWrite: number
  requests: number
  /** images generated (their cost is in `cost`) */
  images?: number
  /** USD, only for requests whose model had a known price */
  cost: number
  /** tokens of requests that had no known price (priced later if the user sets one) */
  u?: { input: number; output: number; cached: number; cacheWrite: number }
}

export const dayKey = (t = Date.now()) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add one request's token usage to the ledger (fire and forget; never throws). */
export function recordUsage(providerId: string, model: string, t: Tokens) {
  try {
    if (!t.input && !t.output && !t.cached && !t.cacheWrite) return
    const st = useStore.getState()
    const cost = costOf(model, t, st.priceOverrides)
    const day = dayKey()
    const id = `${day}|${providerId}|${model}`
    const row: UsageRow = st.usage[id] ?? { day, providerId, model, input: 0, output: 0, cached: 0, cacheWrite: 0, requests: 0, cost: 0 }
    const u = row.u ?? { input: 0, output: 0, cached: 0, cacheWrite: 0 }
    useStore.setState({
      usage: {
        ...st.usage,
        [id]: {
          ...row,
          input: row.input + t.input,
          output: row.output + t.output,
          cached: row.cached + (t.cached ?? 0),
          cacheWrite: row.cacheWrite + (t.cacheWrite ?? 0),
          requests: row.requests + 1,
          cost: row.cost + (cost ?? 0),
          ...(cost === null ? { u: { input: u.input + t.input, output: u.output + t.output, cached: u.cached + (t.cached ?? 0), cacheWrite: u.cacheWrite + (t.cacheWrite ?? 0) } } : row.u ? { u: row.u } : {}),
        },
      },
    })
  } catch { /* usage tracking must never break a chat */ }
}

/** Token usage objects from the three API formats -> uncached input / output / cache read / cache write. */
export const fromOpenAI = (u: any): Tokens | null => {
  if (!u) return null
  const cached = Number(u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0)
  const inp = Number(u.input_tokens ?? u.prompt_tokens ?? 0)
  return { input: Math.max(0, inp - cached), output: Number(u.output_tokens ?? u.completion_tokens ?? 0), cached }
}

export const fromAnthropic = (u: any): Tokens => ({
  input: Number(u?.input_tokens ?? 0),
  output: Number(u?.output_tokens ?? 0),
  cached: Number(u?.cache_read_input_tokens ?? 0),
  cacheWrite: Number(u?.cache_creation_input_tokens ?? 0),
})

/** Some providers and relays report output tokens but no input tokens. Then estimate the input from what was actually sent. */
export const fillInput = (u: Tokens, body: unknown): Tokens => {
  if (u.input + (u.cached ?? 0) + (u.cacheWrite ?? 0) > 0) return u
  const json = JSON.stringify(body).replace(/data:[^"]{200,}/g, '')
  return { ...u, input: Math.ceil(json.length / 3.6) }
}

/** An image generation: counted per image, with its cost in USD when known. */
export function recordImageUsage(providerId: string, model: string, costUsd: number | null | undefined, images = 1) {
  try {
    const st = useStore.getState()
    const day = dayKey()
    const id = `${day}|${providerId}|${model}`
    const row: UsageRow = st.usage[id] ?? { day, providerId, model, input: 0, output: 0, cached: 0, cacheWrite: 0, requests: 0, cost: 0 }
    useStore.setState({ usage: { ...st.usage, [id]: { ...row, requests: row.requests + 1, images: (row.images ?? 0) + images, cost: row.cost + (costUsd ?? 0) } } })
  } catch { /* usage tracking must never break a chat */ }
}
