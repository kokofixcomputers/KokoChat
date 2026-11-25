import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type { ProjectAction, Memory, PluginRecord, Attachment, Chat, ChatSandbox, MessageVersion, Effort, McpServer, Message, Project, Provider, Settings, KbFile } from './types'
import type { UsageRow } from './lib/usage'
import type { Overrides } from './lib/pricing'
import { DEFAULT_PROMPTS } from './lib/prompts'

/** earlier built-in texts of prompts that gained fields, so unedited copies can be upgraded */
const OLD_DEFAULTS: Record<string, string[]> = {
  'p-translate': ['Translate the following to English. Keep the tone and formatting, and only output the translation:\n\n{{input}}', 'Translate the following to {{language|English}}. Keep the tone and formatting, and only output the translation:\n\n{{input}}'],
  'p-email': ['Write a concise, polite email about the following. Give a subject line and the body:\n\n{{input}}', 'Write a concise, {{tone|polite}} email about the following. Give a subject line and the body:\n\n{{input}}'],
  'p-brainstorm': ['Brainstorm 10 varied, specific ideas for the following. Group them and mark the three most promising:\n\n{{input}}', 'Brainstorm {{count|10}} varied, specific ideas for the following. Group them and mark the three most promising:\n\n{{input}}'],
}
import { dropKb, kbFilesFor } from './lib/kb'
import type { Approval, PermissionMode } from './lib/permissions'
import { koko } from './lib/desktop'
import { codeSystemPrompt } from './lib/codePrompt'
import { memoryBlock } from './lib/memory'
import { emitPluginEvent, hasBeforeSend, runBeforeSend } from './lib/plugins'
import { MAIN_AGENT_PROMPT, SUB_AGENT_PROMPT, childrenOf, deliverPending, reportsText, trackRun } from './lib/agents'
import { uid } from './lib/utils'
import { toast } from './lib/toast'
import { runAssistant, generateTitle } from './lib/llm'
import { canCompact, contextWindowFor, estimateContext, runCompaction } from './lib/context'
import { resolveForModel } from './lib/lanes'
import { setMcpPersist } from './lib/mcpAuth'
import type { CoJob } from './lib/coworker'

let timer: ReturnType<typeof setTimeout> | undefined
let pending: string | undefined

const idbStorage: StateStorage = {
  getItem: async (k) => (await idbGet(k)) ?? null,
  // debounced: image artifacts are large and streaming updates state many times a second
  setItem: (k, v) => {
    pending = v
    clearTimeout(timer)
    return new Promise<void>((resolve) => {
      timer = setTimeout(() => { idbSet(k, pending as string).finally(resolve) }, 400)
    })
  },
  removeItem: (k) => idbDel(k),
}

/** Merge saved integration settings over the defaults, one service at a time (new services appear with their defaults). */
export const mergeIntegrations = (v: any): Settings['integrations'] => {
  const out: any = {}
  for (const k of Object.keys(DEFAULT_SETTINGS.integrations)) out[k] = { ...(DEFAULT_SETTINGS.integrations as any)[k], ...(v?.[k] ?? {}) }
  return out
}

export interface QueuedMsg { id: string; text: string; attachments: Attachment[]; quotes?: string[]; cmd?: Message['cmd'] }

export const DEFAULT_SETTINGS: Settings = {
  memory: { enabled: true, auto: true },
  notifications: { enabled: true, onFinish: true, onApproval: true, sound: true },
  appearance: { accent: 'green', palette: 'default', fontScale: 100, font: 'inter' },
  prompts: DEFAULT_PROMPTS,
  rag: { embed: true, providerId: '', model: 'text-embedding-3-small' },
  integrations: {
    github: { enabled: true, token: '' },
    wikipedia: { enabled: true },
    huggingface: { enabled: true, token: '' },
    pypi: { enabled: true },
    npm: { enabled: true },
    google: { enabled: false, clientId: '', calendar: true, gmail: true, drive: true },
    notion: { enabled: false, token: '' },
  },
  compare: { enabled: false, models: [] },
  deepResearch: false,
  sandbox: { enabled: false, apiKey: '', idleMinutes: 10, ttlHours: 8, snapshotId: '', sleepAfterTurn: true },
  autoCompact: true,
  contextWindow: 0,
  image: { enabled: true, providerId: '', model: 'gpt-image-1', quality: 'medium', aspect: 'auto' },
  video: { enabled: false, providerId: '', model: 'gemini-omni-1.2-flash', aspect: 'auto', seconds: 8, resolution: '720p' },
  stt: { engine: 'api', providerId: '', model: 'gpt-4o-mini-transcribe', language: '' },
  tts: { engine: 'browser', providerId: '', model: 'gpt-4o-mini-tts', voice: 'alloy', voiceURI: '', rate: 1 },
  tavilyKey: '',
  systemPrompt: 'You are a helpful, thoughtful AI assistant.',
  theme: 'system',
  searchEnabled: true,
  artifactsEnabled: true,
  effort: 'auto',
  searchMode: 'first',
  searchDepth: 'basic',
  maxResults: 6,
}

export type SandboxState = 'unknown' | 'active' | 'waking' | 'sleeping' | 'asleep' | 'gone'

export interface BaseEntry { rev: number; hash: string | null; data?: any }
export interface SyncState { url: string; email: string; token: string; salt: string; auto: boolean; passphrase: string; lastSyncAt?: number; usage?: { used: number; quota: number }; admin?: boolean; base: Record<string, BaseEntry> }
export interface SyncStatus { phase: 'idle' | 'syncing' | 'error'; message?: string; code?: string; at?: number }
export const DEFAULT_SYNC: SyncState = { url: (import.meta.env.VITE_SYNC_URL as string | undefined) ?? '', email: '', token: '', salt: '', auto: true, passphrase: '', base: {} }

export type Panel = { kind: 'artifact'; messageId: string; artifactId: string } | { kind: 'sources'; messageId: string }
export type PanelState = Panel | null

interface State {
  chats: Chat[]
  activeId: string | null
  providers: Provider[]
  selected: { providerId: string; model: string } | null
  settings: Settings
  mcpServers: McpServer[]
  sync: SyncState
  syncStatus: SyncStatus
  setSync: (p: Partial<SyncState>) => void
  setSyncStatus: (s: SyncStatus) => void
  // transient
  panel: PanelState
  settingsOpen: boolean
  settingsTab: 'providers' | 'code' | 'tools' | 'integrations' | 'mcp' | 'voice' | 'sync' | 'admin' | 'usage' | 'prompts' | 'plugins' | 'memory' | 'general'
  appMode: 'chat' | 'code'
  coworkers: CoJob[]
  plugins: PluginRecord[]
  memories: Memory[]
  actions: ProjectAction[]
  /** messages sent while the AI was still working, per chat (delivered after its next tool call, or when it finishes) */
  queue: Record<string, QueuedMsg[]>
  removeQueued: (chatId: string, id: string) => void
  sendQueuedNow: (chatId: string) => void
  saveAction: (a: Omit<ProjectAction, 'id' | 'createdAt'> & { id?: string }) => ProjectAction
  patchAction: (id: string, patch: Partial<ProjectAction>) => void
  deleteAction: (id: string) => void
  addMemory: (m: Memory) => void
  updateMemory: (id: string, patch: Partial<Memory>) => void
  deleteMemory: (id: string) => void
  clearMemories: () => void
  installPlugin: (r: PluginRecord) => void
  patchPlugin: (id: string, f: (r: PluginRecord) => PluginRecord) => void
  removePlugin: (id: string) => void
  coRunning: Record<string, AbortController>
  coworkOpen: boolean
  setCoworkOpen: (b: boolean) => void
  addCoworker: (j: Omit<CoJob, 'id' | 'createdAt' | 'runs'>) => string
  patchCoworker: (id: string, f: (j: CoJob) => CoJob) => void
  deleteCoworker: (id: string) => void
  setAppMode: (m: 'chat' | 'code') => void
  recentFolders: string[]
  codeRules: { id: string; cwd: string; kind: 'command'; pattern: string }[]
  removeCodeRule: (id: string) => void
  /** per-session permission mode; lives in memory only, so "bypass" never survives a restart */
  codePerm: Record<string, PermissionMode>
  setCodePerm: (chatId: string, m: PermissionMode) => void
  approvals: Record<string, Approval>
  bypassPrompt: string | null
  setBypassPrompt: (chatId: string | null) => void
  newCodeChat: (cwd: string) => string
  startSubAgent: (parentId: string, name: string, task: string) => string
  reportToParent: (parentId: string, agentIds: string[]) => void
  projects: Project[]
  kbFiles: KbFile[]
  usage: Record<string, UsageRow>
  priceOverrides: Overrides
  projectDialog: string | null
  openProject: (id: string | null) => void
  addProject: (name?: string) => string
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void
  moveChat: (chatId: string, projectId: string | undefined) => void
  streaming: Record<string, AbortController> // chatId -> controller
  compacting: Record<string, boolean>
  sandboxState: Record<string, SandboxState>
  setSandboxState: (chatId: string, s: SandboxState) => void
  quotes: string[]
  addQuote: (t: string) => void
  removeQuote: (i: number) => void
  clearQuotes: () => void
  sidebarOpen: boolean
  speaking: { id: string; phase: 'loading' | 'playing' } | null
  setSpeaking: (s: State['speaking']) => void

  newChat: (projectId?: string) => string
  openChat: (id: string) => void
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  pinChat: (id: string) => void
  clearChat: (id: string) => void
  addProvider: (p: Provider) => void
  updateProvider: (id: string, patch: Partial<Provider>) => void
  removeProvider: (id: string) => void
  select: (providerId: string, model: string) => void
  setSettings: (patch: Partial<Settings>) => void
  addMcp: (s: McpServer) => void
  updateMcp: (id: string, patch: Partial<McpServer>) => void
  removeMcp: (id: string) => void
  setPanel: (p: PanelState) => void
  openSettings: (tab?: State['settingsTab']) => void
  closeSettings: () => void
  setSidebar: (b: boolean) => void
  send: (text: string, attachments: Attachment[], quotes?: string[], cmd?: Message['cmd'], chatId?: string, now?: boolean) => Promise<void>
  compactChat: (chatId: string, focus?: string, history?: Message[]) => Promise<boolean>
  clearSummary: (chatId: string) => void
  setSandbox: (chatId: string, sb: ChatSandbox | undefined) => void
  removeSandbox: (chatId: string) => Promise<void>
  addShare: (chatId: string, s: NonNullable<Chat['shares']>[number]) => void
  removeShare: (chatId: string, id: string) => void
  regenerate: (chatId: string, messageId: string, pick?: { providerId: string; model: string }) => Promise<void>
  pickLane: (chatId: string, messageId: string) => void
  keepLane: (chatId: string, messageId: string) => void
  switchVersion: (chatId: string, messageId: string, altIndex: number) => void
  removeVersion: (chatId: string, messageId: string) => void
  editResend: (chatId: string, messageId: string, text: string) => Promise<void>
  setChatSystem: (chatId: string, system: string) => void
  editMessage: (chatId: string, messageId: string, text: string) => void
  forkChat: (chatId: string, messageId: string) => string | null
  deleteMessage: (chatId: string, messageId: string) => void
  restoreMessage: (chatId: string, index: number, message: Message) => void
  importChats: (chats: Chat[]) => void
  stop: (chatId: string) => void
}

const VERSION_KEYS = ['blocks', 'artifacts', 'sources', 'model', 'status', 'error', 'durationMs', 'edited', 'createdAt', 'mode'] as const
const takeVersion = (m: Message): MessageVersion => { const v: any = {}; for (const k of VERSION_KEYS) v[k] = (m as any)[k]; return v }
const pickVersion = (v: MessageVersion): Partial<Message> => { const o: any = {}; for (const k of VERSION_KEYS) o[k] = (v as any)[k]; return o }

/** true if the message lies inside the part of the chat that was folded into the summary */
const inSummarized = (c: Chat, messageId: string) => {
  if (!c.summary) return false
  const cut = c.messages.findIndex((m) => m.id === c.summary!.upToMessageId)
  const i = c.messages.findIndex((m) => m.id === messageId)
  return cut >= 0 && i >= 0 && i <= cut
}

/** Everything the model should know about this chat beyond the global system prompt: project instructions, the chat's own instructions and which files it can search. */
const AUTO_MODE_PROMPT = `Permission mode: Auto. A safety reviewer checks your commands before they run. Normal development work (build, test, lint, installing project dependencies, git commits, editing files) goes through. Anything that cannot be undone or that leaves this machine, such as deploying, publishing, git push, merging, deleting data, sending requests that change a remote service, or running things as administrator, is BLOCKED unless the user explicitly asked for that action in their own messages. If something is blocked, do not retry it or look for a way around it. Finish the rest of the work, then tell the user what is ready and what they need to say to proceed (for example "say 'deploy after you are done' and I will"), or add it with create_action so they can run it with a click. If the user already told you to deploy or push when finished, do it at the end.`

function chatContext(chat: Chat | undefined, code?: Awaited<ReturnType<typeof codeContext>>): string {
  if (!chat) return ''
  const st = useStore.getState()
  const project = chat.projectId ? st.projects.find((p) => p.id === chat.projectId) : undefined
  const files = kbFilesFor(chat.id)
  return [
    chat.mode === 'code' ? codeSystemPrompt(chat.cwd ?? '', code) : '',
    chat.mode === 'code' ? (chat.sub ? SUB_AGENT_PROMPT(chat.sub.name) : MAIN_AGENT_PROMPT) : '',
    chat.mode === 'code' && (st.codePerm[chat.sub?.parentId ?? chat.id] ?? st.settings.codeDefaultPermission) === 'auto' ? AUTO_MODE_PROMPT : '',
    memoryBlock(chat),
    project?.instructions.trim() ? `Project "${project.name}" instructions:\n${project.instructions.trim()}` : '',
    chat.system?.trim() ?? '',
    files.length ? `Files you can search with kb_search / kb_read:\n${files.map((f) => `- ${f.name} (${f.chunks} parts${f.scope.project ? ', project file' : ', uploaded in this chat'})`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

/** What the agent should know about the folder it works in (project instructions, git state, top-level files). */
async function codeContext(chat: Chat | undefined) {
  const k = koko()
  if (!k || chat?.mode !== 'code' || !chat.cwd) return undefined
  const r = await k.project.context({ cwd: chat.cwd }).catch(() => null)
  return r && r.ok ? r.data : undefined
}

const blankChat = (): Chat => ({ id: uid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] })

export const useStore = create<State>()(
  persist(
    (set, get) => {
      const patchChat = (id: string, fn: (c: Chat) => Chat) =>
        set((s) => ({
          chats: s.chats.map((c) => {
            if (c.id !== id) return c
            const n = fn(c)
            if (n.messages === c.messages) return n
            // remember removed message ids so syncing with another device never brings them back
            const keep = new Set(n.messages.map((m) => m.id))
            const removed = c.messages.filter((m) => !keep.has(m.id)).map((m) => m.id)
            const had = n.deleted ?? []
            if (!removed.length && !had.some((d) => keep.has(d))) return n
            return { ...n, deleted: [...new Set([...had, ...removed])].filter((d) => !keep.has(d)).slice(-500) }
          }),
        }))

      /** Send what the user queued while the AI was busy, as one message. Returns whether anything was sent. */
      function drainQueue(chatId: string): boolean {
        const q = get().queue[chatId]
        if (!q?.length || get().streaming[chatId]) return false
        set((s) => { const n = { ...s.queue }; delete n[chatId]; return { queue: n } })
        const text = q.map((m) => m.text).join('\n\n')
        const attachments = q.flatMap((m) => m.attachments)
        const quotes = q.flatMap((m) => m.quotes ?? [])
        void get().send(text, attachments, quotes, q.length === 1 ? q[0].cmd : undefined, chatId, true)
        return true
      }

      async function generate(chatId: string, history: Message[], opts?: { versionOf?: Message; providerId?: string; model?: string; lane?: number; cmp?: Message['cmp']; ctrl?: AbortController; shared?: { left: number } }) {
        const s = get()
        const chat = s.chats.find((c) => c.id === chatId)!
        const providerId = opts?.providerId ?? chat.providerId ?? s.selected?.providerId
        const model = opts?.model ?? chat.model ?? s.selected?.model
        const provider = s.providers.find((p) => p.id === providerId)
        const base = opts?.versionOf
        const isLane = opts?.lane !== undefined
        const research = !isLane && chat.mode !== 'code' && s.settings.deepResearch && !!s.settings.tavilyKey && s.settings.searchEnabled
        const modelHistory = resolveForModel(history, opts?.lane) // what the model sees (one lane's thread, or the picked replies)
        // regenerating keeps the old reply as another version of the same message
        const draft: Message = { id: base?.id ?? uid(), role: 'assistant', createdAt: Date.now(), blocks: [], artifacts: [], sources: [], status: 'streaming', model, ...(opts?.cmp ? { cmp: opts.cmp } : {}), ...(research ? { mode: 'research' as const } : {}), ...(base ? { alts: [...(base.alts ?? []), takeVersion(base)] } : {}) }
        const ctrl = opts?.ctrl ?? new AbortController()
        const t0 = Date.now()
        if (!opts?.ctrl) set((st) => ({ streaming: { ...st.streaming, [chatId]: ctrl } }))
        if (!isLane) patchChat(chatId, (c) => ({ ...c, messages: [...history, structuredClone(draft)] }))
        else if (base) patchChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === draft.id ? structuredClone(draft) : m)) })) // regenerate one lane in place
        else patchChat(chatId, (c) => ({ ...c, messages: [...c.messages, structuredClone(draft)] }))

        let raf = 0
        const flush = () => {
          if (raf) return
          raf = requestAnimationFrame(() => {
            raf = 0
            const snap: Message = { ...draft, blocks: draft.blocks!.map((b) => ({ ...b })), artifacts: [...(draft.artifacts ?? [])], sources: [...(draft.sources ?? [])] }
            patchChat(chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === draft.id ? snap : m)) }))
          })
        }
        const finish = (status: Message['status'], error?: string) => {
          cancelAnimationFrame(raf); raf = 0
          draft.status = status
          draft.durationMs = Date.now() - t0
          if (error) draft.error = error
          for (const b of draft.blocks!) {
            if (b.type === 'reasoning' && !b.endedAt) b.endedAt = Date.now()
            if (b.type === 'tool' && b.status === 'running') { b.status = 'error'; b.endedAt = Date.now(); b.result = b.result ?? 'Cancelled' }
          }
          const snap: Message = { ...draft, blocks: draft.blocks!.map((b) => ({ ...b })) }
          patchChat(chatId, (c) => ({ ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === draft.id ? snap : m)) }))
          // with several lanes the turn is over when the last one finishes
          if (opts?.shared && --opts.shared.left > 0) return
          set((st) => { const n = { ...st.streaming }; delete n[chatId]; return { streaming: n } })
          // end of the turn: put the chat's VM to sleep (it wakes by itself on the next command or file write)
          if (get().chats.find((c) => c.id === chatId)?.sandbox) void import('./lib/sandbox').then((m) => m.sleepAfterTurn(chatId))
        }

        if (!provider || !model) {
          finish('error', 'No model selected. Add a provider in Settings and choose a model.')
          return
        }
        if (!provider.apiKey && !['ollama', 'lmstudio', 'custom'].includes(provider.preset)) {
          finish('error', `Add your ${provider.name} API key in Settings → Providers.`)
          return
        }
        try {
          // auto-compact when the conversation is close to the model's context window
          const st = get()
          const cur = st.chats.find((c) => c.id === chatId)
          if (st.settings.autoCompact && cur && !isLane) {
            const est = estimateContext({ settings: st.settings, providers: st.providers, mcpServers: st.mcpServers, chat: { ...cur, messages: modelHistory }, history: modelHistory, model })
            if (est.pct > 0.8 && canCompact(modelHistory, cur.summary)) await get().compactChat(chatId, undefined, modelHistory).catch(() => false)
          }
          const after = get().chats.find((c) => c.id === chatId)
          const code = await codeContext(after)
          await runAssistant({ provider, model, history: modelHistory, draft, chatId, isolated: isLane, yieldNow: isLane ? undefined : () => (get().queue[chatId]?.length ?? 0) > 0, summary: isLane ? undefined : after?.summary, settings: isLane ? { ...get().settings, deepResearch: false } : get().settings, mcpServers: get().mcpServers, providers: get().providers, chatSystem: chatContext(after, code), effort: get().settings.effort, signal: ctrl.signal, flush })
          finish('done')
          if (!isLane) emitPluginEvent('message:done', { chatId, message: { id: draft.id, text: (draft.blocks ?? []).filter((b) => b.type === 'text').map((b: any) => b.text).join('\n\n'), model: draft.model, durationMs: draft.durationMs } })
        } catch (e: any) {
          if (ctrl.signal.aborted) finish('stopped')
          else finish('error', String(e?.message ?? e))
        }
        if (draft.status === 'done' && !isLane) {
          if (!drainQueue(chatId)) {
            const me = get().chats.find((c) => c.id === chatId)
            if (me?.mode === 'code' && !me.sub) void deliverPending(chatId)
            // tell the user, unless this is a sub-agent or its helpers are still working (the main reply will say when everything is done)
            if (me && !me.sub && !childrenOf(chatId).some((c) => !c.sub!.delivered)) void import('./lib/notify').then((m) => m.notifyFinished(chatId, { text: (draft.blocks ?? []).filter((b) => b.type === 'text').map((b: any) => b.text).join('\n'), ms: draft.durationMs }))
          }
        } else if (draft.status === 'error' && !isLane && !get().chats.find((c) => c.id === chatId)?.sub) void import('./lib/notify').then((m) => m.notifyFinished(chatId, { text: '', error: draft.error ?? 'Unknown error' }))
        // auto title: only after the first exchange of a chat, using the selected model
        const c2 = get().chats.find((c) => c.id === chatId)
        if (c2 && !c2.titled && draft.status === 'done' && (!isLane || opts?.lane === 0) && history.filter((m) => m.role === 'user').length === 1) {
          patchChat(chatId, (c) => ({ ...c, titled: true }))
          const t = await generateTitle(provider, model, [...history, draft])
          if (t) get().renameChat(chatId, t)
        }
      }

      return {
        chats: [],
        activeId: null,
        providers: [],
        selected: null,
        settings: DEFAULT_SETTINGS,
        mcpServers: [],
        sync: DEFAULT_SYNC,
        syncStatus: { phase: 'idle' },
        setSync: (p) => set((s) => ({ sync: { ...s.sync, ...p } })),
        setSyncStatus: (syncStatus) => set({ syncStatus }),
        panel: null,
        settingsOpen: false,
        settingsTab: 'providers',
        streaming: {},
        compacting: {},
        sandboxState: {},
        setSandboxState: (chatId, s) => set((x) => (x.sandboxState[chatId] === s ? x : { sandboxState: { ...x.sandboxState, [chatId]: s } })),
        quotes: [],
        addQuote: (t) => set((s) => (s.quotes.includes(t) ? s : { quotes: [...s.quotes, t].slice(-6) })),
        removeQuote: (i) => set((s) => ({ quotes: s.quotes.filter((_, j) => j !== i) })),
        clearQuotes: () => set({ quotes: [] }),
        sidebarOpen: true,
        speaking: null,
        setSpeaking: (speaking) => set({ speaking }),

        appMode: 'chat',
        coworkers: [],
        plugins: [],
        memories: [],
        actions: [],
        queue: {},
        removeQueued: (chatId, id) => set((s) => ({ queue: { ...s.queue, [chatId]: (s.queue[chatId] ?? []).filter((q) => q.id !== id) } })),
        sendQueuedNow: (chatId) => { get().streaming[chatId]?.abort(); setTimeout(() => drainQueue(chatId), 150) },
        saveAction: (a) => {
          const same = get().actions.find((x) => x.id === a.id || (x.cwd === a.cwd && x.name.toLowerCase() === a.name.toLowerCase()))
          const next: ProjectAction = same ? { ...same, ...a, id: same.id, createdAt: same.createdAt, approved: a.source === 'user' ? a.command : same.command === a.command ? same.approved : undefined } : { ...a, id: a.id ?? uid(), createdAt: Date.now(), approved: a.source === 'user' ? a.command : undefined }
          set((st) => ({ actions: same ? st.actions.map((x) => (x.id === same.id ? next : x)) : [...st.actions, next] }))
          return next
        },
        patchAction: (id, patch) => set((s) => ({ actions: s.actions.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
        deleteAction: (id) => set((s) => ({ actions: s.actions.filter((x) => x.id !== id) })),
        addMemory: (m) => set((s) => ({ memories: s.memories.some((x) => x.id === m.id) ? s.memories : [m, ...s.memories] })),
        updateMemory: (id, patch) => set((s) => ({ memories: s.memories.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m)) })),
        deleteMemory: (id) => set((s) => ({ memories: s.memories.filter((m) => m.id !== id) })),
        clearMemories: () => set({ memories: [] }),
        installPlugin: (r) => set((s) => ({ plugins: s.plugins.some((p) => p.id === r.id) ? s.plugins.map((p) => (p.id === r.id ? r : p)) : [...s.plugins, r] })),
        patchPlugin: (id, f) => set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? f(p) : p)) })),
        removePlugin: (id) => set((s) => ({ plugins: s.plugins.filter((p) => p.id !== id) })),
        coRunning: {},
        coworkOpen: false,
        setCoworkOpen: (coworkOpen) => set({ coworkOpen, panel: null }),
        addCoworker: (j) => { const id = uid(); set((s) => ({ coworkers: [...s.coworkers, { ...j, id, createdAt: Date.now(), runs: [] }] })); return id },
        patchCoworker: (id, f) => set((s) => ({ coworkers: s.coworkers.map((j) => (j.id === id ? f(j) : j)) })),
        deleteCoworker: (id) => { get().coRunning[id]?.abort(); set((s) => ({ coworkers: s.coworkers.filter((j) => j.id !== id) })) },
        setAppMode: (m) => {
          const cur = get().chats.find((c) => c.id === get().activeId)
          if ((cur?.mode === 'code') === (m === 'code')) { set({ appMode: m, panel: null }); return }
          const target = get().chats.filter((c) => !c.sub && (c.mode === 'code') === (m === 'code') && c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt)[0]
          set({ appMode: m, panel: null, quotes: [], activeId: target?.id ?? null })
          if (!target && m === 'chat') get().newChat()
        },
        recentFolders: [],
        codeRules: [],
        removeCodeRule: (id) => set((s) => ({ codeRules: s.codeRules.filter((r) => r.id !== id) })),
        codePerm: {},
        setCodePerm: (chatId, m) => set((s) => ({ codePerm: { ...s.codePerm, [chatId]: m } })),
        approvals: {},
        bypassPrompt: null,
        setBypassPrompt: (bypassPrompt) => set({ bypassPrompt }),
        newCodeChat: (cwd) => {
          const existing = get().chats.find((c) => c.mode === 'code' && c.cwd === cwd && c.messages.length === 0)
          const recent = [cwd, ...get().recentFolders.filter((f) => f !== cwd)].slice(0, 8)
          if (existing) { set({ activeId: existing.id, appMode: 'code', panel: null, recentFolders: recent }); return existing.id }
          const c: Chat = { ...blankChat(), title: 'New session', mode: 'code', cwd }
          set((s) => ({ chats: [c, ...s.chats], activeId: c.id, appMode: 'code', panel: null, recentFolders: recent }))
          return c.id
        },
        projects: [],
        kbFiles: [],
        usage: {},
        priceOverrides: {},
        projectDialog: null,
        openProject: (projectDialog) => set({ projectDialog }),
        addProject: (name) => { const p: Project = { id: uid(), name: name?.trim() || 'New project', instructions: '', createdAt: Date.now() }; set((s) => ({ projects: [p, ...s.projects] })); return p.id },
        updateProject: (id, patch) => set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
        deleteProject: (id) => {
          void dropKb(get().kbFiles.filter((f) => f.scope.project === id).map((f) => f.id))
          set((s) => ({ projects: s.projects.filter((p) => p.id !== id), projectDialog: s.projectDialog === id ? null : s.projectDialog, chats: s.chats.map((c) => (c.projectId === id ? { ...c, projectId: undefined } : c)) }))
        },
        moveChat: (chatId, projectId) => patchChat(chatId, (c) => ({ ...c, projectId })),

        newChat: (projectId) => {
          const existing = get().chats.find((c) => c.mode !== 'code' && c.messages.length === 0 && c.projectId === projectId)
          if (existing) { set({ activeId: existing.id, appMode: 'chat', panel: null, coworkOpen: false }); return existing.id }
          const c = { ...blankChat(), ...(projectId ? { projectId } : {}) }
          set((s) => ({ chats: [c, ...s.chats], activeId: c.id, appMode: 'chat', panel: null, coworkOpen: false }))
          return c.id
        },
        openChat: (id) => { emitPluginEvent('chat:opened', { chatId: id }); set((s) => ({ coworkOpen: false, activeId: id, panel: null, quotes: [], appMode: s.chats.find((c) => c.id === id)?.mode === 'code' ? 'code' : 'chat' })) },
        deleteChat: (id) => {
          get().stop(id)
          get().streaming[id]?.abort()
          for (const c of childrenOf(id)) set((s) => ({ chats: s.chats.filter((x) => x.id !== c.id) }))
          void dropKb(get().kbFiles.filter((f) => f.scope.chat === id).map((f) => f.id))
          const sb = get().chats.find((c) => c.id === id)?.sandbox
          if (sb) void import('./lib/sandbox').then((m) => m.deleteSandbox(sb)).catch(() => {})
          set((s) => {
            const chats = s.chats.filter((c) => c.id !== id)
            const gone = s.chats.find((c) => c.id === id)
            const next = chats.find((c) => !c.sub && (c.mode === 'code') === (gone?.mode === 'code'))
            return { chats, activeId: s.activeId === id ? next?.id ?? null : s.activeId, panel: s.activeId === id ? null : s.panel }
          })
        },
        renameChat: (id, title) => patchChat(id, (c) => ({ ...c, title })),
        pinChat: (id) => patchChat(id, (c) => ({ ...c, pinned: !c.pinned })),
        clearChat: (id) => { get().streaming[id]?.abort(); patchChat(id, (c) => ({ ...c, messages: [], title: 'New chat', titled: false })); set({ panel: null }) },

        addProvider: (p) => set((s) => ({ providers: [...s.providers, p], selected: s.selected ?? (p.models[0] ? { providerId: p.id, model: p.models[0].id } : null) })),
        updateProvider: (id, patch) => set((s) => ({ providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
        removeProvider: (id) => set((s) => ({ providers: s.providers.filter((p) => p.id !== id), selected: s.selected?.providerId === id ? null : s.selected })),
        select: (providerId, model) => {
          set({ selected: { providerId, model } })
          const a = get().activeId
          if (a) patchChat(a, (c) => ({ ...c, providerId, model }))
        },
        addMcp: (s) => set((st) => ({ mcpServers: [...st.mcpServers, s] })),
        updateMcp: (id, patch) => set((st) => ({ mcpServers: st.mcpServers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
        removeMcp: (id) => set((st) => ({ mcpServers: st.mcpServers.filter((x) => x.id !== id) })),
        setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
        setPanel: (panel) => set({ panel }),
        openSettings: (tab) => set((s) => ({ settingsOpen: true, settingsTab: tab ?? s.settingsTab })),
        closeSettings: () => set({ settingsOpen: false }),
        setSidebar: (sidebarOpen) => set({ sidebarOpen }),

        send: async (text, attachments, quotes, cmd, chatId, now) => {
          if (hasBeforeSend()) { const t = await runBeforeSend(text); if (t === null) return; text = t }
          let id = chatId ?? get().activeId
          if (!id || !get().chats.find((c) => c.id === id)) id = get().newChat()
          // the AI is still working on this chat: hold the message. It goes in after the next tool call, or when the reply ends.
          if (!now && get().streaming[id]) {
            set((s) => ({ queue: { ...s.queue, [id!]: [...(s.queue[id!] ?? []), { id: uid(), text, attachments, ...(quotes?.length ? { quotes } : {}), ...(cmd ? { cmd } : {}) }] } }))
            return
          }
          const chat = get().chats.find((c) => c.id === id)!
          const user: Message = { id: uid(), role: 'user', createdAt: Date.now(), text, attachments, ...(quotes?.length ? { quotes } : {}), ...(cmd ? { cmd } : {}) }
          const history = [...chat.messages, user]
          emitPluginEvent('message:sent', { chatId: id, text })
          if (chat.title === 'New chat') patchChat(id, (c) => ({ ...c, title: text.slice(0, 40) || 'Image chat' }))
          const sel = get().selected
          if (sel && !chat.providerId) patchChat(id, (c) => ({ ...c, providerId: sel.providerId, model: sel.model }))
          const cmp = get().settings.compare
          const picks = cmp.enabled && chat.mode !== 'code' ? cmp.models.filter((p) => get().providers.some((x) => x.id === p.providerId && x.models.some((m) => m.id === p.model))).slice(0, 4) : []
          if (picks.length >= 2) {
            // compare mode: one reply per selected model, all streaming at once
            patchChat(id, (c) => ({ ...c, messages: history }))
            const ctrl = new AbortController()
            set((st) => ({ streaming: { ...st.streaming, [id!]: ctrl } }))
            const shared = { left: picks.length }
            await Promise.all(picks.map((p, lane) => generate(id!, history, { providerId: p.providerId, model: p.model, lane, cmp: { group: user.id, lane, providerId: p.providerId }, ctrl, shared })))
            return
          }
          await generate(id, history)
        },
        regenerate: async (chatId, messageId, pick) => {
          const chat = get().chats.find((c) => c.id === chatId)
          if (!chat) return
          const i = chat.messages.findIndex((m) => m.id === messageId)
          if (i < 0) return
          if (get().streaming[chatId]) return
          const target = chat.messages[i]
          await generate(chatId, chat.messages.slice(0, i), { versionOf: target, ...(target.cmp ? { lane: target.cmp.lane, cmp: target.cmp } : {}), ...(pick ?? {}) })
        },
        pickLane: (chatId, messageId) =>
          patchChat(chatId, (c) => {
            const m = c.messages.find((x) => x.id === messageId)
            if (!m?.cmp) return c
            const was = !!m.cmp.picked
            return { ...c, messages: c.messages.map((x) => (x.cmp?.group === m.cmp!.group ? { ...x, cmp: { ...x.cmp, picked: x.id === messageId ? !was : false } } : x)) }
          }),
        keepLane: (chatId, messageId) => {
          const m = get().chats.find((c) => c.id === chatId)?.messages.find((x) => x.id === messageId)
          if (!m?.cmp) return
          get().pickLane(chatId, messageId)
          const providerId = m.cmp.providerId ?? get().providers.find((p) => p.models.some((x) => x.id === m.model))?.id
          if (providerId && m.model) get().select(providerId, m.model)
          get().setSettings({ compare: { ...get().settings.compare, enabled: false } })
          toast.info(`Continuing with ${m.model} only`)
        },
        switchVersion: (chatId, messageId, altIndex) =>
          patchChat(chatId, (c) => ({
            ...c,
            messages: c.messages.map((m) => {
              const alt = m.alts?.[altIndex]
              if (m.id !== messageId || !alt) return m
              return { ...m, ...pickVersion(alt), alts: m.alts!.map((a, i) => (i === altIndex ? takeVersion(m) : a)) }
            }),
          })),
        removeVersion: (chatId, messageId) =>
          patchChat(chatId, (c) => ({
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== messageId || !m.alts?.length) return m
              // show the neighbouring version, then drop the one that used to be current
              const all = [...m.alts.map((a, i) => ({ t: a.createdAt, i })), { t: m.createdAt, i: -1 }].sort((a, b) => a.t - b.t)
              const k = all.findIndex((x) => x.i === -1)
              const j = (all[k - 1] ?? all[k + 1]).i
              const swapped = { ...m, ...pickVersion(m.alts[j]) }
              const alts = m.alts.filter((_, i) => i !== j)
              return { ...swapped, alts: alts.length ? alts : undefined }
            }),
          })),
        compactChat: async (chatId, focus, hist) => {
          const s = get()
          const chat = s.chats.find((c) => c.id === chatId)
          if (!chat || s.compacting[chatId]) return false
          const messages = resolveForModel(hist ?? chat.messages).filter((m) => m.status !== 'streaming')
          const provider = s.providers.find((p) => p.id === (chat.providerId ?? s.selected?.providerId))
          const model = chat.model ?? s.selected?.model
          if (!provider || !model) { toast.error('Pick a model first.'); return false }
          if (!canCompact(messages, chat.summary)) { if (!hist) toast.info('Not enough conversation to compact yet.'); return false }
          set((x) => ({ compacting: { ...x.compacting, [chatId]: true } }))
          try {
            const summary = await runCompaction(provider, model, messages, chat.summary, focus)
            if (!summary) return false
            patchChat(chatId, (c) => ({ ...c, summary }))
            if (!hist) toast.success(`Compacted: ~${Math.round(summary.tokensBefore / 1000)}k → ~${Math.max(1, Math.round(summary.tokensAfter / 1000))}k tokens`)
            return true
          } catch (e: any) {
            toast.error(`Could not compact: ${e.message}`)
            return false
          } finally {
            set((x) => { const n = { ...x.compacting }; delete n[chatId]; return { compacting: n } })
          }
        },
        addShare: (chatId, sh) => patchChat(chatId, (c) => ({ ...c, shares: [sh, ...(c.shares ?? [])] })),
        removeShare: (chatId, id) => patchChat(chatId, (c) => ({ ...c, shares: (c.shares ?? []).filter((x) => x.id !== id) })),
        setSandbox: (chatId, sb) => patchChat(chatId, (c) => ({ ...c, sandbox: sb })),
        removeSandbox: async (chatId) => {
          const sb = get().chats.find((c) => c.id === chatId)?.sandbox
          if (!sb) return
          try { await (await import('./lib/sandbox')).deleteSandbox(sb); toast.success('Sandbox deleted') }
          catch (e: any) { toast.error(`Could not delete the sandbox: ${e.message}`); return }
          patchChat(chatId, (c) => ({ ...c, sandbox: undefined }))
        },
        clearSummary: (chatId) => patchChat(chatId, (c) => ({ ...c, summary: undefined })),
        editResend: async (chatId, messageId, text) => {
          const chat = get().chats.find((c) => c.id === chatId)
          if (!chat) return
          const i = chat.messages.findIndex((m) => m.id === messageId)
          if (i < 0) return
          get().streaming[chatId]?.abort()
          const edited = { ...chat.messages[i], text }
          await generate(chatId, [...chat.messages.slice(0, i), edited])
        },
        editMessage: (chatId, messageId, text) =>
          patchChat(chatId, (c) => ({
            ...c,
            summary: inSummarized(c, messageId) ? undefined : c.summary,
            updatedAt: Date.now(),
            messages: c.messages.map((m) => {
              if (m.id !== messageId) return m
              if (m.role === 'user') return { ...m, text, edited: true }
              const blocks = m.blocks ?? []
              const textIdx = blocks.map((b, i) => (b.type === 'text' ? i : -1)).filter((i) => i >= 0)
              let next = blocks.filter((_, i) => !textIdx.slice(1).includes(i))
              if (!text.trim()) next = next.filter((b) => b.type !== 'text')
              else if (textIdx.length) next = next.map((b) => (b.type === 'text' ? { ...b, text } : b))
              else next = [...next, { type: 'text' as const, id: uid(), text }]
              return { ...m, blocks: next, edited: true }
            }),
          })),
        forkChat: (chatId, messageId) => {
          const src = get().chats.find((c) => c.id === chatId)
          if (!src) return null
          const i = src.messages.findIndex((m) => m.id === messageId)
          if (i < 0) return null
          const upto = src.messages.slice(0, i + 1)
          // fresh message ids so panels/lookups never confuse the copy with the original
          const messages = structuredClone(upto).map((m) => ({ ...m, id: uid(), status: m.status === 'streaming' ? ('stopped' as const) : m.status }))
          const fork: Chat = {
            ...blankChat(),
            title: src.title.replace(/ \(fork\)$/, '') + ' (fork)',
            titled: true,
            messages,
            providerId: src.providerId,
            model: src.model,
            system: src.system,
            forkedFrom: { chatId: src.id, title: src.title },
          }
          set((s) => ({ chats: [fork, ...s.chats], activeId: fork.id, panel: null }))
          // forking from a user message: answer it right away in the new chat
          if (messages[messages.length - 1].role === 'user') void generate(fork.id, messages)
          return fork.id
        },
        deleteMessage: (chatId, messageId) => {
          const chat = get().chats.find((c) => c.id === chatId)
          const m = chat?.messages.find((x) => x.id === messageId)
          if (!chat || !m) return
          if (m.status === 'streaming') get().streaming[chatId]?.abort()
          const p = get().panel
          if (p && p.messageId === messageId) set({ panel: null })
          patchChat(chatId, (c) => ({ ...c, summary: inSummarized(c, messageId) ? undefined : c.summary, updatedAt: Date.now(), messages: c.messages.filter((x) => x.id !== messageId) }))
        },
        restoreMessage: (chatId, index, message) =>
          patchChat(chatId, (c) => {
            const msgs = [...c.messages]
            msgs.splice(Math.min(index, msgs.length), 0, message)
            return { ...c, messages: msgs }
          }),
        setChatSystem: (chatId, system) => patchChat(chatId, (c) => ({ ...c, system })),
        importChats: (list) => set((s) => ({ chats: [...list.filter((c) => !s.chats.some((x) => x.id === c.id)), ...s.chats] })),
        stop: (chatId) => {
          get().streaming[chatId]?.abort()
          // stopping a session also stops the sub-agents it started, and no report is sent back
          for (const c of childrenOf(chatId)) { get().streaming[c.id]?.abort(); patchChat(c.id, (x) => (x.sub ? { ...x, sub: { ...x.sub, delivered: true } } : x)) }
        },
        startSubAgent: (parentId, name, task) => {
          const s0 = get()
          const parent = s0.chats.find((c) => c.id === parentId)!
          const id = uid()
          const user: Message = { id: uid(), role: 'user', createdAt: Date.now(), text: task }
          const chat: Chat = { ...blankChat(), id, title: name || 'Sub-agent', titled: true, mode: 'code', cwd: parent.cwd, providerId: parent.providerId ?? s0.selected?.providerId, model: parent.model ?? s0.selected?.model, sub: { parentId, name: name || 'Sub-agent', task, delivered: false }, messages: [user] }
          set((st) => ({ chats: [chat, ...st.chats] }))
          trackRun(id, generate(id, [user]))
          return id
        },
        reportToParent: (parentId, agentIds) => {
          const { text, names } = reportsText(agentIds)
          set((st) => ({ chats: st.chats.map((c) => (c.sub && agentIds.includes(c.id) ? { ...c, sub: { ...c.sub, delivered: true } } : c)) }))
          const p = get().chats.find((c) => c.id === parentId)
          if (!p) return
          const user: Message = { id: uid(), role: 'user', createdAt: Date.now(), reports: names, text: `Your sub-agents have finished. Their reports:\n\n${text}\n\nReview what they did, verify anything important, then tell me the outcome.` }
          void generate(parentId, [...p.messages, user])
        },
      }
    },
    {
      name: 'kokochat-v1',
      version: 5,
      migrate: (state: any, v: number) => {
        let st = state
        if (v < 2 && st?.settings) st = { ...st, settings: { ...st.settings, searchMode: 'first' } }
        // built-in prompts that were never edited move to the new {field} spelling
        if (v < 4 && Array.isArray(st?.settings?.prompts)) st = { ...st, settings: { ...st.settings, prompts: st.settings.prompts.map((p: any) => { const d = DEFAULT_PROMPTS.find((x) => x.id === p.id); if (!d) return p; const olds = [...(OLD_DEFAULTS[p.id] ?? []), d.text.replace(/\{text\}/g, '{{input}}')]; return olds.includes(p.text) ? { ...p, name: d.name, text: d.text } : p }) } }
        if (v < 5 && Array.isArray(st?.settings?.prompts)) st = { ...st, settings: { ...st.settings, prompts: st.settings.prompts.map((p: any) => { const d = DEFAULT_PROMPTS.find((x) => x.id === p.id); const old = d && [...(OLD_DEFAULTS[p.id] ?? []), d.text.replace(/\{text\}/g, '{{input}}')]; const legacy = d && ['{language: English}', '{tone: polite}', '{count: 10}'].some((t) => p.text.includes(t)) && p.text === d.text.replace('{language}', '{language: English}').replace('{tone}', '{tone: polite}').replace('{count}', '{count: 10}'); return d && !p.fields && (p.text === d.text || legacy || old?.includes(p.text)) ? { ...p, name: d.name, text: d.text, fields: d.fields } : p }) } }
        return st
      },
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({ actions: s.actions, memories: s.memories, plugins: s.plugins, coworkers: s.coworkers, appMode: s.appMode, recentFolders: s.recentFolders, codeRules: s.codeRules, projects: s.projects, kbFiles: s.kbFiles, usage: s.usage, priceOverrides: s.priceOverrides, chats: s.chats, activeId: s.activeId, providers: s.providers, selected: s.selected, settings: s.settings, mcpServers: s.mcpServers, sync: s.sync, sidebarOpen: s.sidebarOpen }),
      merge: (p: any, cur) => {
        const ps = p?.settings ?? {}
        const m = { ...cur, ...p, sync: { ...DEFAULT_SYNC, ...(p?.sync ?? {}) }, settings: { ...DEFAULT_SETTINGS, ...ps, memory: { ...DEFAULT_SETTINGS.memory, ...ps.memory }, notifications: { ...DEFAULT_SETTINGS.notifications, ...ps.notifications }, appearance: { ...DEFAULT_SETTINGS.appearance, ...ps.appearance }, rag: { ...DEFAULT_SETTINGS.rag, ...ps.rag }, prompts: Array.isArray(ps.prompts) ? ps.prompts : DEFAULT_PROMPTS, integrations: mergeIntegrations(ps.integrations), compare: { ...DEFAULT_SETTINGS.compare, ...ps.compare }, sandbox: { ...DEFAULT_SETTINGS.sandbox, ...ps.sandbox }, image: { ...DEFAULT_SETTINGS.image, ...ps.image }, video: { ...DEFAULT_SETTINGS.video, ...ps.video }, stt: { ...DEFAULT_SETTINGS.stt, ...ps.stt }, tts: { ...DEFAULT_SETTINGS.tts, ...ps.tts } } }
        // any message left "streaming" from a previous session is dead
        m.chats = (m.chats ?? []).map((c: Chat) => ({ ...c, messages: c.messages.map((x) => (x.status === 'streaming' ? { ...x, status: 'stopped' as const, blocks: x.blocks?.map((b) => (b.type === 'tool' && b.status === 'running' ? { ...b, status: 'error' as const, result: 'Interrupted' } : b)) } : x)) }))
        return m
      },
    },
  ),
)

setMcpPersist((id, patch) => useStore.getState().updateMcp(id, patch))

export const useHydrated = () => {
  const [h, setH] = useState(useStore.persist.hasHydrated())
  useEffect(() => useStore.persist.onFinishHydration(() => setH(true)), [])
  return h
}
export type { Effort }
