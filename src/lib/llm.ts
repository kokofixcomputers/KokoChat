import type { Block, ChatSummary, Effort, McpServer, Message, Provider, Settings } from '../types'
import { buildMcp } from './mcp'
import { authHeaders, cleanBase, supportsReasoning } from './providers'
import { ASK_USER, CREATE_ARTIFACT, GENERATE_IMAGE, GENERATE_VIDEO, WEB_SEARCH, runTool, systemPrompt, type ToolDef } from './tools'
import { pickProvider } from './speech'
import { uid } from './utils'
import { sse } from './sse'
import { toast } from './toast'
import { INTEGRATIONS, integrationOfTool, integrationPromptsFor } from './integrations'
import { completeText } from './complete'
import { toolList } from './toolset'
import { isCodeChat, isCodeTool } from './codeTools'
import { isAgentTool } from './agents'
import { isMemoryTool } from './memory'
import { applySummary } from './context'
import { userTextForModel } from './images'
import { fillInput, fromAnthropic, fromOpenAI, recordUsage } from './usage'
import { Meter, liveMeters, openAIStepUsage } from './stats'

export interface RunOpts {
  provider: Provider
  model: string
  history: Message[] // messages before the assistant draft
  draft: Message // mutated in place
  settings: Settings
  mcpServers: McpServer[]
  providers: Provider[]
  summary?: ChatSummary
  chatId: string
  /** no interactive or side-effecting tools (used for model comparison) */
  isolated?: boolean
  /** the user queued a message while this reply was running: end the reply after the current tool call so it can be answered */
  yieldNow?: () => boolean
  /** scheduled co-worker run: web and integration tools only, nothing interactive */
  unattended?: boolean
  chatSystem?: string
  effort: Effort
  signal: AbortSignal
  flush: () => void
  /** set by runAssistant when reply measurements are on */
  meter?: Meter
}

/** Gemini's OpenAI-compatible endpoint rejects some JSON-Schema keywords that other providers accept. */
const geminiSchema = (v: any): any => Array.isArray(v) ? v.map(geminiSchema) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'additionalProperties' && k !== '$schema').map(([k, x]) => [k, geminiSchema(x)])) : v

let geminiThoughtsOk = true // flips to false if the endpoint ever rejects the thinking option
/** How many characters at the end of `s` could be the start of `tag` (so a tag split across stream chunks is not lost). */
const partialTail = (s: string, tag: string) => { for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n; return 0 }

async function post(p: Provider, path: string, body: unknown, signal: AbortSignal) {
  const res = await fetch(`${cleanBase(p.baseUrl)}${path}`, { method: 'POST', headers: authHeaders(p), body: JSON.stringify(body), signal })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      msg = j?.error?.message ?? j?.message ?? JSON.stringify(j).slice(0, 300)
    } catch { /* ignore */ }
    throw Object.assign(new Error(msg), { status: res.status })
  }
  return res
}


/** The user clearly asked to actually run/execute something: make the model call a tool instead of describing a result. */
const RUN_INTENT = /\b(sandbox|vm|virtual machine|shell|bash|terminal|execute|executing|echo|deploy|install (?:the )?(?:package|npm|pip|dependenc)|run (?:a |an |the |this |my |some )?(?:command|script|code|program|test|server))\b/i

function initialToolChoice(o: RunOpts, tools: ToolDef[], format: 'responses' | 'chat' | 'anthropic') {
  const last = [...o.history].reverse().find((m) => m.role === 'user')?.text ?? ''
  if (tools.some((t) => t.name === 'sandbox_exec') && RUN_INTENT.test(last)) return 'required' as const
  // the user pointed at a repo / service we can read: look at the real thing instead of guessing
  if (INTEGRATIONS.some((i) => i.triggers?.test(last) && tools.some((t) => i.owns(t.name)))) return 'required' as const
  if (o.settings.deepResearch && !isCodeChat(o.chatId) && tools.some((t) => t.name === 'web_search')) return format === 'responses' ? { type: 'function', name: 'web_search' } : format === 'anthropic' ? { type: 'tool', name: 'web_search' } : { type: 'function', function: { name: 'web_search' } }
  if (forceSearch(o, tools)) return format === 'responses' ? { type: 'function', name: 'web_search' } : format === 'anthropic' ? { type: 'tool', name: 'web_search' } : { type: 'function', function: { name: 'web_search' } }
  return undefined
}

const forceSearch = (o: RunOpts, tools: ToolDef[]) => {
  if (isCodeChat(o.chatId)) return false // a coding agent decides for itself when it needs the web
  if (!tools.includes(WEB_SEARCH) || o.settings.searchMode === 'auto') return false
  if (o.settings.searchMode === 'always') return true
  // 'first': only force a search on the first user message of the chat
  return o.history.filter((m) => m.role === 'user').length === 1
}

type Turn = { kind: 'text'; text: string } | { kind: 'tool'; callId: string; name: string; args: string; output: string }

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n) + '\n…[truncated]' : t)

/** Faithful replay of an assistant message: text, plus tool calls with their real results, plus artifact contents. */
function assistantTurns(m: Message): Turn[] {
  const turns: Turn[] = []
  for (const b of m.blocks ?? []) {
    if (b.type === 'text' && b.text.trim()) turns.push({ kind: 'text', text: b.text })
    else if (b.type === 'tool' && b.name !== 'create_artifact' && b.name !== 'create_presentation' && b.name !== 'generate_image' && b.name !== 'generate_video' && b.status !== 'running')
      turns.push({ kind: 'tool', callId: b.callId, name: b.name, args: b.status === 'error' ? (b.args || '{}') : slimArgs(b.name, b.args || '{}'), output: clip(b.result ?? '', 6000) })
  }
  const arts = (m.artifacts ?? [])
    .map((a) => a.kind === 'video' ? `[Video you generated earlier — id: ${a.id}, title: "${a.title}", prompt: ${a.meta?.prompt ?? ''}]` : a.kind === 'image' ? `[Image you generated earlier — id: ${a.id}, title: "${a.title}", prompt: ${a.meta?.prompt ?? ''}]` : `[Artifact you created earlier — id: ${a.id}, title: "${a.title}", kind: ${a.kind}, version ${a.version}]\n\`\`\`\`\n${clip(a.content, 14000)}\n\`\`\`\``)
    .join('\n\n')
  if (arts) turns.push({ kind: 'text', text: arts })
  return turns
}

const assistantText = (m: Message) => assistantTurns(m).filter((t) => t.kind === 'text').map((t) => (t as any).text).join('\n\n')

const sourceBase = (history: Message[]) => Math.max(0, ...history.flatMap((m) => (m.sources ?? []).map((s) => s.n)))

function closeReasoning(m: Message) {
  for (const b of m.blocks!) if (b.type === 'reasoning' && !b.endedAt) b.endedAt = Date.now()
}

function appendText(m: Message, delta: string) {
  closeReasoning(m)
  const last = m.blocks![m.blocks!.length - 1]
  if (last?.type === 'text') last.text += delta
  else m.blocks!.push({ type: 'text', id: uid(), text: delta })
}

function appendReasoning(m: Message, delta: string) {
  let last = m.blocks![m.blocks!.length - 1]
  if (last?.type !== 'reasoning' || last.endedAt) {
    last = { type: 'reasoning', id: uid(), text: '', startedAt: Date.now() }
    m.blocks!.push(last)
  }
  last.text += delta
}

interface Pending { callId: string; name: string; args: string; block: Extract<Block, { type: 'tool' }> }

/** Makes it unambiguous to the model that a tool result is its own retrieval, and what to answer next. */
function frame(o: RunOpts, name: string, output: string) {
  if (name === 'create_artifact' || name === 'create_presentation' || name === 'generate_image' || name === 'generate_video' || isCodeTool(name) || isAgentTool(name) || isMemoryTool(name) || name === 'ask_user' || name.startsWith('sandbox_') || integrationOfTool(name)) return output
  const last = [...o.history].reverse().find((m) => m.role === 'user')
  const ask = last?.text ? `\n\n---\nThe above is the output of the \`${name}\` tool that YOU called. It was not written by the user. Now answer the user's latest message: "${last.text.slice(0, 600)}"` : ''
  return `${output}${ask}`
}

async function execTools(o: RunOpts, calls: Pending[]) {
  o.meter?.toolStart() // tools and waiting for you are not model time
  try { return await runCalls(o, calls) } finally { o.meter?.toolEnd() }
}

async function runCalls(o: RunOpts, calls: Pending[]) {
  const outputs: { callId: string; output: string; images?: string[] }[] = []
  const runOne = async (c: Pending) => {
      try {
        const r = await runTool(c.name, c.args, { settings: o.settings, message: o.draft, callId: c.callId, signal: o.signal, mcp: buildMcp(o.mcpServers).lookup, sourceBase: sourceBase(o.history), providers: o.providers, chatId: o.chatId, update: (fn) => { fn(c.block); o.flush() } })
        c.block.status = 'done'
        c.block.result = r.output
        if (r.sources?.length) c.block.sources = r.sources // (the tool already added them to the message's source list)
        if (r.artifact) {
          const arts = (o.draft.artifacts ??= [])
          const i = arts.findIndex((a) => a.id === r.artifact!.id)
          if (i >= 0) arts[i] = r.artifact
          else arts.push(r.artifact)
          c.block.artifactId = r.artifact.id
        }
        outputs.push({ callId: c.callId, output: frame(o, c.name, r.output), ...(r.images?.length ? { images: r.images } : {}) })
      } catch (e: any) {
        if (o.signal.aborted) throw e
        c.block.status = 'error'
        c.block.result = String(e?.message ?? e)
        outputs.push({ callId: c.callId, output: frame(o, c.name, `Error: ${c.block.result}`) })
      }
      c.block.endedAt = Date.now()
      o.flush()
  }
  // a coding agent's edits and commands run one after another (and ask one question at a time)
  if (calls.some((c) => isCodeTool(c.name) || isAgentTool(c.name) || (c.name === 'generate_image' && isCodeChat(o.chatId)))) for (const c of calls) await runOne(c)
  else await Promise.all(calls.map(runOne))
  // keep order of calls
  return calls.map((c) => outputs.find((x) => x.callId === c.callId)!)
}

/** Pictures the model asked for (browser screenshots) ride along as a user message; only the newest few stay in the conversation. */
const KEEP_SHOTS = 3
function trimShots(shots: { content: any[] }[]) {
  for (const s of shots.slice(0, -KEEP_SHOTS)) if (s.content.some((c) => c.type !== 'input_text' && c.type !== 'text')) s.content = [{ type: s.content[0]?.type === 'input_text' ? 'input_text' : 'text', text: '[An earlier screenshot was removed to save space.]' }]
}
const imageNote = (n: number) => `The ${n === 1 ? 'screenshot' : 'screenshots'} you asked for ${n === 1 ? 'is' : 'are'} attached. This is the tool result, not a message from the user.`


/* ---- keep a long coding run from drowning in its own file contents ----
   Every step resends the whole conversation, and a write_file call carries the entire file. After a few files the early writes
   (and the model's memory of them) get pushed out of the model's real window or lost in the middle. So once a write has succeeded and
   a few newer calls exist, its file text is replaced with a short note; the call, the path and the result stay. */
const KEEP_FULL_CALLS = 3
const SLIM_TOOLS = new Set(['write_file', 'append_file', 'edit_file'])
export function slimArgs(name: string, args: string): string {
  if (!SLIM_TOOLS.has(name) || args.length < 700) return args
  let j: any
  try { j = JSON.parse(args) } catch { return args }
  const note = (t: string) => `[${t.split('\n').length} lines, ${t.length} characters; text left out of the history to save space. It was applied successfully; read_file the file if you need to see it.]`
  if (typeof j.content === 'string' && j.content.length > 500) j.content = note(j.content)
  for (const k of ['old_string', 'new_string']) if (typeof j[k] === 'string' && j[k].length > 900) j[k] = j[k].slice(0, 300) + ' …[left out]… ' + j[k].slice(-200)
  return JSON.stringify(j)
}
const failed = (out: unknown) => typeof out === 'string' && /^(Error|Refused)/.test(out)

function slimResponsesConvo(convo: any[]) {
  const calls = convo.filter((x) => x.type === 'function_call')
  const out = new Map(convo.filter((x) => x.type === 'function_call_output').map((x) => [x.call_id, x.output]))
  for (const c of calls.slice(0, -KEEP_FULL_CALLS)) if (!failed(out.get(c.call_id))) c.arguments = slimArgs(c.name, c.arguments ?? '')
}
function slimChatMsgs(msgs: any[]) {
  const calls = msgs.filter((x) => x.role === 'assistant' && x.tool_calls).flatMap((x) => x.tool_calls as any[])
  const out = new Map(msgs.filter((x) => x.role === 'tool').map((x) => [x.tool_call_id, x.content]))
  for (const c of calls.slice(0, -KEEP_FULL_CALLS)) if (!failed(out.get(c.id))) c.function.arguments = slimArgs(c.function.name, c.function.arguments ?? '')
}
function slimAnthropicMsgs(msgs: any[]) {
  const uses = msgs.filter((x) => x.role === 'assistant' && Array.isArray(x.content)).flatMap((x) => x.content.filter((b: any) => b.type === 'tool_use'))
  const out = new Map(msgs.filter((x) => x.role === 'user' && Array.isArray(x.content)).flatMap((x) => x.content.filter((b: any) => b.type === 'tool_result')).map((b: any) => [b.tool_use_id, typeof b.content === 'string' ? b.content : b.content?.[0]?.text]))
  for (const u of uses.slice(0, -KEEP_FULL_CALLS)) if (!failed(out.get(u.id)) && u.input && typeof u.input === 'object') u.input = JSON.parse(slimArgs(u.name, JSON.stringify(u.input)))
}

const hasSandbox = (tools: ToolDef[]) => tools.some((t) => t.name === 'sandbox_exec')

const withSummary = (note: string, sys: string) => (note ? `${sys}\n\n${note}` : sys)

const MAX_STEPS = 8
const stepsFor = (o: RunOpts) => (isCodeChat(o.chatId) ? 100 : o.settings.deepResearch ? 40 : MAX_STEPS)

/* ---------------------------- Responses API ---------------------------- */
async function runResponses(o: RunOpts) {
  const { provider: p, draft: m } = o
  const tools = toolList(o)
  const eff = applySummary(o.history, o.summary)
  const input: any[] = []
  for (const h of eff.messages) {
    if (h.role === 'user') {
      const content: any[] = []
      const ut = userTextForModel(h.text, h.attachments, h.quotes)
      if (ut) content.push({ type: 'input_text', text: ut })
      for (const a of h.attachments ?? []) if (a.kind !== 'text') content.push({ type: 'input_image', image_url: a.dataUrl })
      if (content.length) input.push({ role: 'user', content })
    } else {
      for (const t of assistantTurns(h)) {
        if (t.kind === 'text') input.push({ role: 'assistant', content: [{ type: 'output_text', text: t.text }] })
        else {
          input.push({ type: 'function_call', call_id: t.callId, name: t.name, arguments: t.args })
          input.push({ type: 'function_call_output', call_id: t.callId, output: t.output })
        }
      }
    }
  }
  const instructions = withSummary(eff.note, systemPrompt(o.settings, tools.includes(WEB_SEARCH), tools.includes(CREATE_ARTIFACT), o.chatSystem, tools.some((t) => t.name === GENERATE_IMAGE.name), tools.includes(ASK_USER), hasSandbox(tools), integrationPromptsFor(tools), tools.includes(GENERATE_VIDEO)))
  // Fully stateless: every step resends the whole conversation (no previous_response_id), so the model always sees the user's latest message.
  let convo: any[] = input
  const shotMsgs: { content: any[] }[] = []

  for (let step = 0; step < stepsFor(o); step++) {
    const body: any = { model: o.model, input: convo, instructions, stream: true, store: false }
    const outItems: any[] = []
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', ...t, strict: false }))
    const tc = step === 0 ? initialToolChoice(o, tools, 'responses') : undefined
    if (tc) body.tool_choice = tc
    if (supportsReasoning(p, o.model)) {
      body.reasoning = { summary: 'auto' }
      body.include = ['reasoning.encrypted_content']
      if (o.effort !== 'auto') body.reasoning.effort = o.effort
    }
    o.meter?.begin(body)
    const res = await post(p, '/responses', body, o.signal)
    const calls: Pending[] = []
    const byItem = new Map<string, Pending>()
    for await (const ev of sse(res)) {
      if (ev.data === '[DONE]') break
      let d: any
      try { d = JSON.parse(ev.data) } catch { continue }
      switch (d.type) {
        case 'response.output_item.added': {
          const it = d.item
          if (it?.type === 'reasoning') {
            m.blocks!.push({ type: 'reasoning', id: uid(), text: '', startedAt: Date.now() })
          } else if (it?.type === 'function_call') {
            closeReasoning(m)
            const block: Pending['block'] = { type: 'tool', id: uid(), callId: it.call_id, name: it.name, args: it.arguments ?? '', status: 'running', startedAt: Date.now() }
            m.blocks!.push(block)
            const c = { callId: it.call_id, name: it.name, args: it.arguments ?? '', block }
            byItem.set(it.id, c)
            o.meter?.delta('tool', (it.name?.length ?? 0) + (it.arguments?.length ?? 0))
          }
          break
        }
        case 'response.reasoning_summary_part.added': {
          const last = m.blocks![m.blocks!.length - 1]
          if (last?.type === 'reasoning' && last.text) last.text += '\n\n'
          break
        }
        case 'response.reasoning_summary_text.delta':
        case 'response.reasoning_text.delta':
          o.meter?.delta(d.type === 'response.reasoning_text.delta' ? 'reasoning' : 'summary', d.delta?.length ?? 0)
          appendReasoning(m, d.delta ?? '')
          break
        case 'response.output_text.delta':
          o.meter?.delta('text', d.delta?.length ?? 0)
          appendText(m, d.delta ?? '')
          break
        case 'response.function_call_arguments.delta': {
          const c = byItem.get(d.item_id)
          if (c) { o.meter?.delta('tool', d.delta?.length ?? 0); c.args += d.delta ?? ''; c.block.args = c.args }
          break
        }
        case 'response.output_item.done': {
          const it = d.item
          if (it && ['reasoning', 'function_call', 'message'].includes(it.type)) outItems.push(it)
          if (it?.type === 'reasoning') {
            for (let i = m.blocks!.length - 1; i >= 0; i--) {
              const b = m.blocks![i]
              if (b.type === 'reasoning' && !b.endedAt) { if (!b.text) o.meter?.hiddenReasoning(); b.endedAt = Date.now(); break }
            }
          } else if (it?.type === 'function_call') {
            const c = byItem.get(it.id)
            if (c) { c.args = it.arguments ?? c.args; c.block.args = c.args; calls.push(c) }
          }
          break
        }
        case 'response.completed':
        case 'response.incomplete': {
          const u = fromOpenAI(d.response?.usage)
          if (u) recordUsage(p.id, o.model, fillInput(u, body))
          o.meter?.usage(openAIStepUsage(d.response?.usage))
          o.meter?.servedModel(d.response?.model)
          break
        }
        case 'response.failed':
          throw new Error(d.response?.error?.message ?? 'Response failed')
        case 'error':
          throw new Error(d.message ?? d.error?.message ?? 'Stream error')
      }
      o.flush()
    }
    o.meter?.end()
    closeReasoning(m)
    if (!calls.length) return
    const outs = await execTools(o, calls)
    if (o.yieldNow?.()) return
    const picked = outs.flatMap((x) => x.images ?? [])
    const shotMsg = picked.length ? { role: 'user', content: [{ type: 'input_text', text: imageNote(picked.length) }, ...picked.map((u) => ({ type: 'input_image', image_url: u }))] } : null
    if (shotMsg) { shotMsgs.push(shotMsg); trimShots(shotMsgs) }
    convo = [...convo, ...outItems, ...outs.map((x) => ({ type: 'function_call_output', call_id: x.callId, output: x.output })), ...(shotMsg ? [shotMsg] : [])]
    slimResponsesConvo(convo)
  }
}

/* --------------------------- Chat Completions -------------------------- */
async function runChat(o: RunOpts) {
  const { provider: p, draft: m } = o
  const tools = toolList(o)
  const eff = applySummary(o.history, o.summary)
  const shotMsgs: { content: any[] }[] = []
  const msgs: any[] = [{ role: 'system', content: withSummary(eff.note, systemPrompt(o.settings, tools.includes(WEB_SEARCH), tools.includes(CREATE_ARTIFACT), o.chatSystem, tools.some((t) => t.name === GENERATE_IMAGE.name), tools.includes(ASK_USER), hasSandbox(tools), integrationPromptsFor(tools), tools.includes(GENERATE_VIDEO))) }]
  for (const h of eff.messages) {
    if (h.role === 'user') {
      const ut = userTextForModel(h.text, h.attachments, h.quotes)
      const imgs = (h.attachments ?? []).filter((a) => a.kind !== 'text')
      if (imgs.length) {
        msgs.push({ role: 'user', content: [...(ut ? [{ type: 'text', text: ut }] : []), ...imgs.map((a) => ({ type: 'image_url', image_url: { url: a.dataUrl } }))] })
      } else msgs.push({ role: 'user', content: ut })
    } else {
      const turns = assistantTurns(h)
      for (let i = 0; i < turns.length; ) {
        const t = turns[i]
        if (t.kind === 'text') { msgs.push({ role: 'assistant', content: t.text }); i++; continue }
        const group: Extract<Turn, { kind: 'tool' }>[] = []
        while (i < turns.length && turns[i].kind === 'tool') group.push(turns[i++] as any)
        msgs.push({ role: 'assistant', content: null, tool_calls: group.map((g) => ({ id: g.callId, type: 'function', function: { name: g.name, arguments: g.args } })) })
        for (const g of group) msgs.push({ role: 'tool', tool_call_id: g.callId, content: g.output })
      }
    }
  }

  for (let step = 0; step < stepsFor(o); step++) {
    const body: any = { model: o.model, messages: msgs, stream: true, stream_options: { include_usage: true } }
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: p.preset === 'gemini' ? { ...t, parameters: geminiSchema(t.parameters) } : t }))
    const tc = step === 0 ? initialToolChoice(o, tools, 'chat') : undefined
    if (tc) body.tool_choice = tc
    if (supportsReasoning(p, o.model) && o.effort !== 'auto') body.reasoning_effort = o.effort === 'minimal' ? 'low' : o.effort
    const thoughts = p.preset === 'gemini' && geminiThoughtsOk && supportsReasoning(p, o.model)
    // Gemini's compatible endpoint only returns its thinking when asked, wrapped in <thought> tags
    if (thoughts) body.extra_body = { google: { thinking_config: { include_thoughts: true } } }
    let res: Response
    o.meter?.begin(body)
    try { res = await post(p, '/chat/completions', body, o.signal) } catch (e: any) {
      if (!thoughts || e?.status !== 400) throw e
      geminiThoughtsOk = false
      delete body.extra_body
      o.meter?.begin(body)
      res = await post(p, '/chat/completions', body, o.signal)
    }
    let content = ''
    let inThought = false
    let buf = ''
    const emit = (t: string) => { if (!t) return; o.meter?.delta(inThought ? 'summary' : 'text', t.length); if (inThought) appendReasoning(m, t); else { content += t; appendText(m, t) } }
    const feed = (chunk: string) => {
      buf += chunk
      while (buf) {
        const tag = inThought ? '</thought>' : '<thought>'
        const i = buf.indexOf(tag)
        if (i >= 0) { emit(buf.slice(0, i)); buf = buf.slice(i + tag.length); if (inThought) closeReasoning(m); inThought = !inThought; continue }
        const keep = partialTail(buf, tag)
        emit(buf.slice(0, buf.length - keep)); buf = buf.slice(buf.length - keep)
        break
      }
    }
    const tcs: { id: string; name: string; args: string; extra?: unknown; block?: Pending['block'] }[] = []
    for await (const ev of sse(res)) {
      if (ev.data === '[DONE]') break
      let d: any
      try { d = JSON.parse(ev.data) } catch { continue }
      if (d.error) throw new Error(d.error.message ?? JSON.stringify(d.error))
      if (d.usage) { const u = fromOpenAI(d.usage); if (u) recordUsage(p.id, o.model, fillInput(u, body)) }
      if (d.usage) o.meter?.usage(openAIStepUsage(d.usage, p.preset === 'gemini'))
      o.meter?.servedModel(d.model)
      const delta = d.choices?.[0]?.delta
      if (!delta) continue
      const r = delta.reasoning_content ?? delta.reasoning
      if (typeof r === 'string' && r) { o.meter?.delta('reasoning', r.length); appendReasoning(m, r) }
      if (delta.content) { if (thoughts) feed(delta.content); else { o.meter?.delta('text', delta.content.length); content += delta.content; appendText(m, delta.content) } }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0
        const cur = (tcs[i] ??= { id: tc.id ?? uid(), name: '', args: '' })
        if (tc.id) cur.id = tc.id
        if (tc.extra_content) cur.extra = tc.extra_content // Gemini 3: thought signature that must be sent back with the call
        if (tc.function?.name) cur.name += tc.function.name
        if (tc.function?.arguments) cur.args += tc.function.arguments
        o.meter?.delta('tool', (tc.function?.name?.length ?? 0) + (tc.function?.arguments?.length ?? 0))
        if (!cur.block && cur.name) {
          closeReasoning(m)
          cur.block = { type: 'tool', id: uid(), callId: cur.id, name: cur.name, args: '', status: 'running', startedAt: Date.now() }
          m.blocks!.push(cur.block)
        }
        if (cur.block) { cur.block.args = cur.args; cur.block.callId = cur.id }
      }
      o.flush()
    }
    if (buf) { emit(buf); buf = '' }
    o.meter?.end()
    closeReasoning(m)
    const calls: Pending[] = tcs.filter((t) => t?.block).map((t) => ({ callId: t.id, name: t.name, args: t.args, block: t.block! }))
    if (!calls.length) return
    msgs.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((c) => ({ id: c.callId, type: 'function', function: { name: c.name, arguments: c.args || '{}' }, ...(tcs.find((t) => t?.id === c.callId)?.extra ? { extra_content: tcs.find((t) => t?.id === c.callId)!.extra } : {}) })),
    })
    const outs = await execTools(o, calls)
    if (o.yieldNow?.()) return
    for (const x of outs) msgs.push({ role: 'tool', tool_call_id: x.callId, content: x.output })
    slimChatMsgs(msgs)
    const picked = outs.flatMap((x) => x.images ?? [])
    if (picked.length) { const sm = { role: 'user', content: [{ type: 'text', text: imageNote(picked.length) }, ...picked.map((u) => ({ type: 'image_url', image_url: { url: u } }))] }; shotMsgs.push(sm); trimShots(shotMsgs); msgs.push(sm) }
  }
}

/* ------------------------------- Anthropic ------------------------------ */
const THINKING_BUDGET: Record<string, number> = { minimal: 1024, low: 2048, medium: 8192, high: 16000 }
const parseDataUrl = (u: string) => { const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(u); return m ? { mime: m[1], data: m[2] } : null }
const safeJson = (s: string) => { try { return s ? JSON.parse(s) : {} } catch { return {} } }
const okImage = (mime: string) => ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)

async function runAnthropic(o: RunOpts) {
  const { provider: p, draft: m } = o
  const tools = toolList(o)
  const eff = applySummary(o.history, o.summary)
  const system = withSummary(eff.note, systemPrompt(o.settings, tools.includes(WEB_SEARCH), tools.includes(CREATE_ARTIFACT), o.chatSystem, tools.some((t) => t.name === GENERATE_IMAGE.name), tools.includes(ASK_USER), hasSandbox(tools), integrationPromptsFor(tools), tools.includes(GENERATE_VIDEO)))

  const shotMsgs: { content: any[] }[] = []
  const msgs: { role: 'user' | 'assistant'; content: any[] }[] = []
  const push = (role: 'user' | 'assistant', content: any[]) => {
    if (!content.length) return
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) last.content.push(...content) // the API merges consecutive same-role turns anyway
    else msgs.push({ role, content })
  }
  for (const h of eff.messages) {
    if (h.role === 'user') {
      const content: any[] = []
      for (const a of h.attachments ?? []) {
        if (a.kind === 'text') continue
        const d = parseDataUrl(a.dataUrl)
        if (d && okImage(d.mime)) content.push({ type: 'image', source: { type: 'base64', media_type: d.mime, data: d.data } })
      }
      const ut = userTextForModel(h.text, h.attachments, h.quotes)
      if (ut) content.push({ type: 'text', text: ut })
      push('user', content)
    } else {
      for (const t of assistantTurns(h)) {
        if (t.kind === 'text') push('assistant', [{ type: 'text', text: t.text }])
        else {
          push('assistant', [{ type: 'tool_use', id: t.callId, name: t.name, input: safeJson(t.args) }])
          push('user', [{ type: 'tool_result', tool_use_id: t.callId, content: t.output || '(no output)' }])
        }
      }
    }
  }

  const thinkingOn = supportsReasoning(p, o.model) && o.effort !== 'auto'
  const budget = thinkingOn ? THINKING_BUDGET[o.effort] ?? 8192 : 0
  const maxSteps = stepsFor(o)

  for (let step = 0; step < maxSteps; step++) {
    const body: any = { model: o.model, max_tokens: budget ? Math.min(64000, budget + 8192) : 8192, system, messages: msgs, stream: true }
    if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }))
    if (thinkingOn) body.thinking = { type: 'enabled', budget_tokens: budget }
    else {
      const tc = step === 0 ? initialToolChoice(o, tools, 'anthropic') : undefined // forced tools are not allowed together with thinking
      if (tc) body.tool_choice = tc === 'required' ? { type: 'any' } : tc
    }
    o.meter?.begin(body)
    const res = await post(p, '/messages', body, o.signal)

    type Cur = { entry: any; json?: string; ui?: Pending['block'] }
    const cur = new Map<number, Cur>()
    let au: ReturnType<typeof fromAnthropic> | null = null
    for await (const ev of sse(res)) {
      let d: any
      try { d = JSON.parse(ev.data) } catch { continue }
      if (d.type === 'error') throw new Error(d.error?.message ?? 'Stream error')
      if (d.type === 'message_start') {
        au = fromAnthropic(d.message?.usage)
        o.meter?.usage({ ...au, output: undefined }) // the output count here is only a placeholder
        o.meter?.servedModel(d.message?.model)
      } else if (d.type === 'message_delta' && au) {
        au.output = Number(d.usage?.output_tokens ?? au.output)
        if (d.usage?.output_tokens !== undefined) o.meter?.usage({ ...au, reasoning: d.usage.output_tokens_details?.thinking_tokens })
      }
      if (d.type === 'content_block_start') {
        const cb = d.content_block ?? {}
        if (cb.type === 'thinking') {
          m.blocks!.push({ type: 'reasoning', id: uid(), text: '', startedAt: Date.now() })
          cur.set(d.index, { entry: { type: 'thinking', thinking: '', signature: '' } })
        } else if (cb.type === 'redacted_thinking') {
          o.meter?.hiddenReasoning()
          cur.set(d.index, { entry: cb })
        } else if (cb.type === 'text') {
          cur.set(d.index, { entry: { type: 'text', text: '' } })
        } else if (cb.type === 'tool_use') {
          closeReasoning(m)
          const ui: Pending['block'] = { type: 'tool', id: uid(), callId: cb.id, name: cb.name, args: '', status: 'running', startedAt: Date.now() }
          m.blocks!.push(ui)
          cur.set(d.index, { entry: { type: 'tool_use', id: cb.id, name: cb.name, input: {} }, json: '', ui })
          o.meter?.delta('tool', cb.name?.length ?? 0)
        }
      } else if (d.type === 'content_block_delta') {
        const c = cur.get(d.index)
        const dl = d.delta ?? {}
        if (!c) continue
        if (dl.type === 'text_delta') { o.meter?.delta('text', dl.text?.length ?? 0); c.entry.text += dl.text ?? ''; appendText(m, dl.text ?? '') }
        else if (dl.type === 'thinking_delta') { o.meter?.delta('reasoning', dl.thinking?.length ?? 0); c.entry.thinking += dl.thinking ?? ''; appendReasoning(m, dl.thinking ?? '') }
        else if (dl.type === 'signature_delta') c.entry.signature += dl.signature ?? ''
        else if (dl.type === 'input_json_delta') { o.meter?.delta('tool', dl.partial_json?.length ?? 0); c.json = (c.json ?? '') + (dl.partial_json ?? ''); c.ui!.args = c.json }
      } else if (d.type === 'content_block_stop') {
        const c = cur.get(d.index)
        if (c?.entry.type === 'thinking') { if (!c.entry.thinking && c.entry.signature) o.meter?.hiddenReasoning(); closeReasoning(m) }
        if (c?.entry.type === 'tool_use') c.entry.input = safeJson(c.json ?? '')
      }
      o.flush()
    }
    o.meter?.end()
    closeReasoning(m)
    if (au) recordUsage(p.id, o.model, fillInput(au, body))

    const ordered = [...cur.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
    const content = ordered.map((v) => v.entry).filter((e) => !(e.type === 'text' && !e.text))
    const calls: Pending[] = ordered.filter((v) => v.entry.type === 'tool_use').map((v) => ({ callId: v.entry.id, name: v.entry.name, args: v.json ?? '', block: v.ui! }))
    if (!calls.length) return
    msgs.push({ role: 'assistant', content })
    const outs = await execTools(o, calls)
    if (o.yieldNow?.()) return
    const keep: any[] = []
    msgs.push({ role: 'user', content: outs.map((x) => {
      if (!x.images?.length) return { type: 'tool_result', tool_use_id: x.callId, content: x.output || '(no output)' }
      const imgs = x.images.map(parseDataUrl).filter(Boolean).map((d) => ({ type: 'image', source: { type: 'base64', media_type: d!.mime, data: d!.data } }))
      const r = { type: 'tool_result', tool_use_id: x.callId, content: [{ type: 'text', text: x.output || '(no output)' }, ...imgs] }
      keep.push(r)
      return r
    }) })
    for (const r of keep) { shotMsgs.push(r); trimShots(shotMsgs) }
    slimAnthropicMsgs(msgs)
  }
}

export async function runAssistant(opts: RunOpts) {
  const o: RunOpts = opts.settings.replyStats ? { ...opts, meter: new Meter(opts.provider.name, opts.model) } : opts
  if (o.meter) liveMeters.set(o.draft.id, o.meter)
  // also after a stop or an error, so whatever did arrive is still measured
  try { await dispatch(o) } finally {
    if (o.meter) liveMeters.delete(o.draft.id)
    const stats = o.meter?.result()
    if (stats) o.draft.stats = stats
  }
}

async function dispatch(o: RunOpts) {
  o.draft.blocks ??= []
  if (o.provider.apiMode === 'responses' && o.provider.preset === 'gemini') await runChat(o) // Gemini has no Responses API
  else if (o.provider.apiMode === 'responses') {
    try { await runResponses(o) } catch (e: any) {
      // some OpenAI-compatible servers have no /responses endpoint: quietly use Chat Completions instead
      if ((e?.status === 404 || e?.status === 405 || e?.status === 501) && !o.draft.blocks!.length) {
        toast.info(`${o.provider.name} has no Responses API, so Chat Completions was used. You can change this in Settings → Providers.`)
        await runChat(o)
      } else throw e
    }
  } else if (o.provider.apiMode === 'anthropic') await runAnthropic(o)
  else await runChat(o)
}

export async function generateTitle(p: Provider, model: string, history: Message[], signal?: AbortSignal): Promise<string | null> {
  const convo = history
    .map((m) => (m.role === 'user' ? `User: ${m.text ?? '(image)'}` : `Assistant: ${assistantText(m)}`))
    .join('\n\n')
    .slice(0, 4000)
  const instructions = [
    'You name chat conversations. Reply with ONE short title (2-5 words) that the user might plausibly give this chat themselves, e.g. "Tech news roundup" or "Python CSV parsing help".',
    'STRICT OUTPUT RULES:',
    '- Output the title and nothing else: a single line, no quotes, no markdown, no trailing punctuation.',
    '- Do NOT list options or alternatives. Do NOT write "here are some title options", "current title", "title:", "suggested title", or any introduction.',
    '- Do NOT explain your choice, add notes, or ask a follow-up question.',
    '- If unsure, still output exactly one best title.',
  ].join('\n')
  try {
    const out = await completeText(p, model, instructions, `Conversation:\n\n${convo}\n\nTitle:`, signal)
    const t = cleanTitle(out)
    return t
  } catch { return null }
}

const PREAMBLE = /^(here\b|here's|sure\b|okay\b|ok\b|certainly|of course|current title|title options?|options?\b|suggest|a few|some title|possible titles?|i('d| would)|the title|this (chat|conversation))/i

/** Pull a single clean title out of whatever the model returned. */
export function cleanTitle(raw: string): string | null {
  const lines = raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (const line of lines) {
    if (PREAMBLE.test(line) || /:\s*$/.test(line)) continue
    const t = line
      .replace(/^(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/^(?:new |chat |suggested )?title\s*[:\-–]\s*/i, '')
      .replace(/[*_`#]/g, '')
      .replace(/^["'“‘]+|["'”’.!?]+$/g, '')
      .trim()
    if (t.length >= 2 && t.length <= 60 && !PREAMBLE.test(t)) return t
  }
  return null
}
