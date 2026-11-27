import type { Block } from '../types'
import { isCodeTool, describeBlock } from './codeTools'
import { integrationOfTool } from './integrations'
import { parseMcpName } from './mcp'

type Tool = Extract<Block, { type: 'tool' }>

const MAX = 20_000
const clip = (s: string, n = MAX) => (s.length > n ? s.slice(0, n) + '\n… (shortened)' : s)

/** Arguments with the long values (file contents, prompts, message bodies) removed: the cards only show short ones. */
function shortArgs(args: string) {
  try {
    const o = JSON.parse(args)
    return JSON.stringify(Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 600))))
  } catch { return '{}' }
}

/** Cards that show a tool's input and output in full. */
const showsEverything = (name: string) => !!parseMcpName(name)

/** Whether the app puts this call's result on screen. Results that are never shown (a file or email it read) are not shared. */
function showsResult(b: Tool) {
  if (b.status === 'error') return true
  if (isCodeTool(b.name)) return ['search', 'list', 'find'].includes(describeBlock(b).icon)
  if (integrationOfTool(b.name)) return false
  if (['web_search', 'read_url', 'ask_user', 'create_artifact', 'create_presentation', 'generate_image', 'create_action', 'todo_write', 'spawn_agent', 'wait_for_agents'].includes(b.name)) return false
  if (b.name.startsWith('memory_')) return false
  return true // sandbox cards and the generic "Used tool" pill
}

/**
 * The shareable form of one tool call: what its card in the app shows, and no more. Returns null for calls that are
 * never shared (memories are about the person, not the chat).
 */
export function shareTool(b: Tool, o: { sources: boolean }, hasArtifact: boolean): Omit<Tool, 'id' | 'callId' | 'type'> | null {
  if (b.name.startsWith('memory_') || b.name === 'generate_video') return null
  const makes = ['create_artifact', 'create_presentation', 'generate_image'].includes(b.name)
  // the call's arguments and result describe the artifact, so leaving the artifact out leaves the call out
  if (makes && !hasArtifact) return null
  const web = b.name === 'web_search' || b.name === 'read_url'
  const result = b.result && showsResult(b) && !(web && !o.sources) ? clip(b.result) : undefined
  const meta = b.meta ? { ...b.meta } : undefined
  if (meta && typeof meta.output === 'string') meta.output = clip(meta.output)
  return {
    name: b.name,
    args: makes ? '{}' : b.name === 'ask_user' ? b.args : showsEverything(b.name) ? clip(b.args) : shortArgs(b.args),
    status: b.status === 'done' ? 'done' : 'error',
    ...(result !== undefined ? { result } : {}),
    ...(meta ? { meta } : {}),
    ...(o.sources && b.sources?.length ? { sources: b.sources } : {}),
    ...(b.answers ? { answers: b.answers } : {}),
    ...(b.skipped ? { skipped: true } : {}),
    ...(b.aspect ? { aspect: b.aspect } : {}),
    startedAt: b.startedAt,
    ...(b.endedAt ? { endedAt: b.endedAt } : {}),
  }
}
