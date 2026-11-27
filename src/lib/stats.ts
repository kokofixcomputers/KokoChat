import type { ReplyStats } from '../types'
import { useStore } from '../store'
import { costOf } from './pricing'
import { fillInput } from './usage'

/*
 * Power-user measurements for one reply (Settings → General, off by default).
 *
 * - First token: the first non-empty piece of reasoning, answer text or tool call that arrives. Time to first token runs
 *   from sending that request to receiving it.
 * - Output speed: output tokens ÷ the time from the first to the last token of each request, added up over all requests.
 *   Tool runs and waiting for the user happen between requests, so they never count.
 * - Hidden or summarized reasoning is not streamed as it is generated, so it is left out of the speed (both its tokens and
 *   its time). If the provider does not say how many tokens it was, that request gets no speed.
 */

/** 'summary': a summary of reasoning the model keeps to itself; its length says nothing about the tokens generated. */
export type DeltaKind = 'text' | 'tool' | 'reasoning' | 'summary'

export interface StepUsage {
  /** uncached prompt tokens */
  input: number
  /** all output tokens, reasoning included; leave out while the provider has not sent the final figure */
  output?: number
  cached?: number
  cacheWrite?: number
  reasoning?: number
}

interface Step {
  start: number
  body: unknown
  /** first and last token of any kind */
  first?: number
  last?: number
  n: number
  /** the same for answer text and tool calls only */
  aFirst?: number
  aLast?: number
  aN: number
  /** characters received, for estimates */
  aChars: number
  rChars: number
  summarized?: boolean
  rawReasoning?: boolean
  usage?: StepUsage
  /** input estimated from what was sent, for providers that report none */
  inEst?: number
}

/** Meters of the replies being generated right now, by message id, so their numbers can be shown as they change. */
export const liveMeters = new Map<string, Meter>()

const CHARS_PER_TOKEN = 4
const estTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)
const reportedInput = (u?: StepUsage) => (u ? u.input + (u.cached ?? 0) + (u.cacheWrite ?? 0) : 0)
// worked out once per request, and before the next step is added to the same message list
const inputEstimate = (s: Step) => (s.inEst ??= fillInput({ input: 0, output: 0 }, s.body).input)
// below these a speed is noise (or the server sent everything in one burst)
const MIN_STEP_MS = 100
const MIN_RATE_MS = 250
const MIN_RATE_TOKENS = 5

/** Usage from the OpenAI formats (Chat Completions and Responses). */
export function openAIStepUsage(u: any, gemini = false): StepUsage | undefined {
  if (!u) return
  const prompt = Number(u.input_tokens ?? u.prompt_tokens ?? 0)
  const completion = Number(u.output_tokens ?? u.completion_tokens ?? 0)
  const total = Number(u.total_tokens ?? 0)
  const cached = Number(u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0)
  const r = u.output_tokens_details?.reasoning_tokens ?? u.completion_tokens_details?.reasoning_tokens
  let reasoning = r === undefined || r === null ? undefined : Number(r)
  let output = completion
  // some providers (xAI, Gemini) count reasoning beside the completion tokens instead of inside them: the total shows which
  const extra = total - prompt - completion
  if (extra > 0 && (reasoning ? extra === reasoning : gemini)) { reasoning = extra; output = completion + extra }
  if (!prompt && !output) return
  return { input: Math.max(0, prompt - cached), output, cached, reasoning }
}

export class Meter {
  private open: Step | null = null
  private done: { s: Step; ms: number; complete: boolean }[] = []
  private toolMs = 0
  private toolSince?: number
  private served?: string
  private providerName: string
  private model: string

  constructor(providerName: string, model: string) { this.providerName = providerName; this.model = model }

  /** A request is about to be sent. Calling it again before any reply (a retry) restarts the clock. */
  begin(body: unknown) {
    this.open = { start: performance.now(), body, n: 0, aN: 0, aChars: 0, rChars: 0 }
  }

  delta(kind: DeltaKind, chars: number) {
    const s = this.open
    if (!s || !chars) return
    const t = performance.now()
    s.first ??= t
    s.last = t
    s.n++
    if (kind === 'text' || kind === 'tool') { s.aFirst ??= t; s.aLast = t; s.aN++; s.aChars += chars }
    else if (kind === 'reasoning') { s.rawReasoning = true; s.rChars += chars }
    else s.summarized = true
  }

  /** The model reasoned without streaming it. */
  hiddenReasoning() { if (this.open) this.open.summarized = true }

  usage(u: StepUsage | undefined) { if (this.open && u) this.open.usage = u }

  servedModel(name: unknown) { if (typeof name === 'string' && name) this.served = name }

  /** The stream of the current request finished normally. */
  end() { this.close(true) }

  toolStart() { this.toolSince = performance.now() }

  toolEnd() {
    if (this.toolSince !== undefined) this.toolMs += performance.now() - this.toolSince
    this.toolSince = undefined
  }

  private close(complete: boolean) {
    const s = this.open
    if (!s) return
    if ((s.n || s.usage) && !reportedInput(s.usage)) inputEstimate(s)
    s.body = undefined // not needed any more
    this.done.push({ s, ms: performance.now() - s.start, complete })
    this.open = null
  }

  /** Totals for the whole reply, or nothing when the model never answered. A request still open was stopped or failed. */
  result(): ReplyStats | undefined {
    this.close(false)
    return this.totals(this.done)
  }

  /** The reply so far. Counts of the request in progress are estimates until the provider reports them. */
  live(): { stats?: ReplyStats; waitingMs?: number; inTools: boolean } {
    const now = performance.now()
    const s = this.open
    const entries = s ? [...this.done, { s, ms: now - s.start, complete: false, running: true }] : this.done
    return {
      stats: this.totals(entries, this.toolSince === undefined ? 0 : now - this.toolSince),
      waitingMs: s && !s.n ? now - s.start : undefined,
      inTools: this.toolSince !== undefined,
    }
  }

  private totals(entries: { s: Step; ms: number; complete: boolean; running?: boolean }[], runningToolMs = 0): ReplyStats | undefined {
    const toolMs = this.toolMs + runningToolMs
    let ttft: number | undefined
    let input = 0, output = 0, cached = 0, cacheWrite = 0, reasoning: number | undefined
    let estIn = false, estOut = false, partial = false, hidden = false
    let modelMs = 0, rateTok = 0, rateMs = 0, rateEst = false, requests = 0
    let cost: number | undefined = 0
    for (const { s, ms, complete, running } of entries) {
      if (!s.n && !s.usage) continue // refused or cut off before anything came back
      requests++
      modelMs += ms
      if (!complete && !running) partial = true
      if (ttft === undefined && s.first !== undefined) ttft = s.first - s.start

      // a count from a cut-off stream may be a placeholder or a running figure, so it is estimated instead
      const final = complete ? s.usage?.output : undefined
      const out = final || estTokens(s.aChars + s.rChars)
      if (!final) estOut = true
      let u = { input: s.usage?.input ?? 0, output: out, cached: s.usage?.cached ?? 0, cacheWrite: s.usage?.cacheWrite ?? 0 }
      if (!(u.input + u.cached + u.cacheWrite)) { u.input = inputEstimate(s); estIn = true }
      input += u.input + u.cached + u.cacheWrite
      output += out
      cached += u.cached
      cacheWrite += u.cacheWrite
      const r = s.usage?.reasoning
      if (r !== undefined) reasoning = (reasoning ?? 0) + r
      const c = costOf(this.model, u, useStore.getState().priceOverrides)
      cost = cost === undefined || c === null ? undefined : cost + c

      const unseen = !!s.summarized || (!!r && !s.rawReasoning)
      if (unseen) hidden = true
      let tok: number, from: number | undefined, to: number | undefined, n: number
      if (!unseen) { tok = out; from = s.first; to = s.last; n = s.n }
      else {
        if (final && r === undefined) continue // unknown share of the output was never streamed
        tok = final ? final - r! : estTokens(s.aChars)
        from = s.aFirst; to = s.aLast; n = s.aN
      }
      if (tok > 0 && n > 1 && to! - from! >= MIN_STEP_MS) {
        rateTok += tok
        rateMs += to! - from!
        if (!final) rateEst = true
      }
    }
    if (!requests) return
    const measurable = rateMs >= MIN_RATE_MS && rateTok >= MIN_RATE_TOKENS
    return {
      via: this.providerName,
      ...(this.served && this.served !== this.model ? { served: this.served } : {}),
      ...(ttft !== undefined ? { ttft: Math.round(ttft) } : {}),
      ...(measurable ? { tps: Math.round((rateTok / rateMs) * 10000) / 10 } : {}),
      ...(measurable && rateEst ? { estTps: true } : {}),
      in: input, out: output,
      ...(estIn ? { estIn } : {}),
      ...(estOut ? { estOut } : {}),
      ...(cached ? { cached } : {}),
      ...(cacheWrite ? { cacheWrite } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(hidden ? { hidden } : {}),
      ...(partial ? { partial } : {}),
      ...(requests > 1 ? { requests } : {}),
      modelMs: Math.round(modelMs),
      ...(toolMs >= 1 ? { toolMs: Math.round(toolMs) } : {}),
      ...(cost ? { cost: Number(cost.toPrecision(4)) } : {}),
    }
  }
}
