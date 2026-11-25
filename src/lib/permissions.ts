import { useStore } from '../store'
import { uid } from './utils'

export type PermissionMode = 'ask' | 'acceptEdits' | 'auto' | 'bypass'
export type ApprovalKind = 'edit' | 'command' | 'outside' | 'tool'
export type Decision = 'once' | 'always' | 'session' | 'deny'

export interface Approval {
  id: string
  chatId: string
  callId: string
  kind: ApprovalKind
  /** "Run npm install" / "Edit src/App.tsx" */
  title: string
  /** the exact command or path */
  detail?: string
  /** why this one is worth a second look (shown in red) */
  risky?: string
  /** for commands: what "always allow" would remember */
  rule?: string
  /** what the agent says the action is for */
  purpose?: string
}

/** Auto mode's reviewer said no. The reason is passed on to the AI so it can explain and move on. */
export class AutoBlocked extends Error {
  constructor(reason: string) { super(`Blocked by Auto mode's safety review: ${reason}`) }
}

export class PermissionDenied extends Error {
  constructor() { super('The user denied this action. Do not retry it. Say what you were trying to do and ask how they would like to proceed, or take a different approach.') }
}

const resolvers = new Map<string, (d: Decision) => void>()

/** a sub-agent follows the permission mode of the session that started it */
export const rootOf = (chatId: string) => useStore.getState().chats.find((c) => c.id === chatId)?.sub?.parentId ?? chatId
export const permissionOf = (chatId: string): PermissionMode => useStore.getState().codePerm[rootOf(chatId)] ?? useStore.getState().settings.codeDefaultPermission ?? 'ask'

/* ------------------------------ shell command rules ------------------------------ */
// Commands that only look at things. Only auto-approved without chaining, redirects or substitution.
const SAFE = [
  /^(ls|pwd|echo|cat|head|tail|wc|which|whoami|date|uname|printf|env|printenv|tree|file|stat|du|df|basename|dirname|realpath|sort|uniq|cut|diff|type|true)(\s|$)/,
  /^git\s+(status|diff|log|show|branch|remote|rev-parse|ls-files|blame|describe|tag|stash\s+list|config\s+--get)(\s|$)/,
  /^(node|npm|npx|pnpm|yarn|bun|python3?|pip3?|cargo|go|rustc|java|ruby|deno|tsc)\s+(-v|--version|version)$/,
  /^npm\s+(ls|list|outdated|view|info|ping)(\s|$)/,
  /^(grep|rg|find|fd)(\s|$)/,
]
const UNSAFE_FIND = /\s-(exec|execdir|delete|ok|fprint|fls)\b/
/** split `a && b | c` into the simple commands it is made of */
export const segments = (cmd: string) => cmd.split(/&&|\|\||;|\n|\|/).map((s) => s.trim()).filter(Boolean)

export function isReadOnlyCommand(cmd: string): boolean {
  const c = cmd.trim()
  if (!c || /`|\$\(|>|<\(/.test(c) || UNSAFE_FIND.test(c)) return false
  return segments(c).every((s) => SAFE.some((re) => re.test(s)))
}

const RISKY: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/, 'Deletes files permanently'],
  [/\bsudo\b/, 'Runs with administrator rights'],
  [/(curl|wget)[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, 'Runs a script downloaded from the internet'],
  [/\bgit\s+(push|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--|branch\s+-D|rebase)\b/, 'Can overwrite or discard work in git'],
  [/\b(chmod|chown)\s+-R\b/, 'Changes permissions recursively'],
  [/\b(mkfs|dd\s+if=|diskutil\s+erase|format\s+[a-z]:)/i, 'Can erase a disk'],
  [/\b(npm|pnpm|yarn)\s+publish\b|\bgh\s+release\b|\bdocker\s+push\b/, 'Publishes something'],
  [/:\(\)\s*\{/, 'Fork bomb'],
  [/>\s*\/dev\/(sd|disk|nvme)/, 'Writes straight to a disk'],
  [/\b(shutdown|reboot|halt)\b/, 'Shuts down the machine'],
]
export const riskOf = (cmd: string) => RISKY.find(([re]) => re.test(cmd))?.[1]

/** What "always allow" remembers: the program plus its subcommand, e.g. "npm run" or "git commit". */
export function rulePrefix(cmd: string): string {
  const seg = segments(cmd)[0] ?? cmd
  const t = seg.split(/\s+/)
  const sub = ['npm', 'pnpm', 'yarn', 'bun', 'git', 'cargo', 'go', 'docker', 'make', 'pip', 'pip3', 'npx', 'python', 'python3', 'node']
  if (sub.includes(t[0]) && t[1] && !t[1].startsWith('-')) return t.slice(0, t[0] === 'npm' && t[1] === 'run' && t[2] ? 3 : 2).join(' ')
  return t[0]
}

const matchesRule = (cmd: string, rules: string[]) => segments(cmd).every((s) => rules.some((r) => s === r || s.startsWith(r + ' ')))

/* ---------------------------------- asking ---------------------------------- */
type Req = Omit<Approval, 'id' | 'chatId' | 'callId'>

/**
 * Resolves when the action may go ahead, throws PermissionDenied if the user said no.
 * `update` marks the tool block as waiting so the chat shows the question in place.
 */
export async function requireApproval(chatId: string, callId: string, req: Req, signal: AbortSignal, update: (fn: (b: any) => void) => void): Promise<void> {
  const st = useStore.getState()
  const mode = permissionOf(chatId)
  const cwd = st.chats.find((c) => c.id === chatId)?.cwd ?? ''
  if (mode === 'bypass') return
  if (req.kind === 'edit' && mode === 'acceptEdits') return
  if (req.kind === 'command' && req.detail) {
    if (!req.risky && isReadOnlyCommand(req.detail)) return
    const rules = st.codeRules.filter((r) => r.cwd === cwd && r.kind === 'command').map((r) => r.pattern)
    // a remembered rule covers the command only when every piece of it matches one and nothing hides inside substitutions or redirects
    if (!req.risky && !/`|\$\(|>/.test(req.detail) && matchesRule(req.detail, rules)) return
  }
  let reviewNote = ''
  if (mode === 'auto') {
    if (req.kind === 'edit') return // edits inside the project can be undone
    const { reviewAction } = await import('./autoReview')
    update((b) => { b.phase = 'reviewing' })
    const v = await reviewAction({ chatId, kind: req.kind, detail: req.detail ?? req.title, purpose: req.purpose, cwd, signal })
    update((b) => { b.phase = undefined; b.meta = { ...(b.meta ?? {}), auto: { decision: v.decision, risk: v.risk, reason: v.reason, by: v.by } } })
    if (v.decision === 'allow') return
    if (v.decision === 'deny') throw new AutoBlocked(v.reason)
    reviewNote = v.reason // unsure: you decide
  }
  const a: Approval = { ...req, ...(reviewNote ? { risky: req.risky ?? `Auto mode wants your call: ${reviewNote}` } : {}), id: uid(), chatId, callId }
  useStore.setState((s) => ({ approvals: { ...s.approvals, [a.id]: a } }))
  void import('./notify').then((m) => m.notifyApproval(a))
  update((b) => { b.phase = 'approval'; b.meta = { ...(b.meta ?? {}), approval: { id: a.id, kind: a.kind, title: a.title, detail: a.detail, risky: a.risky, rule: a.rule, state: 'pending' } } })
  const clear = () => { useStore.setState((s) => { const n = { ...s.approvals }; delete n[a.id]; return { approvals: n } }); void import('./notify').then((m) => m.closeNotice('appr:' + a.id)) }
  let d: Decision
  try {
    d = await new Promise<Decision>((resolve, reject) => {
      resolvers.set(a.id, resolve)
      const onAbort = () => { resolvers.delete(a.id); reject(new DOMException('Aborted', 'AbortError')) }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  } catch (e) { clear(); update((b) => { b.phase = undefined }); throw e }
  clear()
  update((b) => { b.phase = 'running'; b.meta = { ...(b.meta ?? {}), approval: { ...(b.meta?.approval ?? {}), state: d === 'deny' ? 'denied' : 'allowed' } } })
  if (d === 'deny') throw new PermissionDenied()
  if (d === 'always' && a.kind === 'command' && a.rule) useStore.setState((s) => ({ codeRules: [...s.codeRules, { id: uid(), cwd, kind: 'command', pattern: a.rule! }] }))
  if (d === 'session') useStore.getState().setCodePerm(rootOf(chatId), 'acceptEdits')
}

export function decide(id: string, d: Decision) {
  const r = resolvers.get(id)
  if (!r) return
  resolvers.delete(id)
  r(d)
}
