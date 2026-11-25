import type { McpServer, Provider, Settings } from '../types'
import { buildMcp } from './mcp'
import { imageProviderPref } from './imagegen'
import { AGENT_TOOLS, isSubChat } from './agents'
import { pluginTools } from './plugins'
import { MEMORY_TOOLS } from './memory'
import { CODE_GENERATE_IMAGE, CODE_TOOLS, isCodeChat } from './codeTools'
import { integrationTools } from './integrations'
import { pickProvider } from './speech'
import { ASK_USER, CREATE_ARTIFACT, CREATE_PRESENTATION, GENERATE_IMAGE, GENERATE_VIDEO, READ_URL, SANDBOX_TOOLS, WEB_SEARCH, type ToolDef } from './tools'

/** The tools that will be offered to the model right now. */
export const toolList = (o: { settings: Settings; providers: Provider[]; mcpServers: McpServer[]; isolated?: boolean; unattended?: boolean; chatId?: string }): ToolDef[] => {
  const t: ToolDef[] = []
  if (o.settings.searchEnabled && o.settings.tavilyKey) t.push(WEB_SEARCH, READ_URL)
  // Code mode: the coding tools, plus web search, images and any MCP servers
  if (isCodeChat(o.chatId)) {
    const c: ToolDef[] = [...CODE_TOOLS]
    if (o.settings.searchEnabled && o.settings.tavilyKey) c.push(WEB_SEARCH, READ_URL)
    if (o.settings.image.enabled && pickProvider(o.providers, o.settings.image.providerId, [imageProviderPref(o.settings.image.model)])) c.push(CODE_GENERATE_IMAGE)
    if (!isSubChat(o.chatId)) c.push(...AGENT_TOOLS)
    c.push(...pluginTools())
    if (o.settings.memory.enabled && o.settings.memory.auto) c.push(...MEMORY_TOOLS)
    c.push(...buildMcp(o.mcpServers).defs)
    return c
  }
  // isolated runs (model comparison) only get read-only web tools: nothing interactive or side-effecting
  if (o.isolated) return t
  // scheduled co-worker runs: research tools, integrations and MCP servers, but nothing that asks or has side effects
  if (o.unattended) return [...t, ...integrationTools(o.settings, o.chatId), ...buildMcp(o.mcpServers).defs]
  t.push(...integrationTools(o.settings, o.chatId))
  t.push(...pluginTools())
  if (o.settings.memory.enabled && o.settings.memory.auto) t.push(...MEMORY_TOOLS)
  if (o.settings.artifactsEnabled) t.push(CREATE_ARTIFACT, CREATE_PRESENTATION)
  if (o.settings.image.enabled && pickProvider(o.providers, o.settings.image.providerId, [imageProviderPref(o.settings.image.model)])) t.push(GENERATE_IMAGE)
  if (o.settings.video.enabled && pickProvider(o.providers, o.settings.video.providerId, [/^gemini-/.test(o.settings.video.model) ? 'gemini' : 'openai'])) t.push(GENERATE_VIDEO)
  t.push(ASK_USER)
  if (o.settings.sandbox.enabled && o.settings.sandbox.apiKey.trim()) t.push(...SANDBOX_TOOLS)
  t.push(...buildMcp(o.mcpServers).defs)
  return t
}
