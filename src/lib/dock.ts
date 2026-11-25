import { create } from 'zustand'
import { uid } from './utils'

export interface DockTab { id: string; kind: 'terminal' | 'browser' | 'agent' | 'files' | 'plugin'; title: string; cwd?: string; startUrl?: string; chatId?: string; /** typed into a new terminal as soon as it starts */ input?: string; pluginId?: string; panelId?: string }

interface Dock {
  open: boolean
  tabs: DockTab[]
  active: string | null
  setOpen: (b: boolean) => void
  add: (kind: DockTab['kind'], o?: { cwd?: string; url?: string; chatId?: string; title?: string; input?: string; pluginId?: string; panelId?: string }) => string
  close: (id: string) => void
  focus: (id: string) => void
  rename: (id: string, title: string) => void
}

/** The side panel's tabs (terminals and browsers). Lives in memory: terminals end when the app quits. */
export const useDock = create<Dock>((set, get) => ({
  open: false,
  tabs: [],
  active: null,
  setOpen: (open) => set({ open }),
  add: (kind, o) => {
    const same = kind === 'agent' ? get().tabs.find((t) => t.chatId === o?.chatId) : kind === 'files' ? get().tabs.find((t) => t.kind === 'files' && t.cwd === o?.cwd) : kind === 'plugin' ? get().tabs.find((t) => t.kind === 'plugin' && t.pluginId === o?.pluginId && t.panelId === o?.panelId) : undefined
    if (same) { set({ active: same.id, open: true }); return same.id }
    const n = get().tabs.filter((t) => t.kind === kind).length + 1
    const t: DockTab = { id: uid(), kind, title: o?.title ?? (kind === 'files' ? 'Files' : kind === 'terminal' ? (n > 1 ? `Terminal ${n}` : 'Terminal') : 'New tab'), cwd: o?.cwd, startUrl: o?.url, chatId: o?.chatId, input: o?.input, pluginId: o?.pluginId, panelId: o?.panelId }
    set((s) => ({ tabs: [...s.tabs, t], active: t.id, open: true }))
    return t.id
  },
  close: (id) => set((s) => {
    const i = s.tabs.findIndex((t) => t.id === id)
    const tabs = s.tabs.filter((t) => t.id !== id)
    return { tabs, active: s.active === id ? tabs[Math.max(0, i - 1)]?.id ?? null : s.active }
  }),
  focus: (active) => set({ active }),
  rename: (id, title) => set((s) => (s.tabs.find((t) => t.id === id)?.title === title ? s : { tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })),
}))

export const openAgentTab = (chatId: string, title: string) => useDock.getState().add('agent', { chatId, title })
