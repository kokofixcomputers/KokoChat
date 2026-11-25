import { PanelLeft } from 'lucide-react'
import { useStore } from '../store'
import { DockToggle } from './Dock'
import { ModeSlider } from './CodeUI'
import { cn } from '../lib/utils'

/** macOS: the window's title bar is ours, so it can hold buttons and the session name next to the traffic lights. */
export function TitleBar() {
  const { sidebarOpen, setSidebar, appMode, coworkOpen } = useStore()
  const chat = useStore((s) => s.chats.find((c) => c.id === s.activeId))
  const code = appMode === 'code'
  const title = coworkOpen ? 'Co-worker' : chat?.messages.length ? chat.title : code ? 'New session' : 'New chat'
  return (
    <div data-tauri-drag-region className="app-drag relative z-20 flex h-11 shrink-0 items-center gap-1 pl-[84px] pr-3">
      <button title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'} onClick={() => setSidebar(!sidebarOpen)} className={cn('app-nodrag grid h-8 w-8 place-items-center rounded-full transition hover:bg-fg/8 hover:text-fg', sidebarOpen ? 'bg-fg/8 text-fg' : 'text-muted')}><PanelLeft size={17} /></button>
      <span className="pointer-events-none min-w-0 max-w-[calc(50%-190px)] truncate px-2 text-[13px] font-medium text-muted">{title}{code && chat?.cwd ? <span className="ml-2 font-normal text-faint">{chat.cwd.split(/[\\/]/).pop()}</span> : null}</span>
      <span data-tauri-drag-region className="h-full flex-1" />
      {code && <DockToggle cwd={chat?.cwd} />}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><ModeSlider /></div>
    </div>
  )
}
