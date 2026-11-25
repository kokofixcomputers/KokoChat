import type { Settings } from '../../types'
import type { ToolDef } from '../tools'
import { github } from './github'
import { google, googleToolsFor } from './google'
import { huggingface, npm, pypi, wikipedia } from './knowledge'
import { notion } from './notion'
import { files } from './files'
import type { Describe, Integration } from './types'

export type { Describe, Integration } from './types'

export const INTEGRATIONS: Integration[] = [files, github, wikipedia, huggingface, pypi, npm, notion, { ...google, toolsFor: googleToolsFor }]

export const integrationOfTool = (name: string) => INTEGRATIONS.find((i) => i.owns(name))

export const integrationTools = (s: Settings, chatId?: string): ToolDef[] => INTEGRATIONS.filter((i) => i.enabled(s)).flatMap((i) => i.toolsFor?.(s, chatId) ?? i.tools)

/** System-prompt guidance for the integrations whose tools are actually offered. */
export const integrationPromptsFor = (tools: ToolDef[]): string =>
  INTEGRATIONS.filter((i) => tools.some((t) => i.owns(t.name))).map((i) => i.prompt).join('\n\n')

/** Tool arguments may still be streaming: pull what is already readable out of the (partial) JSON. */
export function looseArgs(args: string): Record<string, any> {
  try { return JSON.parse(args) } catch { /* partial */ }
  const out: Record<string, any> = {}
  for (const m of args.matchAll(/"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/g)) out[m[1]] = m[2].replace(/\\n/g, '\n').replace(/\\"/g, '"')
  for (const m of args.matchAll(/"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false)/g)) out[m[1]] = m[2] === 'true' ? true : m[2] === 'false' ? false : Number(m[2])
  return out
}

export function describeCall(name: string, args: string): { integration: Integration; d: Describe } | null {
  const integration = integrationOfTool(name)
  if (!integration) return null
  return { integration, d: integration.describe(name, looseArgs(args)) }
}
