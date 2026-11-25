import { useMemo, useState } from 'react'
import { Download, X, Eye, Code2, ExternalLink, FileImage, RotateCw } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useStore } from '../store'
import type { Artifact } from '../types'
import { Markdown, CopyButton } from './Markdown'
import { kindIcon } from './Blocks'
import { Favicon, IconButton, Segmented } from './ui'
import { cn, download, downloadDataUrl, dataUrlExt } from '../lib/utils'
import { SlidesViewer, downloadPptx } from './SlidesViewer'
import { DiagramViewer, diagramPngDataUrl, diagramSvgString, tryLayout, useIsDark } from './Diagram'
import { toast } from '../lib/toast'
import { PublishMenu } from './PublishMenu'
import { VideoPlayer } from './VideoPlayer'
import { loadVideo } from '../lib/videogen'

const PALETTE = ['#10a37f', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16']

function ChartView({ content }: { content: string }) {
  const spec = useMemo(() => { try { return { s: JSON.parse(content.replace(/^```json\s*|```$/g, '')) } } catch (e: any) { return { err: String(e.message) } } }, [content])
  if ('err' in spec) return <p className="p-6 text-sm text-danger">Invalid chart spec: {spec.err}</p>
  const { type = 'bar', data = [], xKey = 'name', series = [], title } = spec.s
  const ser: { key: string; label?: string }[] = series.length ? series : Object.keys(data[0] ?? {}).filter((k) => k !== xKey).map((key) => ({ key }))
  const tick = { fill: 'var(--muted)', fontSize: 12 }
  const tip = { contentStyle: { background: 'var(--glass-strong)', backdropFilter: 'blur(16px)', border: '1px solid var(--line)', borderRadius: 14, fontSize: 13 }, cursor: { fill: 'var(--accent-soft)' } }
  const axes = (<>
    <CartesianGrid strokeDasharray="3 6" stroke="var(--line)" vertical={false} />
    <XAxis dataKey={xKey} tick={tick} tickLine={false} axisLine={false} />
    <YAxis tick={tick} tickLine={false} axisLine={false} width={44} />
    <Tooltip {...tip} />
    {ser.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
  </>)
  return (
    <div className="flex h-full flex-col p-5">
      {title && <h3 className="mb-3 text-sm font-medium">{title}</h3>}
      <div className="min-h-[320px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'pie' ? (
            <PieChart>
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Pie data={data} dataKey={ser[0]?.key} nameKey={xKey} innerRadius="55%" outerRadius="82%" paddingAngle={3} cornerRadius={6} stroke="none">
                {data.map((_: unknown, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
            </PieChart>
          ) : type === 'line' ? (
            <LineChart data={data}>{axes}{ser.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={PALETTE[i % 8]} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />)}</LineChart>
          ) : type === 'area' ? (
            <AreaChart data={data}>
              <defs>{ser.map((s, i) => <linearGradient key={s.key} id={`g${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={PALETTE[i % 8]} stopOpacity={0.4} /><stop offset="100%" stopColor={PALETTE[i % 8]} stopOpacity={0} /></linearGradient>)}</defs>
              {axes}{ser.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label ?? s.key} stroke={PALETTE[i % 8]} strokeWidth={2.5} fill={`url(#g${i})`} />)}
            </AreaChart>
          ) : (
            <BarChart data={data}>{axes}{ser.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key} fill={PALETTE[i % 8]} radius={[8, 8, 0, 0]} />)}</BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const frame = (a: Artifact) =>
  a.kind === 'svg'
    ? `<!doctype html><meta charset=utf-8><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#fff">${a.content}</body>`
    : a.content

const ext = (a: Artifact) => ({ html: 'html', chart: 'json', svg: 'svg', markdown: 'md', code: a.language ?? 'txt', image: dataUrlExt(a.content), diagram: 'svg', app: 'url', video: 'mp4', slides: 'json' })[a.kind]

export function ArtifactPanel({ artifact }: { artifact: Artifact }) {
  const setPanel = useStore((s) => s.setPanel)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const live = useStore((s) => Object.keys(s.streaming).length > 0)
  const dark = useIsDark()
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
        {artifact.kind === 'app' && <IconButton title="Open live app" className="h-8 w-8" onClick={() => window.open(artifact.content, '_blank')}><ExternalLink size={16} /></IconButton>}
        {artifact.kind === 'html' && <PublishMenu artifact={artifact} />}
        {artifact.kind === 'html' && (
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

/** Preview-only rendering of an artifact (used by the public shared-chat page). */
export function ArtifactPreview({ artifact }: { artifact: Pick<Artifact, 'kind' | 'title' | 'content' | 'language'> }) {
  const a = artifact as Artifact
  const dark = useIsDark()
  void dark
  if (a.kind === 'image') return <div className="grid min-h-full place-items-center bg-surface-2/40 p-4"><img src={a.content} alt={a.title} className="max-h-[540px] max-w-full rounded-2xl" /></div>
  if (a.kind === 'html' || a.kind === 'svg') return <iframe title={a.title} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={frame(a)} className="h-full w-full bg-white" />
  if (a.kind === 'app') return <AppFrame url={a.content} />
  if (a.kind === 'slides') return <SlidesViewer content={a.content} title={a.title} />
  if (a.kind === 'diagram') return <DiagramViewer content={a.content} />
  if (a.kind === 'chart') return <ChartView content={a.content} />
  if (a.kind === 'markdown') return <div className="p-6"><Markdown text={a.content} /></div>
  return <div className="p-3"><Markdown text={`\`\`\`\`${a.language ?? ''}\n${a.content}\n\`\`\`\``} /></div>
}

export function AppFrame({ url }: { url: string }) {
  const [n, setN] = useState(0)
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
