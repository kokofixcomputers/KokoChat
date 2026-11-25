import type { Settings } from '../../types'
import type { ToolDef } from '../tools'

/** How a tool call reads to the *user*: "Fetching GitHub repository owner/repo", never a tool name. */
export interface Describe {
  /** e.g. "Fetching GitHub repository" */
  present: string
  /** e.g. "Fetched GitHub repository" */
  past: string
  /** e.g. "owner/repo" (shown as code) */
  subject?: string
  /** e.g. "in owner/repo" */
  in?: string
  /** extra detail, e.g. a search phrase */
  extra?: string
  /** a more specific logo for this call (e.g. Gmail inside the Google integration) */
  icon?: string
  /** link to the thing on the service's own website */
  url?: string
  /** shown when it fails, e.g. "Couldn't fetch GitHub repository" */
  failed: string
}

export interface RunCtx {
  chatId?: string
  settings: Settings
  signal: AbortSignal
  update: (fn: (b: any) => void) => void
}

export interface Integration {
  id: string
  name: string
  /** logo key, see IntegrationCard */
  icon: string
  tools: ToolDef[]
  /** tools for the current settings, when they depend on them (e.g. which Google services are on) */
  toolsFor?: (s: Settings, chatId?: string) => ToolDef[]
  /** guidance appended to the system prompt while the integration is on */
  prompt: string
  enabled: (s: Settings) => boolean
  owns: (tool: string) => boolean
  describe: (tool: string, args: Record<string, any>) => Describe
  run: (tool: string, args: Record<string, any>, ctx: RunCtx) => Promise<{ output: string }>
  /** user messages that clearly call for this integration (forces a tool call so weak models do not guess) */
  triggers?: RegExp
}
