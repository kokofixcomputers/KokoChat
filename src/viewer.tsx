/**
 * The page behind a published chart or diagram. The sync worker serves it sandboxed (an opaque origin: no storage, no
 * cookies, nothing of the app's), so nothing imported here may touch the app's store or browser storage.
 */
import { createRoot } from 'react-dom/client'
import './index.css'
import { ChartView } from './components/Chart'
import { DiagramViewer, PanZoom } from './components/Diagram'
import { useMermaid } from './lib/mermaid'

function MermaidPage({ code }: { code: string }) {
  const { svg, error } = useMermaid(code)
  if (error) return <div className="p-6 text-sm text-danger">Could not draw diagram: {error}</div>
  if (!svg) return <div className="p-6 text-center text-sm text-muted"><span className="shimmer">Rendering diagram…</span></div>
  const [minX, minY, width, height] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? '0 0 800 600').split(/[\s,]+/).map(Number)
  void minX, void minY // the SVG applies its own viewBox origin
  return (
    <PanZoom bounds={{ minX: 0, minY: 0, width, height }}>
      {(v) => <div className="absolute left-0 top-0 origin-top-left [&>svg]:block [&>svg]:h-full [&>svg]:w-full [&>svg]:!max-w-none" style={{ width, height, transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})` }} dangerouslySetInnerHTML={{ __html: svg }} />}
    </PanZoom>
  )
}

const dark = matchMedia('(prefers-color-scheme: dark)')
const theme = () => document.documentElement.classList.toggle('dark', dark.matches)
theme()
dark.addEventListener('change', theme)

const { kind, title, content } = JSON.parse(document.getElementById('koko-artifact')!.textContent!) as { kind: string; title: string; content: string }

createRoot(document.getElementById('root')!).render(
  <div className="flex h-full flex-col">
    <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
      <span className="shrink-0 text-xs text-faint">Koko Chat</span>
    </header>
    <main className="min-h-0 flex-1 overflow-auto">
      {kind === 'chart' ? <ChartView content={content} /> : kind === 'diagram' ? <DiagramViewer content={content} /> : <MermaidPage code={content} />}
    </main>
  </div>,
)
