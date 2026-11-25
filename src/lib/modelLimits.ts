import { normalizeModel } from './pricing'

/** Context window and max output (tokens) per model. Sources: OpenAI, Anthropic, Google, Z.ai and Alibaba model docs, 2026-11-24. */
export interface Limits { context: number; maxOut?: number }

const K = 1000
const M = 1_000_000
const L = (context: number, maxOut?: number): Limits => ({ context, maxOut })
const ONE = L(1_050_000, 128 * K) // GPT-5.4+ and GPT-6 flagships

/** key = model id prefix (matched at a "-" boundary, longest first) */
const TABLE: Record<string, Limits> = {
  // OpenAI
  'gpt-6.2-astra': ONE, 'gpt-6.2-sol': ONE, 'gpt-6.1-terra': ONE, 'gpt-6.1-sol': ONE, 'gpt-6-luna': ONE, 'gpt-6-astra': ONE, 'gpt-6-sol': ONE,
  'gpt-5.6-sol': ONE, 'gpt-5.6-terra': ONE, 'gpt-5.6-luna': ONE, 'gpt-5.5-pro': ONE, 'gpt-5.5': ONE, 'gpt-5.4-pro': ONE, 'gpt-5.4': ONE,
  'gpt-5.4-mini': L(400 * K, 128 * K), 'gpt-5.4-nano': L(400 * K, 128 * K), 'gpt-5.3-codex': L(400 * K, 128 * K), 'gpt-5.2-pro': L(400 * K, 128 * K), 'gpt-5.2': L(400 * K, 128 * K),
  'gpt-5.1': L(400 * K, 128 * K), 'gpt-5-pro': L(400 * K, 272 * K), 'gpt-5': L(400 * K, 128 * K),
  'gpt-4.1': L(1_047_576, 32_768), 'gpt-4o': L(128 * K, 16_384), 'gpt-4-turbo': L(128 * K, 4096), 'gpt-3.5-turbo': L(16_385, 4096),
  'o3': L(200 * K, 100 * K), 'o3-pro': L(200 * K, 100 * K), 'o3-mini': L(200 * K, 100 * K), 'o4-mini': L(200 * K, 100 * K),
  // Anthropic
  'claude-fable-5-2': L(M, 128 * K), 'claude-fable-5-1': L(M, 128 * K), 'claude-fable-5': L(M, 128 * K),
  'claude-mythos-5-2': L(M, 128 * K), 'claude-mythos-5-1': L(M, 128 * K), 'claude-mythos-5': L(M, 128 * K),
  'claude-opus-5-5': L(M, 128 * K), 'claude-opus-5': L(M, 128 * K), 'claude-opus-4-8': L(M, 128 * K), 'claude-opus-4-7': L(M, 128 * K), 'claude-opus-4-6': L(M, 128 * K),
  'claude-sonnet-5-5': L(M, 128 * K), 'claude-sonnet-5': L(M, 128 * K), 'claude-sonnet-4-6': L(M, 128 * K), 'claude-haiku-5-5': L(M, 128 * K),
  'claude-opus-4-5': L(200 * K, 64 * K), 'claude-sonnet-4-5': L(200 * K, 64 * K), 'claude-haiku-4-5': L(200 * K, 64 * K),
  'claude-opus-4-1': L(200 * K, 32 * K), 'claude-opus-4': L(200 * K, 32 * K), 'claude-sonnet-4': L(200 * K, 64 * K),
  // Google Gemini (only 3.8 Flash and the 4 family were read from the docs; the older ids use Google's long-standing 1M / 64K)
  'gemini-4-carbon': L(1_048_576, 65_536), 'gemini-4-argon': L(1_048_576, 65_536), 'gemini-4-neon': L(1_048_576, 65_536), 'gemini-4-hydrogen': L(1_048_576, 65_536),
  'gemini-3.8-flash': L(1_048_576, 65_536), 'gemini-3.6-flash': L(1_048_576, 65_536), 'gemini-3.5-flash-lite': L(1_048_576, 65_536), 'gemini-3.1-pro': L(1_048_576, 65_536),
  'gemini-3.1-flash-lite': L(1_048_576, 65_536), 'gemini-3-flash': L(1_048_576, 65_536), 'gemini-2.5-pro': L(1_048_576, 65_536), 'gemini-2.5-flash': L(1_048_576, 65_536),
  // Z.ai GLM (5.2+ read from the docs; older ones from earlier model cards)
  'glm-5.4': L(M, 128 * K), 'glm-5.3': L(M, 128 * K), 'glm-5.2': L(M, 128 * K),
  'glm-5.1': L(200 * K, 128 * K), 'glm-5': L(200 * K, 128 * K), 'glm-4.7': L(200 * K, 128 * K), 'glm-4.6': L(200 * K, 128 * K), 'glm-4.5': L(128 * K, 96 * K),
  // Alibaba Qwen
  'qwen4-max': L(M, 131_072), 'qwen3.8-max': L(M, 131_072), 'qwen3.8-flash': L(M, 131_072), 'qwen3.7-plus': L(M, 131_072),
  'qwen3.7-max': L(M), 'qwen3.7-flash': L(M), 'qwen3.6-plus': L(M), 'qwen3.6-flash': L(M), 'qwen3.5-plus': L(M), 'qwen3.5-flash': L(M),
  'qwen-plus': L(M), 'qwen-flash': L(M), 'qwen3-coder-flash': L(M), 'qwen-max': L(131_072),
}

const KEYS = Object.keys(TABLE).sort((a, b) => b.length - a.length)

export function limitsFor(model: string | undefined): Limits | null {
  if (!model) return null
  const m = normalizeModel(model)
  for (const k of KEYS) if (m === k || (m.startsWith(k) && m[k.length] === '-')) return TABLE[k]
  return null
}
