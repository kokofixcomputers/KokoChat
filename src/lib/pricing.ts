/** API prices in USD per 1M tokens. Source: OpenAI and Anthropic pricing pages, fetched 2026-11-24. */
export interface Tier { over: number; in: number; cached?: number; write?: number; out: number }

export interface Price {
  /** uncached input */
  in: number
  /** cache hit (read) */
  cached?: number
  /** cache write (Anthropic) */
  write?: number
  out: number
  /** higher tier once a single prompt passes this many tokens */
  long?: Tier | Tier[]
  /** a scheduled price change (YYYY-MM-DD) */
  then?: { from: string; in: number; cached?: number; out: number }
}

export const PRICES_AS_OF = '2026-11-24'

const P = (i: number, c: number | undefined, o: number, w?: number): Price => ({ in: i, cached: c, out: o, write: w })

/** key = model id prefix (matched at a "-" boundary, longest first) */
const TABLE: Record<string, Price> = {
  // OpenAI
  'gpt-6.2-astra': P(8, 0.4, 40), 'gpt-6.2-sol': P(2, 0.1, 10), 'gpt-6-astra': P(10, 1, 50), 'gpt-6.1-sol': P(2, 0.1, 10),
  'gpt-6.1-terra': P(1, 0.05, 5), 'gpt-6-luna': P(0.1, 0.01, 0.5), 'gpt-6-sol': P(2, 0.2, 10),
  'gpt-5.6-sol': P(4, 0.4, 20), 'gpt-5.6-terra': P(2, 0.2, 12), 'gpt-5.6-luna': P(0.2, 0.02, 1.2),
  'gpt-5.5-pro': P(30, undefined, 180), 'gpt-5.5': P(5, 0.5, 30),
  'gpt-5.4-pro': P(30, undefined, 180), 'gpt-5.4-mini': P(0.75, 0.075, 4.5), 'gpt-5.4-nano': P(0.2, 0.02, 1.25), 'gpt-5.4': P(2.5, 0.25, 15),
  'gpt-5.3-codex': P(1.75, 0.175, 14),
  'gpt-5.2-pro': P(21, undefined, 168), 'gpt-5.2': P(1.75, 0.175, 14),
  'gpt-5.1': P(1.25, 0.125, 10),
  'gpt-5-pro': P(15, undefined, 120), 'gpt-5-mini': P(0.25, 0.025, 2), 'gpt-5-nano': P(0.05, 0.005, 0.4), 'gpt-5': P(1.25, 0.125, 10),
  'gpt-4.1-nano': P(0.1, 0.025, 0.4), 'gpt-4.1-mini': P(0.4, 0.1, 1.6), 'gpt-4.1': P(2, 0.5, 8),
  'gpt-4o-mini': P(0.15, 0.075, 0.6), 'gpt-4o': P(2.5, 1.25, 10),
  'o3-pro': P(20, undefined, 80), 'o3-mini': P(1.1, 0.55, 4.4), 'o3': P(2, 0.5, 8), 'o4-mini': P(1.1, 0.275, 4.4),
  'text-embedding-3-small': P(0.02, undefined, 0), 'text-embedding-3-large': P(0.13, undefined, 0), 'text-embedding-ada-002': P(0.1, undefined, 0),
  // Anthropic (ids are normalised: dots -> dashes, date suffix removed)
  'claude-fable-5-2': P(8, 0.2, 40, 10), 'claude-mythos-5-2': P(8, 0.2, 40, 10),
  'claude-fable-5-1': P(10, 0.25, 50, 12.5), 'claude-mythos-5-1': P(10, 0.25, 50, 12.5),
  'claude-fable-5': P(10, 1, 50, 12.5), 'claude-mythos-5': P(10, 1, 50, 12.5),
  'claude-opus-5-5': P(4, 0.2, 20, 5), 'claude-opus-5': P(5, 0.5, 25, 6.25),
  'claude-opus-4-8': P(5, 0.5, 25, 6.25), 'claude-opus-4-7': P(5, 0.5, 25, 6.25), 'claude-opus-4-6': P(5, 0.5, 25, 6.25), 'claude-opus-4-5': P(5, 0.5, 25, 6.25),
  'claude-opus-4-1': P(15, 1.5, 75, 18.75), 'claude-opus-4': P(15, 1.5, 75, 18.75),
  'claude-sonnet-5-5': P(2, 0.1, 10, 2.5), 'claude-sonnet-5': P(2, 0.2, 10, 2.5),
  'claude-sonnet-4-6': P(3, 0.3, 15, 3.75), 'claude-sonnet-4-5': P(3, 0.3, 15, 3.75), 'claude-sonnet-4': P(3, 0.3, 15, 3.75),
  'claude-haiku-5-5': { in: 0.1, cached: 0.01, write: 0.125, out: 0.5, long: { over: 100_000, in: 0.5, cached: 0.05, write: 0.625, out: 2.5 } },
  'claude-haiku-4-5': P(1, 0.1, 5, 1.25),
}

const G = (i: number, c: number, o: number, long?: Tier): Price => ({ in: i, cached: c, out: o, ...(long ? { long } : {}) })
const SOON = (p: Price, from: string, i: number, c: number, o: number): Price => ({ ...p, then: { from, in: i, cached: c, out: o } })

// Google Gemini and Z.ai GLM (pages fetched 2026-11-24)
Object.assign(TABLE, {
  'gemini-4-carbon': SOON(G(2, 0.1, 10), '2026-12-01', 4, 0.2, 20), 'gemini-4-argon': SOON(G(2, 0.1, 10), '2026-12-01', 4, 0.2, 20),
  'gemini-4-neon': G(3, 0.15, 15), 'gemini-4-hydrogen': G(1.5, 0.075, 7.5),
  'gemini-3.8-flash': SOON(G(0.75, 0.075, 3.75), '2027-01-01', 1.5, 0.15, 7.5), 'gemini-3.6-flash': SOON(G(0.75, 0.075, 3.75), '2027-01-01', 1.5, 0.15, 7.5),
  'gemini-3.5-flash-lite': G(0.3, 0.03, 2.5), 'gemini-3.1-flash-lite': G(0.25, 0.025, 1.5), 'gemini-3-flash': G(0.5, 0.05, 3),
  'gemini-3.1-pro': G(2, 0.2, 12, { over: 200_000, in: 4, cached: 0.4, out: 18 }),
  'gemini-2.5-pro': G(1.25, 0.125, 10, { over: 200_000, in: 2.5, cached: 0.25, out: 15 }),
  'gemini-2.5-flash-lite': G(0.1, 0.01, 0.4), 'gemini-2.5-flash': G(0.3, 0.03, 2.5),
  'gemini-robotics-er-2': SOON(G(1, 0.1, 5), '2026-12-31', 2, 0.2, 10),
  'gemini-embedding-2': P(0.2, undefined, 0), 'gemini-embedding-001': P(0.15, undefined, 0),
  'glm-5.3-flashx': P(0.37, 0.075, 1.25), 'glm-5.3-flash': P(0.15, 0.03, 0.5), 'glm-5.3': P(1.4, 0.26, 4.4), 'glm-5.2': P(1.4, 0.26, 4.4), 'glm-5.1': P(1.4, 0.26, 4.4), 'glm-5': P(1, 0.2, 3.2),
  'glm-4.7-flashx': P(0.07, 0.01, 0.4), 'glm-4.7-flash': P(0, 0, 0), 'glm-4.7': P(0.6, 0.11, 2.2), 'glm-4.6': P(0.6, 0.11, 2.2),
  'glm-4.5-flash': P(0, 0, 0), 'glm-4.5-airx': P(1.1, 0.22, 4.5), 'glm-4.5-air': P(0.2, 0.03, 1.1), 'glm-4.5-x': P(2.2, 0.45, 8.9), 'glm-4.5': P(0.6, 0.11, 2.2),
  'glm-4-32b-0414-128k': P(0.1, undefined, 0.1),
} satisfies Record<string, Price>)

// Alibaba Qwen (Model Studio, Singapore list prices, non-thinking output; per request tier by input length)
const Q = (i: number, o: number, ...tiers: [number, number, number][]): Price => ({ in: i, out: o, ...(tiers.length ? { long: tiers.map(([over, ti, to]) => ({ over, in: ti, out: to })) } : {}) })
Object.assign(TABLE, {
  'qwen4-max': Q(1.5, 4.5), 'qwen3.8-max': Q(2, 6), 'qwen3.7-max': Q(2.5, 7.5), 'qwen-max': Q(1.6, 6.4),
  'qwen3.7-plus': Q(0.4, 1.6, [256_000, 1.2, 4.8]), 'qwen3.6-plus': Q(0.5, 3, [256_000, 2, 6]), 'qwen3.5-plus': Q(0.4, 2.4, [256_000, 0.5, 3]), 'qwen-plus': Q(0.4, 1.2, [256_000, 1.2, 3.6]),
  'qwen3.8-flash': Q(0.15, 0.47), 'qwen3.7-flash': Q(0.03, 0.13, [32_000, 0.1, 0.4], [256_000, 0.2, 0.8]), 'qwen3.6-flash': Q(0.25, 1.5, [256_000, 1, 4]), 'qwen3.5-flash': Q(0.1, 0.4), 'qwen-flash': Q(0.05, 0.4, [256_000, 0.25, 2]),
  'qwen3-coder-flash': Q(0.3, 1.5, [32_000, 0.5, 2.5], [128_000, 0.8, 4], [256_000, 1.6, 9.6]),
  'qwen3.8-2.4t-a95b': Q(2, 6), 'qwen3.8-27b': Q(0.5, 3), 'qwen3.6-35b-a3b': Q(0.375, 2.25), 'qwen3.6-27b': Q(0.6, 3.6), 'qwen3.5-397b-a17b': Q(0.6, 3.6), 'qwen3.5-122b-a10b': Q(0.4, 3.2), 'qwen3.5-27b': Q(0.3, 2.4), 'qwen3.5-35b-a3b': Q(0.25, 2),
  'qwen-mt-plus': Q(2.46, 7.37), 'qwen-mt-flash': Q(0.16, 0.49), 'qwen-mt-lite': Q(0.12, 0.36),
} satisfies Record<string, Price>)

const KEYS = Object.keys(TABLE).sort((a, b) => b.length - a.length)

/** "anthropic/claude-sonnet-4.5-20250929" -> "claude-sonnet-4-5" */
export const normalizeModel = (id: string) => {
  let m = id.toLowerCase().trim()
  m = m.slice(m.lastIndexOf('/') + 1).replace(/^models\//, '')
  if (m.startsWith('claude')) m = m.replace(/\./g, '-').replace(/-(\d{8}|latest)$/, '')
  return m.replace(/:.*$/, '')
}

export type Overrides = Record<string, { in: number; out: number; cached?: number }>

export function priceFor(model: string, overrides?: Overrides): Price | null {
  const m = normalizeModel(model)
  const o = overrides?.[model] ?? overrides?.[m]
  if (o) return { in: o.in, out: o.out, cached: o.cached }
  for (const k of KEYS) if (m === k || (m.startsWith(k) && /^[-]/.test(m.slice(k.length)))) return TABLE[k]
  return null
}

export interface Tokens { input: number; output: number; cached?: number; cacheWrite?: number }

/** Cost of one request in USD (input = uncached prompt tokens). null when the model has no known price. */
export function costOf(model: string, t: Tokens, overrides?: Overrides): number | null {
  const base = priceFor(model, overrides)
  if (!base) return null
  const total = t.input + (t.cached ?? 0) + (t.cacheWrite ?? 0)
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const cur = base.then && today >= base.then.from ? { ...base, ...base.then } : base
  const tier = ([] as Tier[]).concat(cur.long ?? []).filter((t) => total > t.over).pop()
  const p = tier ? { ...cur, ...tier } : cur
  return (t.input * p.in + (t.cached ?? 0) * (p.cached ?? p.in) + (t.cacheWrite ?? 0) * (p.write ?? p.in) + t.output * p.out) / 1e6
}

export const fmtUsd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString()}`)
export const fmtTokens = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K` : String(Math.round(n)))

/* ------------------------------ image generation ------------------------------ */
// Per image, USD, 1K output (OpenAI, xAI, Google and Alibaba docs, 2026-11-24). Where a provider reports real usage or cost we use that instead.
interface ImagePrice { perImage?: number; /** 2K price */ perImage2k?: number; /** low / medium / high estimate for token-billed models */ est?: [number, number, number]; /** token prices per 1M: text in, image in, image out */ tokens?: [number, number, number] }
const IMG: Record<string, ImagePrice> = {
  'gpt-image-2': { tokens: [5, 8, 30], est: [0.011, 0.042, 0.167] }, 'gpt-image-1.5': { tokens: [5, 8, 32], est: [0.011, 0.042, 0.167] }, 'chatgpt-image-latest': { tokens: [5, 8, 32], est: [0.011, 0.042, 0.167] },
  'gpt-image-1-mini': { tokens: [2, 2.5, 8], est: [0.005, 0.011, 0.036] }, 'gpt-image-1': { tokens: [5, 10, 40], est: [0.011, 0.042, 0.167] },
  'dall-e-3': { est: [0.04, 0.04, 0.08] }, 'dall-e-2': { perImage: 0.02 },
  'grok-imagine-image-2.0': { perImage: 0.04 }, 'grok-imagine-image': { perImage: 0.02 },
  'gemini-nano-banana-2.1': { perImage: 0.0336, perImage2k: 0.0504 }, 'gemini-3.1-flash-lite-image': { perImage: 0.0336 }, 'gemini-3.1-flash-image': { perImage: 0.067, perImage2k: 0.101 },
  'gemini-3-pro-image': { perImage: 0.134, perImage2k: 0.134 }, 'gemini-2.5-flash-image': { perImage: 0.039 },
  'qwen-image-2.0-pro': { perImage: 0.075 }, 'qwen-image-2.0': { perImage: 0.035 }, 'qwen-image-2.1-pro': { perImage: 0.04 }, 'qwen-image-2.1-turbo': { perImage: 0.016 },
  'qwen-image-3.0-pro': { perImage: 0.04, perImage2k: 0.075 }, 'qwen-image-3.0': { perImage: 0.03 },
  'wan2.6-t2i': { perImage: 0.03 }, 'z-image-turbo': { perImage: 0.015 },
}
const IMG_KEYS = Object.keys(IMG).sort((a, b) => b.length - a.length)

export function imageCost(model: string, o: { quality?: string; size?: string; usage?: any }): number | null {
  const m = normalizeModel(model)
  const k = IMG_KEYS.find((x) => m === x || (m.startsWith(x) && m[x.length] === '-'))
  if (!k) return null
  const p = IMG[k]
  const u = o.usage
  if (p.tokens && u && (u.output_tokens || u.input_tokens)) {
    const d = u.input_tokens_details ?? {}
    const text = Number(d.text_tokens ?? u.input_tokens ?? 0)
    const img = Number(d.image_tokens ?? 0)
    return (text * p.tokens[0] + img * p.tokens[1] + Number(u.output_tokens ?? 0) * p.tokens[2]) / 1e6
  }
  if (p.est) return p.est[o.quality === 'low' ? 0 : o.quality === 'high' ? 2 : 1]
  return o.size === '2K' && p.perImage2k ? p.perImage2k : p.perImage ?? null
}
