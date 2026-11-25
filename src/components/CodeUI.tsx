import { useState } from 'react'
import { Code2, Folder, FolderOpen, MessageSquare, ShieldAlert, ShieldCheck, ShieldOff, PencilLine, Check, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { baseName, isDesktop, koko } from '../lib/desktop'
import type { PermissionMode } from '../lib/permissions'
import { Popover } from './ui'
import { cn } from '../lib/utils'
import { toast } from '../lib/toast'

/** Chat | Code switch (desktop app only). */
export function ModeSwitch({ compact }: { compact?: boolean }) {
  const { appMode, setAppMode } = useStore()
  if (!isDesktop()) return null
  const item = (m: 'chat' | 'code', label: string, icon: React.ReactNode) => (
    <button key={m} onClick={() => setAppMode(m)} title={label} className={cn('flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition', compact ? 'w-8 flex-none' : 'px-3', appMode === m ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg')}>
      {icon}{!compact && label}
    </button>
  )
  return <div className={cn('flex rounded-full bg-fg/6 p-0.5', !compact && 'mb-2')}>{item('chat', 'Chat', <MessageSquare size={14} />)}{item('code', 'Code', <Code2 size={14} />)}</div>
}

/** The title bar's Chat / Code switch: one pill that slides to the chosen side. */
export function ModeSlider() {
  const { appMode, setAppMode } = useStore()
  if (!isDesktop()) return null
  const code = appMode === 'code'
  return (
    <div role="tablist" aria-label="Mode" className="app-nodrag relative grid h-8 w-[172px] grid-cols-2 rounded-full bg-fg/6 p-0.5">
      <span aria-hidden className="absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-full bg-surface shadow-sm ring-1 ring-line transition-transform duration-300 ease-[cubic-bezier(.3,1.3,.5,1)] motion-reduce:transition-none" style={{ transform: code ? 'translateX(100%)' : 'translateX(0)' }} />
      {([['chat', 'Chat', <MessageSquare key="i" size={13} />], ['code', 'Code', <Code2 key="i" size={13} />]] as const).map(([m, label, icon]) => (
        <button key={m} role="tab" aria-selected={appMode === m} onClick={() => setAppMode(m)} className={cn('relative z-10 flex items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors', appMode === m ? 'text-fg' : 'text-muted hover:text-fg')}>{icon}{label}</button>
      ))}
    </div>
  )
}

/** Where the window has our own title bar, the switch lives there; elsewhere it stays in the sidebar. */
export const hasTitleBar = () => isDesktop() && koko()?.platform === 'darwin'

/** Pick a folder and start a Code session in it. */
export async function startSession(cwd?: string) {
  const k = koko()
  if (!k) return
  const dir = cwd ?? (await k.pickFolder())
  if (!dir) return
  useStore.getState().newCodeChat(dir)
  window.dispatchEvent(new Event('koko:focus-composer'))
}

/** Shown in Code mode when there is no session yet. */
export function CodeWelcome() {
  const recents = useStore((s) => s.recentFolders)
  return (
    <div className="mx-auto flex h-full w-full max-w-xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="anim-fade-up grid h-16 w-16 place-items-center rounded-3xl bg-accent text-accent-fg"><Code2 size={28} /></div>
      <div className="anim-fade-up" style={{ animationDelay: '60ms' }}>
        <h1 className="text-3xl font-semibold tracking-tight">Code with any model</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">Pick a project folder. The AI can read and edit your files, run commands, search the web and generate images into your project, and asks before it changes anything.</p>
      </div>
      <button onClick={() => void startSession()} style={{ animationDelay: '120ms' }} className="anim-fade-up flex h-12 items-center gap-2.5 rounded-full bg-fg px-6 text-sm font-medium text-bg transition hover:scale-[1.03] active:scale-95"><FolderOpen size={17} />Open a project folder</button>
      {recents.length > 0 && (
        <div className="anim-fade-up w-full" style={{ animationDelay: '180ms' }}>
          <div className="mb-2 text-xs font-medium text-faint">Recent</div>
          <div className="flex flex-col gap-1">
            {recents.slice(0, 5).map((f) => (
              <button key={f} onClick={() => void startSession(f)} className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition hover:-translate-y-0.5 active:scale-[0.99]">
                <Folder size={16} className="shrink-0 text-accent" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{baseName(f)}</span><span className="block truncate text-xs text-muted">{f}</span></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const MODES: { v: PermissionMode; label: string; d: string; icon: React.ReactNode }[] = [
  { v: 'ask', label: 'Ask first', d: 'Approve every edit and command', icon: <ShieldCheck size={16} /> },
  { v: 'acceptEdits', label: 'Auto-approve edits', d: 'Edits go through, commands still ask', icon: <PencilLine size={16} /> },
  { v: 'auto', label: 'Auto', d: 'A small AI reviews each command. Deploys, pushes and deletes only run if you asked for them', icon: <Sparkles size={16} /> },
  { v: 'bypass', label: 'Bypass permissions', d: 'Run anything without asking', icon: <ShieldOff size={16} /> },
]

/** Permission mode of the current Code session. */
export function PermissionPill({ chatId }: { chatId: string }) {
  const perm = useStore((s) => s.codePerm[chatId] ?? s.settings.codeDefaultPermission ?? 'auto')
  const { setCodePerm, setBypassPrompt } = useStore()
  const cur = MODES.find((m) => m.v === perm)!
  return (
    <Popover button={(open, toggle) => (
      <button onClick={toggle} title={`Permissions: ${cur.label}`} className={cn('flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition active:scale-95', perm === 'bypass' ? 'bg-danger/12 text-danger' : perm === 'acceptEdits' || perm === 'auto' ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg', open && 'bg-fg/5')}>
        {perm === 'bypass' ? <ShieldAlert size={17} /> : cur.icon}<span className="hidden sm:inline">{cur.label}</span>
      </button>
    )}>
      {(close) => (
        <div className="w-72 max-w-full">
          <div className="px-2.5 pb-1.5 pt-1.5 text-xs font-medium text-muted">What can the AI do without asking?</div>
          {MODES.map((m) => (
            <button key={m.v} onClick={() => { close(); if (m.v === 'bypass') setBypassPrompt(chatId); else setCodePerm(chatId, m.v) }} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-fg/5">
              <span className={m.v === 'bypass' ? 'text-danger' : 'text-accent'}>{m.icon}</span>
              <span className="flex-1"><span className={cn('block text-sm font-medium', m.v === 'bypass' && 'text-danger')}>{m.label}</span><span className="block text-xs text-muted">{m.d}</span></span>
              {perm === m.v && <Check size={15} className="text-accent" />}
            </button>
          ))}
          <div className="mt-1 border-t border-line px-2.5 py-2 text-xs text-faint">Reading and searching files is always allowed inside the project folder. Only this session is affected.</div>
        </div>
      )}
    </Popover>
  )
}

/** The warning shown before permissions are bypassed. */
export function BypassWarning() {
  const chatId = useStore((s) => s.bypassPrompt)
  const chat = useStore((s) => s.chats.find((c) => c.id === s.bypassPrompt))
  const { setBypassPrompt, setCodePerm } = useStore()
  const [sure, setSure] = useState(false)
  if (!chatId) return null
  const close = () => { setBypassPrompt(null); setSure(false) }
  return (
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/45 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass-strong anim-pop w-full max-w-md rounded-[28px] p-6">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-danger/12 text-danger"><ShieldAlert size={24} /></div>
        <h2 className="text-lg font-semibold tracking-tight">Bypass all permissions?</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          The AI will be able to <span className="font-medium text-fg">run any command and change or delete any file</span>{chat?.cwd ? <> in <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{chat.cwd}</code></> : null} without asking you first.
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>Commands run with your user account's full access, not just this folder.</li>
          <li>A mistake, or instructions hidden in a file or web page it reads, could delete work or leak secrets.</li>
          <li>Use it only on projects you trust, with your work saved in git or backed up.</li>
          <li>It applies to this session only and resets when you quit the app.</li>
        </ul>
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--danger)]" />I understand the risks</label>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={close} className="h-10 rounded-full bg-fg/8 px-5 text-sm font-medium transition hover:bg-fg/12 active:scale-95">Cancel</button>
          <button disabled={!sure} onClick={() => { setCodePerm(chatId, 'bypass'); close(); toast.info('Permissions bypassed for this session') }} className="h-10 rounded-full bg-danger px-5 text-sm font-medium text-white transition active:scale-95 disabled:opacity-40">Bypass permissions</button>
        </div>
      </div>
    </div>
  )
}

