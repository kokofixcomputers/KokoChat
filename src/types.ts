export type ApiMode = 'responses' | 'chat' | 'anthropic'
export type Effort = 'auto' | 'minimal' | 'low' | 'medium' | 'high'

export interface Provider {
  id: string
  preset: string // preset id or 'custom'
  name: string
  baseUrl: string
  apiKey: string
  apiMode: ApiMode
  models: ModelInfo[]
  modelsFetchedAt?: number
  /** Send reasoning params for every model (for custom providers) */
  forceReasoning?: boolean
  /** Cloudflare Workers AI: the account the models belong to */
  accountId?: string
  /** models that turn text into vectors (for file search), when the provider lists them separately */
  embedModels?: ModelInfo[]
}

export interface ModelInfo {
  id: string
  created?: number
  /** from the server's model list, when it says */
  vision?: boolean
  reasoning?: boolean
}

export interface Attachment {
  id: string
  name: string
  mime: string
  dataUrl: string
  /** 'text' attachments carry their content inline */
  kind?: 'image' | 'text'
  text?: string
  /** large files (PDFs, long text) are indexed for search instead of being pasted into the prompt */
  kbId?: string
}

export interface Source {
  n: number
  title: string
  url: string
  snippet: string
  domain: string
}

export type Block =
  | { type: 'reasoning'; id: string; text: string; startedAt: number; endedAt?: number }
  | { type: 'text'; id: string; text: string }
  | {
      type: 'tool'
      id: string
      callId: string
      name: string
      args: string
      status: 'running' | 'done' | 'error'
      result?: string
      sources?: Source[]
      artifactId?: string
      phase?: 'enhancing' | 'generating' | 'asking' | 'approval' | 'reviewing'
      meta?: Record<string, unknown>
      answers?: Record<string, string | string[]>
      skipped?: boolean
      enhanced?: string
      aspect?: string
      startedAt: number
      endedAt?: number
    }

export type ArtifactKind = 'html' | 'chart' | 'svg' | 'markdown' | 'code' | 'image' | 'diagram' | 'app' | 'video' | 'slides'

export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  language?: string
  content: string
  version: number
  meta?: { prompt?: string; enhanced?: string; model?: string; aspect?: string; seconds?: number }
}

/** Optional measurements of one reply (see lib/stats.ts). Times are in milliseconds; fields with nothing to say are left out. */
export interface ReplyStats {
  /** provider name at the time */
  via: string
  /** the model the server says it used, when it differs from the one asked for */
  served?: string
  /** time to first token (reasoning, text or tool call) */
  ttft?: number
  /** output tokens per second while generating */
  tps?: number
  /** input tokens (cache reads and writes included) and output tokens, summed over every request */
  in: number
  out: number
  /** true when a number is (partly) worked out from the text length, because the provider did not report it */
  estIn?: boolean
  estOut?: boolean
  estTps?: boolean
  cached?: number
  cacheWrite?: number
  reasoning?: number
  /** some reasoning was hidden or summarized, so the speed leaves it out */
  hidden?: boolean
  /** a request was stopped or failed part-way */
  partial?: boolean
  /** number of model requests, when more than one (tool loops) */
  requests?: number
  /** time spent waiting for and receiving the model */
  modelMs: number
  /** time spent running tools, including waiting for your answers and approvals */
  toolMs?: number
  /** USD from the price list; an estimate */
  cost?: number
}

/** Everything about a reply that can differ between regenerations. */
export interface MessageVersion {
  blocks?: Block[]
  artifacts?: Artifact[]
  sources?: Source[]
  model?: string
  status?: Message['status']
  error?: string
  durationMs?: number
  stats?: ReplyStats
  edited?: boolean
  createdAt: number
  mode?: 'research'
}

export interface Message {
  /** compare mode: this reply is one of several (one per model) to the same message */
  cmp?: { group: string; lane: number; providerId?: string; picked?: boolean }
  /** other versions of this reply (the message itself is the one currently shown) */
  alts?: MessageVersion[]
  mode?: 'research'
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  text?: string // user text
  attachments?: Attachment[]
  blocks?: Block[] // assistant
  artifacts?: Artifact[]
  sources?: Source[]
  error?: string
  model?: string
  status?: 'streaming' | 'done' | 'stopped' | 'error'
  durationMs?: number
  stats?: ReplyStats
  edited?: boolean
  /** text the user quoted from earlier messages */
  quotes?: string[]
  /** this "user" message is really the reports of finished sub-agents */
  reports?: { id: string; name: string }[]
  /** the message was written with a slash command: shown as a command chip plus what the user typed */
  cmd?: { slash: string; name: string; input: string; fields?: Record<string, string> }
}

export interface ChatSummary { text: string; upToMessageId: string; createdAt: number; tokensBefore: number; tokensAfter: number }

export interface ChatSandbox { vmId: string; slug: string; createdAt: number; home?: string; info?: string; urls?: { port: number; url: string }[] }

export interface Chat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: Message[]
  providerId?: string
  model?: string
  pinned?: boolean
  titled?: boolean
  forkedFrom?: { chatId: string; title: string }
  /** older messages folded into a summary for the model (the UI still shows them) */
  summary?: ChatSummary
  /** this chat's Freestyle VM (the AI's sandbox) */
  sandbox?: ChatSandbox
  /** public share links created for this chat */
  shares?: { id: string; created: number; expires?: number; size?: number }[]
  /** ids of removed messages, so a sync merge never resurrects them */
  deleted?: string[]
  /** per-chat custom instructions */
  system?: string
  projectId?: string
  /** Code mode session: an agent working inside the folder `cwd` (desktop app only, never synced) */
  mode?: 'code'
  cwd?: string
  /** the agent's task list (Code mode) */
  todos?: Todo[]
  /** a sub-agent: a hidden Code chat started by another session, running in the background */
  sub?: { parentId: string; name: string; task: string; delivered: boolean }
}

export interface Project {
  id: string
  name: string
  instructions: string
  createdAt: number
}

/** A file indexed for search (its text chunks live in IndexedDB under `kb:<id>`). */
export interface KbFile {
  id: string
  name: string
  size: number
  mime: string
  chunks: number
  embedded: boolean
  addedAt: number
  scope: { project?: string; chat?: string }
}

/** One step of the plan the Code agent keeps for the current task. */
export interface Todo { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }

/** A one-click command for a project (deploy, build, test…). The AI can create them; the user runs them. */
export interface ProjectAction { id: string; cwd: string; name: string; command: string; description?: string; source: 'ai' | 'user'; createdAt: number; /** the command the user has seen and allowed to run */ approved?: string; lastRunAt?: number }

/** One thing the AI remembers about you, across every chat. */
export interface Memory { id: string; text: string; createdAt: number; updatedAt: number; source: 'ai' | 'user'; /** only for Code sessions in this folder */ cwd?: string }

/** How one {field} of a prompt is asked for. Fields are named in the prompt text, for example {currency}. */
export interface PromptFieldMeta { kind?: 'text' | 'select'; options?: string[]; def?: string }
/** One input a plugin asks for in Settings → Plugins. */
export interface PluginSetting { key: string; label: string; type: 'boolean' | 'string' | 'number' | 'select' | 'textarea'; default?: unknown; description?: string; options?: (string | { value: string; label: string })[]; min?: number; max?: number; placeholder?: string }
/** An installed plugin. `source` is its JavaScript; the rest is what Settings shows without running it. */
export interface PluginRecord {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  source: string
  enabled: boolean
  /** names of this plugin's tools the user turned off */
  toolsOff: string[]
  values: Record<string, unknown>
  settings: PluginSetting[]
  tools: { name: string; description: string }[]
  installedAt: number
  /** what the plugin says it needs: ai, chat, network, storage, notifications */
  permissions?: string[]
  /** where it was installed from (so it can be checked for updates) */
  sourceUrl?: string
  /** SHA-256 of the code */
  hash?: string
}
export interface Prompt { id: string; name: string; slash: string; text: string; fields?: Record<string, PromptFieldMeta> }

export interface AppearanceSettings {
  accent: 'green' | 'blue' | 'violet' | 'rose' | 'orange' | 'slate'
  palette: 'default' | 'warm' | 'slate' | 'black'
  /** chat text size, percent */
  fontScale: number
  font: 'inter' | 'system' | 'serif' | 'mono'
}

export interface RagSettings { embed: boolean; providerId: string; model: string }

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpOAuth {
  clientId?: string
  meta?: { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string }
  resource?: string
  scope?: string
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
}

export interface McpServer {
  oauth?: McpOAuth
  id: string
  name: string
  url: string
  token?: string
  enabled: boolean
  tools: McpTool[]
  disabledTools?: string[]
}

export interface SttSettings { engine: 'koko' | 'api' | 'browser'; providerId: string; model: string; language: string }
export interface TtsSettings { engine: 'api' | 'browser'; providerId: string; model: string; voice: string; voiceURI: string; rate: number }

export interface ImageSettings { enabled: boolean; providerId: string; model: string; quality: string; aspect: 'auto' | 'square' | 'landscape' | 'portrait' }

export interface VideoSettings { enabled: boolean; providerId: string; model: string; aspect: 'auto' | 'landscape' | 'portrait'; seconds: number; resolution: '720p' | '1080p' }

export interface SandboxSettings { enabled: boolean; apiKey: string; idleMinutes: number; ttlHours: number; snapshotId: string; sleepAfterTurn: boolean }

export interface CompareSettings { enabled: boolean; models: { providerId: string; model: string }[] }

export interface IntegrationsSettings {
  github: { enabled: boolean; token: string }
  wikipedia: { enabled: boolean }
  huggingface: { enabled: boolean; token: string }
  pypi: { enabled: boolean }
  npm: { enabled: boolean }
  google: { enabled: boolean; clientId: string; calendar: boolean; gmail: boolean; drive: boolean }
  notion: { enabled: boolean; token: string }
}

/** Optional model settings. A missing value means the model's own default. */
export interface AdvancedSettings { enabled: boolean; temperature?: number; topP?: number; topK?: number; maxTokens?: number; frequencyPenalty?: number; presencePenalty?: number }

export interface Settings {
  advanced?: AdvancedSettings
  /** system notifications when the window is not in front */
  notifications: { enabled: boolean; onFinish: boolean; onApproval: boolean; sound: boolean }
  memory: { enabled: boolean; auto: boolean }
  /** permission mode new Code sessions start in (bypass is never a default) */
  codeDefaultPermission?: 'ask' | 'acceptEdits' | 'auto'
  /** the small model that reviews commands in Auto mode (default: the selected model) */
  codeGuard?: { providerId: string; model: string }
  appearance: AppearanceSettings
  prompts: Prompt[]
  rag: RagSettings
  integrations: IntegrationsSettings
  compare: CompareSettings
  deepResearch: boolean
  sandbox: SandboxSettings
  autoCompact: boolean
  /** measure each reply (time to first token, tokens per second, token counts) and show it under the reply */
  replyStats: boolean
  /** context window override in tokens (0 = guess from the model name) */
  contextWindow: number
  image: ImageSettings
  video: VideoSettings
  stt: SttSettings
  tts: TtsSettings
  tavilyKey: string
  systemPrompt: string
  theme: 'light' | 'dark' | 'system'
  searchEnabled: boolean
  artifactsEnabled: boolean
  effort: Effort
  searchMode: 'auto' | 'first' | 'always'
  searchDepth: 'basic' | 'advanced'
  maxResults: number
}
