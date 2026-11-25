import { useEffect, useMemo, useState } from 'react'
import { SlideThumb } from './SlidesViewer'
import { deckOf, layoutDeck } from '../lib/slides'
import { Brain, ChevronRight, Globe, Loader2, CircleAlert, Check, Layers, FileCode2, BarChart3, FileText, Code2, Shapes, Wrench, ImageIcon, Sparkles, Download, Maximize2, Workflow, Terminal, FilePen, Rocket, ExternalLink, Copy, Package, Telescope, Search, Link2, Video, Presentation } from 'lucide-react'
import type { Artifact, Block, Source } from '../types'
import { Markdown } from './Markdown'
import { Favicon } from './ui'
import { cn, fmtDuration } from '../lib/utils'
import { useStore } from '../store'
import { parseMcpName } from '../lib/mcp'
import { downloadDataUrl, dataUrlExt } from '../lib/utils'
import { DiagramSvg, tryLayout, useIsDark } from './Diagram'
import { VideoPlayer } from './VideoPlayer'
import { loadVideo } from '../lib/videogen'

function useNow(active: boolean) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => tick((x) => x + 1), 500)
    return () => clearInterval(t)
  }, [active])
  return Date.now()
}

export function ReasoningBlock({ block, streaming }: { block: Extract<Block, { type: 'reasoning' }>; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const live = streaming && !block.endedAt
  const now = useNow(live)
  const dur = (block.endedAt ?? now) - block.startedAt
  const hasText = block.text.trim().length > 0
  return (
    <div className="anim-fade-up">
      <button
        onClick={() => hasText && setOpen((o) => !o)}
        className={cn('group flex items-center gap-2 rounded-full py-1 pr-2 text-sm text-muted transition', hasText && 'hover:text-fg')}
      >
        <Brain size={15} className={cn(live && 'text-accent')} />
        {live ? <span className="shimmer font-medium">Thinking{dur > 1500 ? ` · ${fmtDuration(dur)}` : '…'}</span> : <span className="font-medium">{block.endedAt ? `Thought for ${fmtDuration(dur)}` : 'Thought (interrupted)'}</span>}
        {hasText && <ChevronRight size={14} className={cn('transition-transform duration-200', open && 'rotate-90')} />}
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="ml-[7px] mt-1 border-l-2 border-line pl-5">
            <Markdown text={block.text} small />
          </div>
        </div>
      </div>
    </div>
  )
}

const partial = (args: string, key: string) => {
  try { return String(JSON.parse(args)[key] ?? '') } catch { /* partial */ }
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(args)
  return m ? m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : ''
}

export function SearchPill({ block }: { block: Extract<Block, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const query = partial(block.args, 'query')
  const running = block.status === 'running'
  const results = block.sources ?? []
  return (
    <div className="anim-fade-up">
      <button
        onClick={() => !running && results.length && setOpen((o) => !o)}
        className={cn(
          'glass flex max-w-full items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-[13px] transition',
          block.status === 'error' && 'text-danger',
        )}
      >
        {running ? <Loader2 size={14} className="spin text-accent" /> : block.status === 'error' ? <CircleAlert size={14} /> : <Globe size={14} className="text-accent" />}
        <span className={cn('truncate font-medium', running && 'shimmer')}>
          {running ? 'Searching the web' : block.status === 'error' ? 'Search failed' : 'Searched the web'}
        </span>
        {query && <span className="truncate text-muted">“{query}”</span>}
        {!running && block.status === 'done' && <span className="shrink-0 text-faint">· {results.length || 'no'} new result{results.length === 1 ? '' : 's'}</span>}
        {!running && results.length > 0 && <ChevronRight size={13} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />}
      </button>
      {block.status === 'error' && block.result && <p className="mt-1 pl-3 text-xs text-danger/80">{block.result}</p>}
      <div className={cn('grid transition-[grid-template-rows] duration-300', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="mt-2 flex flex-col gap-1">
            {results.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] transition hover:bg-fg/5">
                <Favicon domain={s.domain} size={16} />
                <span className="truncate">{s.title}</span>
                <span className="ml-auto shrink-0 text-xs text-faint">{s.domain}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export const kindIcon = (k: Artifact['kind'], size = 18) =>
  k === 'slides' ? <Presentation size={size} /> : k === 'video' ? <Video size={size} /> : k === 'image' ? <ImageIcon size={size} /> : k === 'diagram' ? <Workflow size={size} /> : k === 'app' ? <Rocket size={size} /> : k === 'chart' ? <BarChart3 size={size} /> : k === 'html' ? <FileCode2 size={size} /> : k === 'svg' ? <Shapes size={size} /> : k === 'markdown' ? <FileText size={size} /> : <Code2 size={size} />

export function ArtifactCard({ block, artifact, messageId }: { block: Extract<Block, { type: 'tool' }>; artifact?: Artifact; messageId: string }) {
  const setPanel = useStore((s) => s.setPanel)
  const panel = useStore((s) => s.panel)
  const running = block.status === 'running'
  const title = artifact?.title ?? (partial(block.args, 'title') || 'Artifact')
  const active = panel?.kind === 'artifact' && panel.artifactId === artifact?.id && panel.messageId === messageId
  if (artifact?.kind === 'slides' && !running) {
    const deck = deckOf(artifact.content)
    const first = deck ? layoutDeck(deck).slides[0] : null
    return (
      <button
        onClick={() => setPanel(active ? null : { kind: 'artifact', messageId, artifactId: artifact.id })}
        className={cn('glass anim-fade-up group w-full max-w-md overflow-hidden rounded-2xl text-left transition hover:-translate-y-px', active && 'ring-2 ring-accent/50')}
      >
        {first && <div className="border-b border-line"><SlideThumb slide={first} /></div>}
        <div className="flex items-center gap-3 p-2.5 pr-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Presentation size={17} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{artifact.title}</span><span className="block text-xs text-muted">Presentation · {deck?.slides.length ?? 0} slides{artifact.version > 1 ? ` · v${artifact.version}` : ''}</span></span>
          <ChevronRight size={16} className="text-faint transition group-hover:translate-x-0.5" />
        </div>
      </button>
    )
  }
  if (artifact?.kind === 'diagram' && !running)
    return (
      <button
        onClick={() => setPanel(active ? null : { kind: 'artifact', messageId, artifactId: artifact.id })}
        className={cn('glass anim-fade-up group w-full max-w-md overflow-hidden rounded-2xl text-left transition hover:-translate-y-px', active && 'ring-2 ring-accent/50')}
      >
        <div className="h-44 border-b border-line bg-surface-2/40 p-3"><DiagramThumb content={artifact.content} /></div>
        <div className="flex items-center gap-3 p-2.5 pr-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Workflow size={17} /></span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{artifact.title}</span><span className="block text-xs text-muted">Diagram{artifact.version > 1 ? ` · v${artifact.version}` : ''} · Click to open</span></span>
          <ChevronRight size={16} className="text-faint transition group-hover:translate-x-0.5" />
        </div>
      </button>
    )
  return (
    <button
      disabled={!artifact}
      onClick={() => artifact && setPanel(active ? null : { kind: 'artifact', messageId, artifactId: artifact.id })}
      className={cn(
        'glass anim-fade-up group flex w-full max-w-sm items-center gap-3 rounded-2xl p-2.5 pr-4 text-left transition hover:-translate-y-px',
        active && 'ring-2 ring-accent/50',
      )}
    >
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent', running && 'animate-[pulse-ring_1.4s_ease-out_infinite]')}>
        {running ? <Loader2 size={18} className="spin" /> : kindIcon(artifact?.kind ?? 'html')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">
          {running ? 'Creating artifact…' : block.status === 'error' ? 'Failed' : `${artifact?.kind === 'app' ? 'Live app' : artifact?.kind === 'html' ? 'Web page' : artifact?.kind === 'chart' ? 'Chart' : artifact?.kind === 'svg' ? 'SVG' : artifact?.kind === 'markdown' ? 'Document' : artifact?.language ?? 'Code'}${artifact && artifact.version > 1 ? ` · v${artifact.version}` : ''} · Click to open`}
        </span>
      </span>
      {!running && <ChevronRight size={16} className="text-faint transition group-hover:translate-x-0.5" />}
    </button>
  )
}

export function GenericToolPill({ block }: { block: Extract<Block, { type: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const mcpName = parseMcpName(block.name)
  const running = block.status === 'running'
  return (
    <div className="anim-fade-up">
      <button onClick={() => !running && setOpen((o) => !o)} className={cn('glass flex max-w-full items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-[13px]', block.status === 'error' && 'text-danger')}>
        {running ? <Loader2 size={14} className="spin text-accent" /> : block.status === 'error' ? <CircleAlert size={14} /> : <Wrench size={14} className="text-accent" />}
        <span className={cn('truncate font-medium', running && 'shimmer')}>{running ? 'Running' : block.status === 'error' ? 'Failed' : 'Used'} {mcpName?.tool ?? block.name}</span>
        {mcpName && <span className="shrink-0 text-faint">· {mcpName.server.replace(/_/g, ' ')}</span>}
        {!running && <ChevronRight size={13} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />}
      </button>
      {open && (
        <div className="anim-fade-up mt-2 max-w-full overflow-hidden rounded-2xl border border-line bg-surface-2/60 font-mono text-xs">
          <div className="border-b border-line p-3"><div className="mb-1 font-sans text-faint">Input</div><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{block.args || '{}'}</pre></div>
          <div className="p-3"><div className="mb-1 font-sans text-faint">Output</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all">{block.result}</pre></div>
        </div>
      )}
    </div>
  )
}

export function SourcesBar({ sources, onOpen, active }: { sources: Source[]; onOpen: () => void; active?: boolean }) {
  const domains = [...new Map(sources.map((s) => [s.domain, s])).values()]
  return (
    <button onClick={onOpen} className={cn('glass anim-fade-up group flex w-fit items-center gap-2.5 rounded-full py-1.5 pl-2 pr-3.5 transition hover:-translate-y-px', active && 'ring-2 ring-accent/50')}>
      <span className="flex -space-x-1.5">
        {domains.slice(0, 5).map((s, i) => (
          <span key={s.domain} style={{ zIndex: 10 - i }} className="rounded-full ring-2 ring-surface"><Favicon domain={s.domain} size={20} /></span>
        ))}
      </span>
      <span className="text-[13px] font-medium">{sources.length} source{sources.length === 1 ? '' : 's'}</span>
      <Layers size={13} className="text-faint transition group-hover:text-accent" />
    </button>
  )
}

const RATIO: Record<string, string> = { square: '1 / 1', landscape: '3 / 2', portrait: '2 / 3' }

export function ImageGenCard({ block, artifact, messageId }: { block: Extract<Block, { type: 'tool' }>; artifact?: Artifact; messageId: string }) {
  const setPanel = useStore((s) => s.setPanel)
  const running = block.status === 'running'
  const now = useNow(running)
  const secs = Math.max(0, Math.round(((block.endedAt ?? now) - block.startedAt) / 1000))
  const ratio = RATIO[block.aspect ?? artifact?.meta?.aspect ?? 'square'] ?? '1 / 1'
  const prompt = partial(block.args, 'prompt')
  const enhancing = !block.phase // still writing the prompt (tool arguments streaming)
  const open = () => artifact && setPanel({ kind: 'artifact', messageId, artifactId: artifact.id })

  if (block.status === 'error')
    return (
      <div className="anim-fade-up flex max-w-sm items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
        <CircleAlert size={16} className="mt-0.5 shrink-0" /><span className="break-words">Image generation failed: {block.result}</span>
      </div>
    )

  const savedTo = (block.meta as { savedTo?: string } | undefined)?.savedTo
  if (artifact && !running)
    return (
      <div className="flex w-full max-w-sm flex-col gap-2">
      <div className="anim-fade-up group relative w-full overflow-hidden rounded-3xl border border-line bg-surface-2 shadow-sm" style={{ aspectRatio: ratio }}>
        <img src={artifact.content} alt={artifact.title} onClick={open} className="anim-reveal h-full w-full cursor-zoom-in object-cover" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/55 to-transparent p-3 pt-10 opacity-0 transition group-hover:opacity-100">
          <span className="truncate pr-2 text-[13px] font-medium text-white">{artifact.title}</span>
          <span className="pointer-events-auto flex shrink-0 gap-1.5">
            <button title="Open" onClick={open} className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/35"><Maximize2 size={14} /></button>
            <button title="Download" onClick={() => downloadDataUrl(`${artifact.title.replace(/\W+/g, '-').toLowerCase()}.${dataUrlExt(artifact.content)}`, artifact.content)} className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/35"><Download size={14} /></button>
          </span>
        </div>
      </div>
      {savedTo && <div className="flex items-center gap-1.5 px-1 text-[13px] text-muted"><Check size={13} strokeWidth={3} className="text-accent" />Saved to <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{savedTo}</code></div>}
      </div>
    )

  return (
    <div className="anim-fade-up relative w-full max-w-sm overflow-hidden rounded-3xl border border-line bg-surface-2" style={{ aspectRatio: ratio }}>
      <div className="imggen-sweep absolute inset-0 overflow-hidden" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-5 text-center">
        <div className="relative grid h-14 w-14 place-items-center">
          <span className="absolute inset-0 rounded-full border border-dashed border-accent/50" style={{ animation: 'orbit 6s linear infinite' }} />
          <span className="absolute inset-2 rounded-full bg-accent-soft" style={{ animation: 'breathe 2s ease-in-out infinite' }} />
          <Sparkles size={20} className="relative text-accent" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2 text-sm font-medium"><span className="shimmer">{enhancing ? 'Writing an enhanced prompt' : 'Generating image'}</span><span className="tabular-nums text-faint">{secs}s</span></div>
        </div>
        <p className="line-clamp-3 max-w-[90%] text-xs leading-relaxed text-muted anim-fade-up" key={block.enhanced ?? prompt}>{block.enhanced ?? prompt}</p>
      </div>
    </div>
  )
}

export function VideoGenCard({ block, artifact, messageId }: { block: Extract<Block, { type: 'tool' }>; artifact?: Artifact; messageId: string }) {
  const setPanel = useStore((s) => s.setPanel)
  const running = block.status === 'running'
  const now = useNow(running)
  const secs = Math.max(0, Math.round(((block.endedAt ?? now) - block.startedAt) / 1000))
  const portrait = (block.aspect ?? artifact?.meta?.aspect) === 'portrait'
  const prompt = partial(block.args, 'prompt')
  const enhancing = !block.phase
  const meta = (block.meta ?? {}) as { progress?: number; status?: string }
  const open = () => artifact && setPanel({ kind: 'artifact', messageId, artifactId: artifact.id })
  const save = async () => {
    if (!artifact) return
    const b = await loadVideo(artifact.id)
    if (!b) return
    const u = URL.createObjectURL(b)
    const a = document.createElement('a'); a.href = u; a.download = `${artifact.title.replace(/\W+/g, '-').toLowerCase()}.mp4`; a.click()
    setTimeout(() => URL.revokeObjectURL(u), 4000)
  }
  const box = portrait ? 'max-w-[15rem]' : 'max-w-md'
  const ratio = portrait ? '9 / 16' : '16 / 9'

  if (block.status === 'error')
    return (
      <div className="anim-fade-up flex max-w-sm items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
        <CircleAlert size={16} className="mt-0.5 shrink-0" /><span className="break-words">Video generation failed: {block.result}</span>
      </div>
    )

  if (artifact && !running)
    return (
      <div className={cn('anim-fade-up group relative w-full overflow-hidden rounded-3xl border border-line bg-black shadow-sm', box)} style={{ aspectRatio: ratio }}>
        <VideoPlayer id={artifact.id} className="h-full w-full" />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/55 to-transparent p-3 pb-10 opacity-0 transition group-hover:opacity-100">
          <span className="truncate pr-2 text-[13px] font-medium text-white">{artifact.title}</span>
          <span className="pointer-events-auto flex shrink-0 gap-1.5">
            <button title="Open" onClick={open} className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/35"><Maximize2 size={14} /></button>
            <button title="Download" onClick={save} className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-white backdrop-blur transition hover:bg-white/35"><Download size={14} /></button>
          </span>
        </div>
      </div>
    )

  return (
    <div className={cn('anim-fade-up relative w-full overflow-hidden rounded-3xl border border-line bg-surface-2', box)} style={{ aspectRatio: ratio }}>
      <div className="imggen-sweep absolute inset-0 overflow-hidden" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-5 text-center">
        <div className="relative grid h-14 w-14 place-items-center">
          <span className="absolute inset-0 rounded-full border border-dashed border-accent/50" style={{ animation: 'orbit 6s linear infinite' }} />
          <span className="absolute inset-2 rounded-full bg-accent-soft" style={{ animation: 'breathe 2s ease-in-out infinite' }} />
          <Video size={20} className="relative text-accent" />
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2 text-sm font-medium"><span className="shimmer">{enhancing ? 'Writing an enhanced prompt' : meta.status === 'queued' ? 'Waiting in the queue' : 'Generating video'}</span><span className="tabular-nums text-faint">{secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}</span></div>
          {!enhancing && typeof meta.progress === 'number' && meta.progress > 0 && <div className="h-1 w-32 overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.min(100, meta.progress)}%` }} /></div>}
        </div>
        <p className="line-clamp-3 max-w-[90%] text-xs leading-relaxed text-muted anim-fade-up" key={block.enhanced ?? prompt}>{block.enhanced ?? prompt}</p>
      </div>
    </div>
  )
}

export function DiagramThumb({ content }: { content: string }) {
  const dark = useIsDark()
  const laid = useMemo(() => tryLayout(content).laid, [content])
  if (!laid) return null
  return <DiagramSvg laid={laid} dark={dark} className="h-full w-full" />
}

/* -------------------------- sandbox tool cards -------------------------- */
const TITLES: Record<string, [string, string]> = {
  sandbox_exec: ['Running command', 'Ran command'],
  sandbox_write_file: ['Writing file', 'Wrote file'],
  sandbox_read_file: ['Reading file', 'Read file'],
  sandbox_expose_port: ['Deploying', 'Deployed'],
  sandbox_artifact: ['Preparing artifact', 'Created artifact'],
}

export function SandboxCard({ block, messageId, hasArtifact }: { block: Extract<Block, { type: 'tool' }>; messageId: string; hasArtifact?: boolean }) {
  const [open, setOpen] = useState(false)
  const setPanel = useStore((s) => s.setPanel)
  const running = block.status === 'running'
  const now = useNow(running)
  const secs = Math.max(0, Math.round(((block.endedAt ?? now) - block.startedAt) / 1000))
  const [t0, t1] = TITLES[block.name] ?? ['Running', 'Done']
  const command = partial(block.args, 'command')
  const path = partial(block.args, 'path')
  const port = partial(block.args, 'port')
  const meta = (block.meta ?? {}) as { exit?: number | null; url?: string; bytes?: number; http?: string; fresh?: boolean }
  const failed = block.status === 'error' || (block.name === 'sandbox_exec' && typeof meta.exit === 'number' && meta.exit !== 0)
  const Icon = block.name === 'sandbox_exec' ? Terminal : block.name === 'sandbox_write_file' ? FilePen : block.name === 'sandbox_expose_port' ? Rocket : block.name === 'sandbox_artifact' ? Package : FileText
  const output = (block.result ?? '').trim()
  const expandable = block.name === 'sandbox_exec' ? !!command || !!output : !running && !!output
  const label = block.name === 'sandbox_exec' ? command : block.name === 'sandbox_expose_port' ? `port ${port}` : path

  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <button onClick={() => expandable && setOpen((o) => !o)} className={cn('flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left', !expandable && 'cursor-default')}>
        {running ? <Loader2 size={15} className="spin shrink-0 text-accent" /> : failed ? <CircleAlert size={15} className="shrink-0 text-danger" /> : <Icon size={15} className="shrink-0 text-accent" />}
        <span className={cn('shrink-0 text-[13px] font-medium', running && 'shimmer', failed && 'text-danger')}>{running ? t0 : failed ? 'Failed' : t1}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{label}</span>
        {block.name === 'sandbox_exec' && !running && typeof meta.exit === 'number' && <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums', meta.exit === 0 ? 'bg-accent-soft text-accent' : 'bg-danger/10 text-danger')}>exit {meta.exit}</span>}
        {running && <span className="shrink-0 text-xs tabular-nums text-faint">{secs}s</span>}
        {expandable && <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />}
      </button>

      {open && block.name === 'sandbox_exec' && command && (
        <div className="border-t border-line bg-[#0b0b0d] px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed text-zinc-100">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all"><span className="select-none text-emerald-400">$ </span>{command}</pre>
        </div>
      )}
      {block.name === 'sandbox_expose_port' && meta.url && (
        <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5">
          <a href={meta.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[13px] text-accent hover:underline">{meta.url}</a>
          <button title="Copy URL" onClick={() => navigator.clipboard.writeText(meta.url!)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><Copy size={13} /></button>
          <a title="Open" href={meta.url} target="_blank" rel="noreferrer" className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><ExternalLink size={13} /></a>
          {hasArtifact && <button onClick={() => { const m = useStore.getState().chats.flatMap((c) => c.messages).find((x) => x.id === messageId); const a = m?.artifacts?.find((x) => x.id === block.artifactId); if (a) setPanel({ kind: 'artifact', messageId, artifactId: a.id }) }} className="flex h-7 items-center rounded-full bg-fg px-3 text-xs font-medium text-bg active:scale-95">Preview</button>}
        </div>
      )}
      {open && output && <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-line bg-surface-2/50 px-3.5 py-2.5 font-mono text-xs leading-relaxed text-muted">{output}</pre>}
    </div>
  )
}

export function ReadPill({ block }: { block: Extract<Block, { type: 'tool' }> }) {
  const url = partial(block.args, 'url')
  const running = block.status === 'running'
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } })()
  return (
    <div className={cn('glass anim-fade-up flex w-fit max-w-full items-center gap-2 rounded-full py-1.5 pl-3 pr-3.5 text-[13px]', block.status === 'error' && 'text-danger')}>
      {running ? <Loader2 size={14} className="spin text-accent" /> : block.status === 'error' ? <CircleAlert size={14} /> : <Link2 size={14} className="text-accent" />}
      <span className={cn('shrink-0 font-medium', running && 'shimmer')}>{running ? 'Reading page' : block.status === 'error' ? 'Could not read' : 'Read page'}</span>
      <a href={url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-muted hover:text-fg">{host}</a>
    </div>
  )
}

const oneLine = (t: string, n = 110) => t.replace(/[*_`#>\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

/** All the searching, reading and thinking of a deep-research run, folded into one live timeline. */
export function ResearchGroup({ blocks, live, sourceCount }: { blocks: Block[]; live: boolean; sourceCount: number }) {
  const [open, setOpen] = useState(false)
  const tools = blocks.filter((b): b is Extract<Block, { type: 'tool' }> => b.type === 'tool')
  const searches = tools.filter((t) => t.name === 'web_search')
  const reads = tools.filter((t) => t.name === 'read_url')
  const current = [...tools].reverse().find((t) => t.status === 'running')
  const action = current ? (current.name === 'web_search' ? `Searching “${partial(current.args, 'query')}”` : `Reading ${(() => { try { return new URL(partial(current.args, 'url')).hostname.replace(/^www\./, '') } catch { return 'page' } })()}`) : 'Thinking…'
  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent', live && 'animate-[pulse-ring_1.6s_ease-out_infinite]')}><Telescope size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm font-medium', live && 'shimmer')}>{live ? 'Researching…' : 'Researched'}</span>
          <span className="block truncate text-xs text-muted">{live ? action : `${searches.length} search${searches.length === 1 ? '' : 'es'} · ${reads.length} page${reads.length === 1 ? '' : 's'} read · ${sourceCount} sources`}</span>
        </span>
        {live && <span className="shrink-0 rounded-full bg-fg/6 px-2 py-0.5 text-xs tabular-nums text-muted">{searches.length + reads.length} steps</span>}
        <ChevronRight size={15} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />
      </button>
      {live && <div className="imggen-sweep relative h-0.5 overflow-hidden bg-fg/6" />}
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-line px-2 py-2">
          {blocks.map((b) => {
            if (b.type === 'reasoning') return b.text.trim() ? <div key={b.id} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-muted"><Brain size={14} className="mt-0.5 shrink-0 text-faint" /><span className="min-w-0 break-words">{oneLine(b.text)}</span></div> : null
            if (b.type !== 'tool') return null
            const isSearch = b.name === 'web_search'
            const q = partial(b.args, isSearch ? 'query' : 'url')
            return (
              <div key={b.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]">
                {b.status === 'running' ? <Loader2 size={14} className="spin shrink-0 text-accent" /> : b.status === 'error' ? <CircleAlert size={14} className="shrink-0 text-danger" /> : isSearch ? <Search size={14} className="shrink-0 text-accent" /> : <Link2 size={14} className="shrink-0 text-accent" />}
                <span className="min-w-0 flex-1 truncate">{q}</span>
                {b.status === 'done' && <span className="shrink-0 text-xs text-faint">{isSearch ? `${b.sources?.length ?? 0} new` : 'read'}</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
