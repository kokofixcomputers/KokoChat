import { useStore } from '../store'
import type { Chat } from '../types'
import type { ToolDef } from './tools'

/** Sub-agents: background helpers a Code session can start. Each is a hidden Code chat in the same folder that runs at the same time as its parent. */
export const MAX_AGENTS = 6

export const SPAWN_AGENT: ToolDef = {
  name: 'spawn_agent',
  description:
    'Start a sub-agent that works on a self-contained task in the background, at the same time as you. It runs in this project folder with the same tools and the same permissions, and this call returns immediately so you can keep working. The sub-agent cannot see this conversation, so give it a complete brief: the goal, the relevant files, constraints and exactly what to report back. Good uses: investigating one area of the code, implementing a separate module, running and fixing tests, researching something online. Do not give two agents the same files to edit.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short label, 2 to 4 words, for example "Fix failing tests".' },
      task: { type: 'string', description: 'The complete brief for the sub-agent.' },
    },
    required: ['name', 'task'],
    additionalProperties: false,
  },
}

export const WAIT_AGENTS: ToolDef = {
  name: 'wait_for_agents',
  description:
    'Wait until sub-agents have finished and get their reports. Call this only when you have nothing else to do and need their results to continue. Sub-agents that are still running when you finish your reply are waited for automatically and their reports are sent back to you, so you usually do not need this.',
  parameters: {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Agent ids to wait for. Default: all of them.' } },
    required: [],
    additionalProperties: false,
  },
}

export const AGENT_TOOLS: ToolDef[] = [SPAWN_AGENT, WAIT_AGENTS]
export const isAgentTool = (name: string) => name === SPAWN_AGENT.name || name === WAIT_AGENTS.name

const chatsNow = () => useStore.getState().chats
export const isSubChat = (id?: string) => !!id && !!chatsNow().find((c) => c.id === id)?.sub
export const childrenOf = (parentId: string): Chat[] => chatsNow().filter((c) => c.sub?.parentId === parentId)

const runs = new Map<string, Promise<void>>()
export const trackRun = (id: string, p: Promise<void>) => { runs.set(id, p); void p.finally(() => { if (runs.get(id) === p) runs.delete(id) }) }
export const isAgentRunning = (id: string) => runs.has(id)

/** What the agent said at the end (or why it did not finish). */
export function reportOf(c: Chat): { status: 'done' | 'failed' | 'stopped' | 'working'; text: string } {
  const last = [...c.messages].reverse().find((m) => m.role === 'assistant')
  const text = (last?.blocks ?? []).filter((b) => b.type === 'text').map((b: any) => b.text as string).join('\n\n').trim()
  if (runs.has(c.id)) return { status: 'working', text }
  if (last?.status === 'error') return { status: 'failed', text: `The sub-agent failed: ${last.error ?? 'unknown error'}${text ? `\n\nWhat it had said so far:\n${text}` : ''}` }
  if (last?.status === 'stopped' || last?.status === 'streaming') return { status: 'stopped', text: `The sub-agent was stopped before it finished.${text ? `\n\nWhat it had said so far:\n${text}` : ''}` }
  return { status: 'done', text: text || '(The sub-agent finished without writing a report.)' }
}

const clip = (s: string, n = 9000) => (s.length > n ? s.slice(0, n) + '\n…[report truncated]' : s)

export function reportsText(ids: string[]): { text: string; names: { id: string; name: string }[] } {
  const list = ids.map((id) => chatsNow().find((c) => c.id === id)).filter((c): c is Chat => !!c)
  const body = list.map((c) => { const r = reportOf(c); return `### Sub-agent "${c.sub!.name}" (id ${c.id}), ${r.status}\n${clip(r.text)}` }).join('\n\n')
  return { text: body, names: list.map((c) => ({ id: c.id, name: c.sub!.name })) }
}

const markDelivered = (ids: string[]) => useStore.setState((s) => ({ chats: s.chats.map((c) => (c.sub && ids.includes(c.id) ? { ...c, sub: { ...c.sub, delivered: true } } : c)) }))

interface Ctx { chatId: string; callId: string; signal: AbortSignal; update: (fn: (b: any) => void) => void }

export async function runAgentTool(name: string, a: Record<string, any>, ctx: Ctx): Promise<{ output: string }> {
  const st = useStore.getState()
  const parent = st.chats.find((c) => c.id === ctx.chatId)
  if (!parent || parent.sub) throw new Error('Only the main agent can start or wait for sub-agents.')

  if (name === SPAWN_AGENT.name) {
    const task = String(a.task ?? '').trim()
    const label = String(a.name ?? '').trim().slice(0, 60) || 'Sub-agent'
    if (!task) throw new Error('task is required: describe what the sub-agent should do.')
    if (childrenOf(parent.id).filter((c) => runs.has(c.id)).length >= MAX_AGENTS) throw new Error(`${MAX_AGENTS} sub-agents are already running. Use wait_for_agents, then start more.`)
    const id = st.startSubAgent(parent.id, label, task)
    ctx.update((b) => { b.meta = { ...(b.meta ?? {}), agentId: id, agentName: label } })
    return { output: `Started sub-agent "${label}" (id ${id}). It is working in the background in the same project folder, at the same time as you. Carry on with your own work. Its report is sent to you automatically when you finish your reply, or call wait_for_agents to get it sooner.` }
  }

  // wait_for_agents
  const ids: string[] | null = Array.isArray(a.ids) && a.ids.length ? a.ids.map(String) : null
  const targets = childrenOf(parent.id).filter((c) => !c.sub!.delivered && (!ids || ids.includes(c.id)))
  if (!targets.length) return { output: 'There are no sub-agents waiting to report.' }
  const pending = targets.map((c) => runs.get(c.id)).filter((p): p is Promise<void> => !!p)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (ctx.signal.aborted) return onAbort()
    ctx.signal.addEventListener('abort', onAbort, { once: true })
    void Promise.all(pending).then(() => resolve())
  })
  const { text } = reportsText(targets.map((c) => c.id))
  markDelivered(targets.map((c) => c.id))
  return { output: text }
}

const tokens = new Map<string, number>()
/**
 * Called when the main agent has finished its reply. If sub-agents are still working (or finished without having been read),
 * wait for them and send their reports back so the main agent can carry on.
 */
export async function deliverPending(parentId: string) {
  const tok = (tokens.get(parentId) ?? 0) + 1
  tokens.set(parentId, tok)
  const mark = chatsNow().find((c) => c.id === parentId)?.messages.at(-1)?.id
  const pend = () => childrenOf(parentId).filter((c) => !c.sub!.delivered)
  if (!pend().length) return
  await Promise.all(pend().map((c) => runs.get(c.id)).filter((p): p is Promise<void> => !!p))
  if (tokens.get(parentId) !== tok) return // a newer turn took over
  const s = useStore.getState()
  const p = s.chats.find((c) => c.id === parentId)
  if (!p || s.streaming[parentId] || p.messages.at(-1)?.id !== mark) return // the user said something meanwhile
  const ids = pend().map((c) => c.id)
  if (ids.length) s.reportToParent(parentId, ids)
}

export const SUB_AGENT_PROMPT = (name: string) => `You are a sub-agent named "${name}", started by the main Koko Code agent to do one job while it works on something else. Several agents may be editing this project at the same time, so touch only the files your task needs and re-read a file right before you edit it.
- Do the task completely on your own. You cannot ask the main agent questions, so make sensible assumptions and say what you assumed.
- You cannot start other sub-agents.
- Finish with a concise report for the main agent: what you did, the files you changed (paths in backticks), what you found or verified (build, tests), and anything it must know or do next. Do not paste whole files.`

export const MAIN_AGENT_PROMPT = `You can run sub-agents with spawn_agent. They work at the same time as you in this folder, with the same permissions, and report back. Use them when the work splits into 2 or more independent parts (for example one investigates the API while another writes tests), or for a long task that should not block you. Give each a complete brief, since it cannot see this chat, and keep their files separate. After starting them, keep doing your own part of the work. When you finish your reply their reports are delivered to you automatically; use wait_for_agents only if you must have a result before you can continue. Do not start sub-agents for small tasks you can do directly. When reports arrive, check anything important, and summarise the outcome for the user.`
