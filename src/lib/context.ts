import type { Chat, ChatSummary, McpServer, Message, Provider, Settings } from '../types'
import { completeText } from './complete'
import { memoryBlock } from './memory'
import { toolList } from './toolset'
import { CREATE_ARTIFACT, GENERATE_IMAGE, GENERATE_VIDEO, ASK_USER, WEB_SEARCH, systemPrompt } from './tools'
import { userTextForModel } from './images'
import { integrationPromptsFor } from './integrations'
import { resolveForModel } from './lanes'
import { limitsFor } from './modelLimits'

/* ------------------------- context window sizes ------------------------ */
const WINDOWS: [RegExp, number][] = [
  [/gpt-4\.1/, 1_000_000],
  [/gpt-5/, 400_000],
  [/gpt-4o|gpt-4-turbo|gpt-4\.5/, 128_000],
  [/gpt-3\.5/, 16_385],
  [/^o\d|(^|[/-])o[134]-/, 200_000],
  [/claude/, 200_000],
  [/gemini/, 1_000_000],
  [/grok-4-fast/, 2_000_000],
  [/grok-4/, 256_000],
  [/grok/, 131_072],
  [/deepseek/, 128_000],
  [/qwen/, 131_072],
  [/llama|mistral|mixtral|ministral|magistral|glm|gpt-oss|command/, 128_000],
]

export const contextWindowFor = (model: string | undefined, override = 0) => {
  if (override > 0) return override
  const known = limitsFor(model)
  if (known) return known.context
  const id = (model ?? '').split('/').pop()!.toLowerCase()
  return WINDOWS.find(([re]) => re.test(id))?.[1] ?? 128_000
}

/* ------------------------------ estimating ----------------------------- */
export const tokensOf = (s: string) => Math.ceil(s.length / 3.6)
const IMAGE_TOKENS = 900
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) : t)

export type SegId = 'system' | 'instructions' | 'chat' | 'tools' | 'messages' | 'files' | 'images' | 'toolresults' | 'artifacts' | 'summary' | 'draft'
export interface Segment { id: SegId; label: string; tokens: number; color: string; hint: string }

const META: Record<SegId, { label: string; color: string; hint: string }> = {
  system: { label: 'System prompt', color: '#6366f1', hint: 'Your global system prompt and basics' },
  instructions: { label: 'Tool instructions', color: '#8b5cf6', hint: 'How the AI should use search, artifacts, images and questions' },
  chat: { label: 'Chat instructions', color: '#ec4899', hint: 'Custom instructions for this chat' },
  tools: { label: 'Tool definitions', color: '#f59e0b', hint: 'Schemas for enabled tools and MCP servers' },
  messages: { label: 'Messages', color: '#10a37f', hint: 'What you and the AI said' },
  files: { label: 'Attached files', color: '#06b6d4', hint: 'Text and code files you attached' },
  images: { label: 'Images', color: '#3b82f6', hint: 'Images you attached (estimated)' },
  toolresults: { label: 'Tool results', color: '#ef4444', hint: 'Search results and other tool output' },
  artifacts: { label: 'Artifacts', color: '#84cc16', hint: 'Content of artifacts the AI created' },
  summary: { label: 'Compacted summary', color: '#a1a1aa', hint: 'Summary standing in for older messages' },
  draft: { label: 'Draft', color: '#d4d4d8', hint: 'What you are typing now' },
}

export function applySummary(history: Message[], summary?: ChatSummary): { messages: Message[]; note: string } {
  if (!summary) return { messages: history, note: '' }
  const idx = history.findIndex((m) => m.id === summary.upToMessageId)
  if (idx < 0) return { messages: history, note: '' }
  return {
    messages: history.slice(idx + 1),
    note: `Summary of the earlier part of this conversation (older messages were compacted to save space):\n${summary.text}`,
  }
}

export interface EstimateInput {
  settings: Settings
  providers: Provider[]
  mcpServers: McpServer[]
  chat?: Pick<Chat, 'messages' | 'summary' | 'system'>
  history?: Message[]
  model?: string
  draft?: { text: string; files: number; images: number; fileChars: number }
}

export function estimateContext(i: EstimateInput) {
  const { settings, providers, mcpServers } = i
  const chatSystem = [i.chat?.system, i.chat ? memoryBlock(i.chat as any) : ''].filter(Boolean).join('\n\n') || undefined
  const defs = toolList({ settings, providers, mcpServers, chatId: (i.chat as any)?.id })
  const names = new Set(defs.map((d) => d.name))
  const flags = [names.has(WEB_SEARCH.name), names.has(CREATE_ARTIFACT.name), names.has(GENERATE_IMAGE.name), names.has(ASK_USER.name)] as const
  const base = systemPrompt(settings, false, false, undefined)
  const withChat = systemPrompt(settings, false, false, chatSystem)
  const full = systemPrompt(settings, flags[0], flags[1], chatSystem, flags[2], flags[3], names.has('sandbox_exec'), integrationPromptsFor(defs), names.has(GENERATE_VIDEO.name))

  const seg: Record<SegId, number> = { system: tokensOf(base), chat: tokensOf(withChat) - tokensOf(base), instructions: Math.max(0, tokensOf(full) - tokensOf(withChat)), tools: tokensOf(JSON.stringify(defs)), messages: 0, files: 0, images: 0, toolresults: 0, artifacts: 0, summary: 0, draft: 0 }

  const all = resolveForModel(i.history ?? i.chat?.messages ?? [])
  const { messages, note } = applySummary(all, i.chat?.summary)
  seg.summary = note ? tokensOf(note) : 0

  for (const m of messages) {
    if (m.role === 'user') {
      seg.messages += tokensOf((m.text ?? '') + (m.quotes ?? []).join('\n'))
      for (const a of m.attachments ?? []) {
        if (a.kind === 'text') seg.files += tokensOf(a.text ?? '') + 12
        else seg.images += IMAGE_TOKENS
      }
    } else {
      for (const b of m.blocks ?? []) {
        if (b.type === 'text') seg.messages += tokensOf(b.text)
        else if (b.type === 'tool' && b.status !== 'running' && !['create_artifact', 'create_presentation', 'generate_image', 'generate_video'].includes(b.name)) seg.toolresults += tokensOf(b.args + clip(b.result ?? '', 6000))
      }
      for (const a of m.artifacts ?? []) seg.artifacts += a.kind === 'image' || a.kind === 'video' ? 40 : tokensOf(clip(a.content, 14000)) + 30
    }
  }
  if (i.draft) {
    seg.draft = tokensOf(i.draft.text) + Math.ceil(i.draft.fileChars / 3.6) + i.draft.images * IMAGE_TOKENS
  }

  const segments: Segment[] = (Object.keys(seg) as SegId[])
    .map((id) => ({ id, tokens: Math.max(0, seg[id]), ...META[id] }))
    .filter((s) => s.tokens > 0)
  const total = segments.reduce((a, s) => a + s.tokens, 0)
  const window = contextWindowFor(i.model, settings.contextWindow)
  return { segments, total, window, pct: total / window }
}

/* ------------------------------ compaction ----------------------------- */
const SUMMARY_INSTRUCTIONS = `You compact long conversations so an AI assistant can continue them seamlessly with less context.
Write a faithful, dense summary of the conversation so far. Preserve: the user's goals and constraints, decisions made and why, important facts, numbers, names, file names, identifiers and code snippets that matter, user preferences, open tasks and unanswered questions, and the essentials of any tool results (key findings with their source URLs) and artifacts created (title, type and purpose; keep short code verbatim only if still needed).
Do not add commentary, greetings or a preamble. Use compact bullet points grouped by topic. Never invent details.`

/** Index of the first message to keep raw: the start of the second-to-last user turn. */
export function compactionCut(messages: Message[]): number {
  const users = messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0)
  return users.length >= 3 ? users[users.length - 2] : -1
}

export function canCompact(messages: Message[], summary?: ChatSummary) {
  const cut = compactionCut(messages)
  if (cut < 1) return false
  const prev = summary ? messages.findIndex((m) => m.id === summary.upToMessageId) : -1
  return cut - 1 > prev
}

function serialize(messages: Message[]) {
  const out: string[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const bits = [userTextForModel(m.text, m.attachments, m.quotes)]
      const imgs = (m.attachments ?? []).filter((a) => a.kind !== 'text').length
      out.push(`USER: ${clip(bits.filter(Boolean).join('\n'), 6000)}${imgs ? ` [${imgs} image(s) attached]` : ''}`)
    } else {
      const parts: string[] = []
      for (const b of m.blocks ?? []) {
        if (b.type === 'text') parts.push(clip(b.text, 6000))
        else if (b.type === 'tool' && b.name !== 'create_artifact' && b.name !== 'create_presentation') parts.push(`[tool ${b.name} ${clip(b.args, 300)} -> ${clip(b.result ?? '', 1500)}]`)
      }
      for (const a of m.artifacts ?? []) parts.push(`[artifact "${a.title}" (${a.kind})${a.kind === 'image' || a.kind === 'video' ? '' : ': ' + clip(a.content, 1500)}]`)
      out.push(`ASSISTANT: ${parts.join('\n')}`)
    }
  }
  let text = out.join('\n\n')
  if (text.length > 400_000) text = text.slice(0, 200_000) + '\n\n…[middle omitted]…\n\n' + text.slice(-200_000)
  return text
}

export async function runCompaction(p: Provider, model: string, messages: Message[], prev?: ChatSummary, focus?: string, signal?: AbortSignal): Promise<ChatSummary | null> {
  const cut = compactionCut(messages)
  if (cut < 1) return null
  const prevIdx = prev ? messages.findIndex((m) => m.id === prev.upToMessageId) : -1
  const slice = messages.slice(prevIdx + 1, cut)
  if (!slice.length) return null
  const input = [
    prevIdx >= 0 && prev ? `SUMMARY OF EVEN EARLIER MESSAGES:\n${prev.text}\n` : '',
    `MESSAGES TO FOLD INTO THE SUMMARY:\n\n${serialize(slice)}`,
    focus?.trim() ? `\nThe user asks you to especially preserve: ${focus.trim()}` : '',
    '\nWrite the updated summary of everything above (earlier summary plus these messages).',
  ].join('\n')
  const before = estimateTokensOf(messages.slice(0, cut))
  const text = await completeText(p, model, SUMMARY_INSTRUCTIONS, input, signal)
  if (!text || text.length < 20) throw new Error('The model returned an empty summary.')
  return { text, upToMessageId: messages[cut - 1].id, createdAt: Date.now(), tokensBefore: before, tokensAfter: tokensOf(text) }
}

function estimateTokensOf(messages: Message[]) {
  return tokensOf(serialize(messages))
}
