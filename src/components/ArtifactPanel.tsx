import { useContext, useMemo, useState } from 'react'
import { ReadOnlyView, webUrl } from '../lib/readOnly'
import { Download, X, Eye, Code2, ExternalLink, FileImage, RotateCw } from 'lucide-react'
import { useStore } from '../store'
import type { Artifact } from '../types'
import { Markdown, CopyButton } from './Markdown'
import { kindIcon } from './Blocks'
import { Favicon, IconButton, Segmented } from './ui'
import { cn, download, downloadDataUrl, dataUrlExt } from '../lib/utils'
import { SlidesViewer, downloadPptx } from './SlidesViewer'
import { DiagramViewer, diagramPngDataUrl, diagramSvgString, tryLayout, useIsDark } from './Diagram'
import { toast } from '../lib/toast'
import { ChartView } from './Chart'
import { PublishMenu } from './PublishMenu'
import { artifactRef, ownsOldPage } from '../lib/publishRef'
import { VideoPlayer } from './VideoPlayer'
import { loadVideo } from '../lib/videogen'

const frame = (a: Artifact) =>
  a.kind === 'svg'
    ? `<!doctype html><meta charset=utf-8><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${a.content}</body>`
    : a.content

const ext = (a: Artifact) => ({ html: 'html', chart: 'json', svg: 'svg', markdown: 'md', code: a.language ?? 'txt', image: dataUrlExt(a.content), diagram: 'svg', app: 'url', video: 'mp4', slides: 'json' })[a.kind]

export function ArtifactPanel({ artifact }: { artifact: Artifact }) {
  const setPanel = useStore((s) => s.setPanel)
  const readOnly = useContext(ReadOnlyView)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const live = useStore((s) => Object.keys(s.streaming).length > 0)
  const dark = useIsDark()
  // the open panel names a message; the chat holding it is part of the published page's reference
  const chatId = useStore((s) => { const p = s.panel; return p?.kind === 'artifact' ? s.chats.find((c) => c.messages.some((m) => m.id === p.messageId))?.id : undefined })
  const slug = artifact.title.replace(/\W+/g, '-').toLowerCase()
  const saveDiagram = (png: boolean) => {
    const { laid, error } = tryLayout(artifact.content)
    if (!laid) return toast.error(error ?? 'Could not export')
    if (png) diagramPngDataUrl(laid, dark).then((u) => downloadDataUrl(`${slug}.png`, u)).catch((e) => toast.error(e.message))
    else download(`${slug}.svg`, diagramSvgString(laid, dark), 'image/svg+xml')
  }
  return (
    <div className="glass-strong anim-slide-in flex h-full min-h-0 flex-col overflow-hidden rounded-[28px]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent-soft text-accent">{kindIcon(artifact.kind, 16)}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{artifact.title}</div>
          <div className="text-xs text-muted">{artifact.kind}{artifact.version > 1 && ` · v${artifact.version}`}</div>
        </div>
        <Segmented compact value={tab} onChange={setTab} options={[{ value: 'preview', label: 'Preview', icon: <Eye size={13} /> }, artifact.kind === 'image' || artifact.kind === 'video' ? { value: 'code', label: 'Prompt', icon: <Code2 size={13} /> } : { value: 'code', label: 'Code', icon: <Code2 size={13} /> }]} />
        {artifact.kind !== 'image' && artifact.kind !== 'video' && <CopyButton text={artifact.content} className="hidden sm:flex" />}
        <IconButton title="Download" className="h-8 w-8" onClick={async () => { if (artifact.kind === 'slides') { try { await downloadPptx(artifact.content, artifact.title) } catch (e: any) { toast.error(e.message) } return } if (artifact.kind === 'video') { const b = await loadVideo(artifact.id); if (!b) return toast.error('This video is not stored on this device.'); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${artifact.title.replace(/\W+/g, '-').toLowerCase()}.mp4`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 4000); return } if (artifact.kind === 'diagram') return saveDiagram(false); const n = `${artifact.title.replace(/\W+/g, '-').toLowerCase()}.${ext(artifact)}`; artifact.kind === 'image' ? downloadDataUrl(n, artifact.content) : download(n, artifact.content) }}><Download size={16} /></IconButton>
        {artifact.kind === 'diagram' && <IconButton title="Download PNG" className="h-8 w-8" onClick={() => saveDiagram(true)}><FileImage size={16} /></IconButton>}
        {artifact.kind === 'app' && <IconButton title="Open live app" className="h-8 w-8" onClick={() => window.open(webUrl(artifact.content), '_blank', 'noopener')}><ExternalLink size={16} /></IconButton>}
        {!readOnly && chatId && (artifact.kind === 'html' || artifact.kind === 'diagram' || artifact.kind === 'chart') && <PublishMenu item={{ ref: artifactRef(chatId, artifact.id), title: artifact.title, kind: artifact.kind, content: artifact.content, adopts: (p) => ownsOldPage(useStore.getState().chats, chatId, artifact.id, p) }} />}
        {/* a blob: tab runs with this site's own access, so never for someone else's page */}
        {!readOnly && artifact.kind === 'html' && (
          <IconButton title="Open in new tab" className="h-8 w-8" onClick={() => window.open(URL.createObjectURL(new Blob([artifact.content], { type: 'text/html' })), '_blank')}><ExternalLink size={16} /></IconButton>
        )}
        <IconButton title="Close" className="h-8 w-8" onClick={() => setPanel(null)}><X size={17} /></IconButton>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto">
        {artifact.kind === 'video' ? (
          tab === 'code' ? (
            <div className="flex flex-col gap-5 p-6">
              <section><div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">Prompt<CopyButton text={artifact.meta?.prompt ?? ''} /></div><p className="rounded-2xl border border-line bg-surface-2/60 p-4 text-sm leading-relaxed">{artifact.meta?.prompt}</p></section>
              <div className="text-xs text-faint">{[artifact.meta?.model, artifact.meta?.seconds ? `${artifact.meta.seconds}s` : '', artifact.meta?.aspect].filter(Boolean).join(' · ')}</div>
            </div>
          ) : (
            <div className="grid min-h-full place-items-center bg-surface-2/40 p-4"><VideoPlayer id={artifact.id} autoPlay className="max-h-full max-w-full rounded-2xl shadow-lg" /></div>
          )
        ) : artifact.kind === 'image' ? (
          tab === 'code' ? (
            <div className="flex flex-col gap-5 p-6">
              <section><div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">Prompt<CopyButton text={artifact.meta?.prompt ?? ''} /></div><p className="rounded-2xl border border-line bg-surface-2/60 p-4 text-sm leading-relaxed">{artifact.meta?.prompt}</p></section>
              {artifact.meta?.enhanced && <section><div className="mb-1.5 text-xs font-medium text-muted">Revised by the image model</div><p className="text-sm leading-relaxed text-muted">{artifact.meta.enhanced}</p></section>}
              {artifact.meta?.model && <div className="text-xs text-faint">Model: {artifact.meta.model}</div>}
            </div>
          ) : (
            <div className="grid min-h-full place-items-center bg-surface-2/40 p-5"><img src={artifact.content} alt={artifact.title} className="anim-reveal max-h-full max-w-full rounded-2xl shadow-lg" /></div>
          )
        ) : tab === 'code' ? (
          <div className="p-3"><Markdown text={`\`\`\`\`${artifact.kind === 'code' ? artifact.language ?? '' : artifact.kind === 'html' ? 'html' : artifact.kind === 'svg' ? 'xml' : artifact.kind === 'chart' || artifact.kind === 'diagram' || artifact.kind === 'slides' ? 'json' : 'markdown'}\n${artifact.content}\n\`\`\`\``} /></div>
        ) : artifact.kind === 'html' || artifact.kind === 'svg' ? (
          <iframe title={artifact.title} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={frame(artifact)} className={cn('h-full w-full bg-white', live && 'pointer-events-none')} />
        ) : artifact.kind === 'app' ? (
          <AppFrame url={artifact.content} />
        ) : artifact.kind === 'slides' ? (
          <SlidesViewer content={artifact.content} title={artifact.title} />
        ) : artifact.kind === 'diagram' ? (
          <DiagramViewer content={artifact.content} />
        ) : artifact.kind === 'chart' ? (
          <ChartView content={artifact.content} />
        ) : artifact.kind === 'markdown' ? (
          <div className="p-6"><Markdown text={artifact.content} /></div>
        ) : (
          <div className="p-3"><Markdown text={`\`\`\`\`${artifact.language ?? ''}\n${artifact.content}\n\`\`\`\``} /></div>
        )}
      </div>
    </div>
  )
}

export function SourcesPanel({ messageId }: { messageId: string }) {
  const setPanel = useStore((s) => s.setPanel)
  const sources = useStore((s) => s.chats.flatMap((c) => c.messages).find((m) => m.id === messageId)?.sources ?? [])
  return (
    <div className="glass-strong anim-slide-in flex h-full min-h-0 flex-col overflow-hidden rounded-[28px]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="text-sm font-medium">Sources <span className="ml-1 text-muted">{sources.length}</span></div>
        <IconButton className="h-8 w-8" onClick={() => setPanel(null)}><X size={17} /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {sources.map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex gap-3 rounded-2xl p-3 transition hover:bg-fg/5">
            <span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-accent-soft px-1 text-[11px] font-semibold text-accent">{s.n}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-xs text-muted"><Favicon domain={s.domain} size={14} />{s.domain}</span>
              <span className="mt-0.5 block text-sm font-medium leading-snug">{s.title}</span>
              <span className="mt-1 line-clamp-3 block text-[13px] leading-snug text-muted">{s.snippet}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

export function AppFrame({ url: given }: { url: string }) {
  const [n, setN] = useState(0)
  // the frame may use its own origin, so it must be a web address and never this site's
  const url = webUrl(given) && new URL(given).origin !== location.origin ? given : ''
  if (!url) return <div className="p-6 text-sm text-muted">This app's address can't be shown.</div>
  return (
    <div className="flex h-full min-h-[320px] flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface-2/40 px-3 py-1.5">
        <button title="Reload" onClick={() => setN((x) => x + 1)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><RotateCw size={13} /></button>
        <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate rounded-full bg-fg/5 px-3 py-1 font-mono text-xs text-muted hover:text-fg">{url}</a>
      </div>
      <iframe key={n} title="Live app" src={url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" className="min-h-0 flex-1 bg-white" />
    </div>
  )
}
