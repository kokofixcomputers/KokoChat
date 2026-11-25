import { useEffect, useRef, useState } from 'react'
import { ConfirmHost } from './components/ConfirmHost'
import { useHydrated, useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { ChatView } from './components/ChatView'
import { SettingsModal } from './components/Settings'
import { ArtifactPanel, SourcesPanel } from './components/ArtifactPanel'
import { CommandPalette } from './components/CommandPalette'
import { Toasts } from './components/Toasts'
import { readChatsJson } from './lib/exporter'
import { toast } from './lib/toast'
import { startAutoSync } from './lib/sync'
import { Onboarding } from './components/Onboarding'
import { SelectionQuote } from './components/SelectionQuote'
import { ShareDialog } from './components/ShareDialog'
import { ProjectDialog } from './components/ProjectDialog'
import { BypassWarning } from './components/CodeUI'
import { isDesktop } from './lib/desktop'
import { TitleBar } from './components/TitleBar'
import { Dock } from './components/Dock'
import { useDock } from './lib/dock'
import { koko } from './lib/desktop'
import { Coworker } from './components/Coworker'
import { PluginModalHost } from './components/PluginSlot'
import { startPlugins } from './lib/plugins'
import { resumeOneMinSignIn } from './lib/oneminAuth'
import { startScheduler } from './lib/coworker'

function useTheme() {
  const theme = useStore((s) => s.settings.theme)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

const FONTS = {
  inter: '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

function useAppearance() {
  const a = useStore((s) => s.settings.appearance)
  useEffect(() => {
    const el = document.documentElement
    el.dataset.accent = a.accent
    el.dataset.palette = a.palette
    el.style.setProperty('--tx', String(a.fontScale / 100))
    el.style.setProperty('--app-font', FONTS[a.font] ?? FONTS.inter)
  }, [a])
}

export default function App() {
  const hydrated = useHydrated()
  useTheme()
  useAppearance()
  const coworkOpen = useStore((s) => s.coworkOpen)
  const { sidebarOpen, setSidebar, panel, chats, activeId, newChat, setPanel, importChats } = useStore()
  const [palette, setPalette] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const dockOpen = useDock((s) => s.open)
  const appMode = useStore((s) => s.appMode)
  const activeCwd = useStore((s) => s.chats.find((c) => c.id === s.activeId)?.cwd)
  const [dw, setDw] = useState(() => Number(localStorage.getItem('koko:dockw')) || 520)
  const desktop = isDesktop()
  const mac = desktop && koko()?.platform === 'darwin'
  const activePluginTab = useDock((s) => s.tabs.find((t) => t.id === s.active)?.kind === 'plugin')
  const showDock = desktop && dockOpen && (appMode === 'code' || activePluginTab)
  const [pw, setPw] = useState(() => Number(localStorage.getItem('koko:panelw')) || 640)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'j' && isDesktop() && useStore.getState().appMode === 'code') { e.preventDefault(); void import('./components/Dock').then((m) => m.toggleDock(useStore.getState().chats.find((c) => c.id === useStore.getState().activeId)?.cwd)) }
      else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); newChat() }
      else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); useStore.getState().setSidebar(!useStore.getState().sidebarOpen) }
      else if (mod && e.key === ',') { e.preventDefault(); useStore.getState().openSettings() }
      else if (e.key === 'Escape') {
        const s = useStore.getState()
        if (s.settingsOpen) s.closeSettings()
        else if (s.panel && !(e.target as HTMLElement)?.closest?.('textarea,input')) s.setPanel(null)
      }
    }
    const imp = () => importRef.current?.click()
    const openSearch = () => setPalette(true)
    window.addEventListener('keydown', key)
    window.addEventListener('koko:import', imp)
    window.addEventListener('koko:search', openSearch)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('koko:import', imp); window.removeEventListener('koko:search', openSearch) }
  }, [newChat])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => { const w = Math.min(Math.max(innerWidth - ev.clientX - 12, 360), Math.min(1100, innerWidth - 420)); setPw(w); localStorage.setItem('koko:panelw', String(Math.round(w))) }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect = '' }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }
  useEffect(() => { if (hydrated && !chats.find((c) => c.id === activeId)) newChat() }, [hydrated]) // eslint-disable-line
  // the model menu shows the model of the chat you are looking at, and follow-ups use it (a chat started from quick ask keeps the model you picked there)
  const chatModel = useStore((s) => { const c = s.chats.find((x) => x.id === s.activeId); return c?.providerId && c?.model ? `${c.providerId}\n${c.model}` : '' })
  useEffect(() => {
    if (!hydrated || !chatModel) return
    const [providerId, model] = chatModel.split('\n')
    const s = useStore.getState()
    if (s.selected?.providerId === providerId && s.selected.model === model) return
    if (s.providers.some((p) => p.id === providerId && p.models.some((m) => m.id === model))) useStore.setState({ selected: { providerId, model } })
  }, [hydrated, chatModel])
  // ⌘, from the Mac app menu
  useEffect(() => koko()?.onOpenSettings?.(() => useStore.getState().openSettings()), [])
  // a question typed into the floating quick-ask window: start a new chat with it
  useEffect(() => {
    if (!hydrated) return
    return koko()?.quick.onSubmit(async (p) => {
      const st = useStore.getState()
      const id = st.newChat()
      if (p.providerId && p.model) useStore.setState((s) => ({ chats: s.chats.map((c) => (c.id === id ? { ...c, providerId: p.providerId, model: p.model } : c)) }))
      const att = p.image ? [{ id: Math.random().toString(36).slice(2), name: 'screenshot.png', mime: 'image/png', dataUrl: p.image, kind: 'image' as const }] : []
      await useStore.getState().send(p.text || 'What is on this screenshot? Describe it and point out anything notable.', att)
    })
  }, [hydrated])
  useEffect(() => { if (hydrated) { startAutoSync(); startPlugins(); void resumeOneMinSignIn(); if (isDesktop()) startScheduler() } }, [hydrated])
  useEffect(() => { if (innerWidth < 900) setSidebar(false) }, []) // eslint-disable-line

  const artifact = panel?.kind === 'artifact'
    ? chats.flatMap((c) => c.messages).find((m) => m.id === panel.messageId)?.artifacts?.find((a) => a.id === panel.artifactId)
    : undefined

  const startDockResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const move = (ev: MouseEvent) => { const w = Math.min(Math.max(innerWidth - ev.clientX - 12, 320), Math.min(1000, innerWidth - 480)); setDw(w); localStorage.setItem('koko:dockw', String(Math.round(w))) }
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.userSelect = '' }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  if (!hydrated) return null
  return (
    <>
      <div className="relative z-10 flex h-full flex-col">
      {mac && <TitleBar />}
      <div className={'flex min-h-0 flex-1 gap-3 p-3' + (mac ? ' pt-0' : '')}>
        {sidebarOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] lg:hidden" onClick={() => setSidebar(false)} />
            <div className="fixed inset-y-3 left-3 z-50 lg:static lg:z-auto"><Sidebar /></div>
          </>
        )}
        <main className="relative min-w-0 flex-1">{coworkOpen && isDesktop() ? <Coworker /> : <><TopBar /><ChatView /></>}</main>
        {panel && (artifact || panel.kind === 'sources') && (
          <div style={{ ['--pw' as any]: pw + 'px' }} className="group/rs fixed inset-3 z-40 lg:static lg:inset-auto lg:z-auto lg:w-[var(--pw)] lg:shrink-0">
            <div onMouseDown={startResize} onDoubleClick={() => { setPw(640); localStorage.removeItem('koko:panelw') }} className="absolute -left-2.5 inset-y-6 z-10 hidden w-2 cursor-col-resize rounded-full transition hover:bg-accent/40 lg:block" />
            {artifact ? <ArtifactPanel artifact={artifact} /> : panel.kind === 'sources' ? <SourcesPanel messageId={panel.messageId} /> : null}
          </div>
        )}
        {desktop && (
          <div style={{ ['--dw' as any]: dw + 'px' }} className={showDock ? 'group/dk fixed inset-3 z-40 lg:static lg:inset-auto lg:z-auto lg:w-[var(--dw)] lg:shrink-0' : 'hidden'}>
            {showDock && <div onMouseDown={startDockResize} onDoubleClick={() => { setDw(520); localStorage.removeItem('koko:dockw') }} className="absolute -left-2.5 inset-y-6 z-10 hidden w-2 cursor-col-resize rounded-full transition hover:bg-accent/40 lg:block" />}
            <Dock cwd={activeCwd} />
          </div>
        )}
      </div>
      </div>
      <SettingsModal />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Toasts />
      <ConfirmHost />
      <Onboarding />
      <SelectionQuote />
      <ShareDialog />
      <ProjectDialog />
      <BypassWarning />
      <PluginModalHost />
      <input ref={importRef} type="file" accept="application/json" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f) return
        try { const c = await readChatsJson(f); importChats(c); toast.success(`Imported ${c.length} chat${c.length === 1 ? '' : 's'}`) } catch (err: any) { toast.error(err.message) }
      }} />
    </>
  )
}
