import { Columns2, Trash2, Share2, Minimize2, Cloud, Copy, Download, Sparkles, Eraser, FileJson, Globe, MessageSquarePlus, Moon, PanelLeft, Settings as Cog, Shapes, Square, FileText, NotebookPen, BarChart3, BookText, FolderPlus, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useStore } from '../store'
import { exportChatMd, exportChatsJson } from '../lib/exporter'
import { toast } from '../lib/toast'
import { setCompare } from '../lib/compare'
import { syncNow } from '../lib/sync'

export interface Action { id: string; slash?: string; label: string; hint?: string; icon: ReactNode; run: () => void }

export function getActions(): Action[] {
  const s = useStore.getState()
  const chat = s.chats.find((c) => c.id === s.activeId)
  const next = { light: 'dark', dark: 'system', system: 'light' } as const
  return [
    { id: 'new', slash: 'new', label: 'New chat', hint: '⇧⌘O', icon: <MessageSquarePlus size={16} />, run: () => s.newChat() },
    { id: 'clear', slash: 'clear', label: 'Clear this chat', icon: <Eraser size={16} />, run: () => chat && s.clearChat(chat.id) },
    { id: 'duplicate', slash: 'fork', label: 'Duplicate this chat (fork)', icon: <Copy size={16} />, run: () => { const last = chat?.messages[chat.messages.length - 1]; if (chat && last && s.forkChat(chat.id, last.id)) toast.success('Chat duplicated'); else toast.info('Nothing to fork yet') } },
    { id: 'compare', slash: 'compare', label: `Compare mode: ${s.settings.compare.enabled ? 'turn off' : 'turn on'}`, icon: <Columns2 size={16} />, run: () => setCompare() },
    { id: 'share', slash: 'share', label: 'Share chat…', icon: <Share2 size={16} />, run: () => window.dispatchEvent(new Event('koko:share')) },
    ...(chat?.sandbox ? [{ id: 'sandbox-del', label: 'Delete this chat\'s sandbox VM', icon: <Trash2 size={16} />, run: () => void s.removeSandbox(chat.id) }] : []),
    { id: 'compact', slash: 'compact', label: 'Compact conversation', icon: <Minimize2 size={16} />, run: () => { if (chat) void s.compactChat(chat.id) } },
    { id: 'stop', label: 'Stop generating', icon: <Square size={15} />, run: () => chat && s.stop(chat.id) },
    { id: 'websearch', slash: 'search', label: `Web search: ${s.settings.searchEnabled ? 'turn off' : 'turn on'}`, icon: <Globe size={16} />, run: () => (s.settings.tavilyKey ? s.setSettings({ searchEnabled: !s.settings.searchEnabled }) : s.openSettings('tools')) },
    { id: 'artifacts', slash: 'artifacts', label: `Artifacts: ${s.settings.artifactsEnabled ? 'turn off' : 'turn on'}`, icon: <Shapes size={16} />, run: () => s.setSettings({ artifactsEnabled: !s.settings.artifactsEnabled }) },
    { id: 'export-md', slash: 'export', label: 'Export chat as Markdown', icon: <FileText size={16} />, run: () => chat && chat.messages.length ? exportChatMd(chat) : toast.info('Nothing to export yet') },
    { id: 'export-json', label: 'Export all chats as JSON', icon: <FileJson size={16} />, run: () => exportChatsJson(s.chats.filter((c) => c.messages.length)) },
    { id: 'instructions', slash: 'instructions', label: 'Edit chat instructions', icon: <NotebookPen size={16} />, run: () => window.dispatchEvent(new Event('koko:instructions')) },
    { id: 'theme', label: `Theme: switch to ${next[s.settings.theme]}`, icon: <Moon size={16} />, run: () => s.setSettings({ theme: next[s.settings.theme] }) },
    { id: 'sidebar', label: 'Toggle sidebar', hint: '⌘B', icon: <PanelLeft size={16} />, run: () => s.setSidebar(!s.sidebarOpen) },
    { id: 'sync', slash: 'sync', label: s.sync.token ? 'Sync now' : 'Set up sync…', icon: <Cloud size={16} />, run: () => (s.sync.token ? void syncNow() : s.openSettings('sync')) },
    { id: 'onboarding', label: 'Replay welcome tour', icon: <Sparkles size={16} />, run: () => window.dispatchEvent(new Event('koko:onboarding')) },
    { id: 'search', slash: 'find', label: 'Search all messages', hint: '⌘K', icon: <Search size={16} />, run: () => window.dispatchEvent(new Event('koko:search')) },
    { id: 'usage', slash: 'usage', label: 'Usage and cost dashboard', icon: <BarChart3 size={16} />, run: () => s.openSettings('usage') },
    { id: 'prompts', label: 'Prompt library', icon: <BookText size={16} />, run: () => s.openSettings('prompts') },
    { id: 'newproject', slash: 'project', label: 'New project…', icon: <FolderPlus size={16} />, run: () => s.openProject(s.addProject()) },
    { id: 'settings', slash: 'settings', label: 'Open settings', hint: '⌘,', icon: <Cog size={16} />, run: () => s.openSettings() },
    { id: 'import', label: 'Import chats from JSON', icon: <Download size={16} />, run: () => window.dispatchEvent(new Event('koko:import')) },
  ]
}
