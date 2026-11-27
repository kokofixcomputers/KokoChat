import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Maximize, Minus, Plus } from 'lucide-react'
import { layoutDiagram, parseSpec, type Laid, type LNode, type LEdge } from '../lib/diagram'
import { IconButton } from './ui'
import { useIsDark } from '../lib/useIsDark'

export { useIsDark }

/* ------------------------------ colours ------------------------------ */
const PAL: Record<string, { stroke: string; dark: string }> = {
  green: { stroke: '#10a37f', dark: '#34d399' }, blue: { stroke: '#3b82f6', dark: '#60a5fa' }, amber: { stroke: '#d97706', dark: '#fbbf24' },
  red: { stroke: '#dc2626', dark: '#f87171' }, purple: { stroke: '#7c3aed', dark: '#a78bfa' }, teal: { stroke: '#0d9488', dark: '#2dd4bf' },
  pink: { stroke: '#db2777', dark: '#f472b6' }, gray: { stroke: '#6b7280', dark: '#9ca3af' },
}
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function tone(name: string | undefined, dark: boolean, filled = true) {
  const p = name ? PAL[name] : undefined
  const stroke = p ? (dark ? p.dark : p.stroke) : name && HEX.test(name) ? name : dark ? '#9ca3af' : '#4b5563'
  const fill = !filled ? 'none' : p || (name && HEX.test(name)) ? stroke + (dark ? '2e' : '22') : dark ? '#1f1f24' : '#ffffff'
  return { stroke, fill, text: dark ? '#f4f4f5' : '#111827' }
}

/* ------------------------------ geometry ----------------------------- */
function roundedPath(pts: [number, number][], r = 12) {
  if (pts.length < 2) return ''
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1]
    const l1 = Math.hypot(x - px, y - py), l2 = Math.hypot(nx - x, ny - y)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    if (rr < 1) { d += ` L${x},${y}`; continue }
    d += ` L${x - ((x - px) / l1) * rr},${y - ((y - py) / l1) * rr} Q${x},${y} ${x + ((nx - x) / l2) * rr},${y + ((ny - y) / l2) * rr}`
  }
  const [lx, ly] = pts[pts.length - 1]
  return d + ` L${lx},${ly}`
}

const head = (x: number, y: number, fx: number, fy: number, s = 9) => {
  const a = Math.atan2(y - fy, x - fx)
  const p = (da: number, len: number) => `${x - Math.cos(a + da) * len},${y - Math.sin(a + da) * len}`
  return `${x},${y} ${p(0.42, s)} ${p(-0.42, s)}`
}

/* ------------------------------- shapes ------------------------------ */
function ShapeEl({ n, dark }: { n: LNode; dark: boolean }) {
  const t = tone(n.color, dark, n.filled)
  const { x, y, w, h } = n
  const l = x - w / 2, r = x + w / 2, tp = y - h / 2, b = y + h / 2
  const common = { fill: t.fill, stroke: t.stroke, strokeWidth: 1.6, strokeLinejoin: 'round' as const }
  switch (n.shape) {
    case 'rect': return <rect x={l} y={tp} width={w} height={h} rx={3} {...common} />
    case 'pill': return <rect x={l} y={tp} width={w} height={h} rx={h / 2} {...common} />
    case 'diamond': return <polygon points={`${x},${tp} ${r},${y} ${x},${b} ${l},${y}`} {...common} />
    case 'ellipse': case 'circle': return <ellipse cx={x} cy={y} rx={w / 2} ry={h / 2} {...common} />
    case 'hexagon': { const k = Math.min(26, w / 4); return <polygon points={`${l + k},${tp} ${r - k},${tp} ${r},${y} ${r - k},${b} ${l + k},${b} ${l},${y}`} {...common} /> }
    case 'parallelogram': { const k = Math.min(22, w / 5); return <polygon points={`${l + k},${tp} ${r},${tp} ${r - k},${b} ${l},${b}`} {...common} /> }
    case 'cylinder': {
      const ry = 9
      return (
        <g {...common}>
          <path d={`M${l},${tp + ry} A${w / 2},${ry} 0 0 1 ${r},${tp + ry} V${b - ry} A${w / 2},${ry} 0 0 1 ${l},${b - ry} Z`} />
          <path d={`M${l},${tp + ry} A${w / 2},${ry} 0 0 0 ${r},${tp + ry}`} fill="none" />
        </g>
      )
    }
    case 'note': { const k = 14; return <g {...common}><path d={`M${l},${tp} H${r - k} L${r},${tp + k} V${b} H${l} Z`} /><path d={`M${r - k},${tp} V${tp + k} H${r}`} fill="none" /></g> }
    default: return <rect x={l} y={tp} width={w} height={h} rx={14} {...common} />
  }
}

function Lines({ lines, x, y, size, color, anchor = 'middle', center = true }: { lines: string[]; x: number; y: number; size: number; color: string; anchor?: 'start' | 'middle'; center?: boolean }) {
  const lh = size * 1.28
  const y0 = center ? y - ((lines.length - 1) * lh) / 2 : y
  return (
    <text x={x} textAnchor={anchor} fill={color} fontSize={size} fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" fontWeight={500}>
      {lines.map((ln, i) => <tspan key={i} x={x} y={y0 + i * lh} dy={center ? size * 0.36 : 0}>{ln}</tspan>)}
    </text>
  )
}

function EdgeEl({ e, dark }: { e: LEdge; dark: boolean }) {
  const c = tone(e.color, dark).stroke
  const pts = e.points
  const n = pts.length
  const end = pts[n - 1], pre = pts[n - 2], start = pts[0], post = pts[1]
  const stroke = e.color ? c : dark ? '#a1a1aa' : '#52525b'
  const dash = e.dash === 'dashed' ? '7 5' : e.dash === 'dotted' ? '2 5' : undefined
  const bg = dark ? '#17171a' : '#ffffff'
  return (
    <g>
      <path d={roundedPath(pts)} fill="none" stroke={stroke} strokeWidth={1.7} strokeDasharray={dash} strokeLinecap="round" />
      {e.arrowEnd && <polygon points={head(end[0], end[1], pre[0], pre[1])} fill={stroke} />}
      {e.arrowStart && <polygon points={head(start[0], start[1], post[0], post[1])} fill={stroke} />}
      {e.label && e.lx != null && (
        <g>
          <rect x={e.lx - (e.label.length * 6.8) / 2 - 7} y={e.ly! - 11} width={e.label.length * 6.8 + 14} height={22} rx={7} fill={bg} stroke={dark ? '#ffffff22' : '#00000014'} />
          <text x={e.lx} y={e.ly! + 4.5} textAnchor="middle" fontSize={12} fill={dark ? '#d4d4d8' : '#3f3f46'} fontFamily="Inter, ui-sans-serif, system-ui, sans-serif">{e.label}</text>
        </g>
      )}
    </g>
  )
}

/* ------------------------------ svg scene ---------------------------- */
export function DiagramScene({ laid, dark }: { laid: Laid; dark: boolean }) {
  return (
    <>
      {laid.groups.map((g, i) => {
        const t = tone(g.color, dark, false)
        return (
          <g key={'g' + i}>
            <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={16} fill={g.color ? t.stroke + (dark ? '14' : '0f') : dark ? '#ffffff08' : '#00000005'} stroke={t.stroke} strokeDasharray="6 5" strokeWidth={1.3} />
            {g.label && <text x={g.x + 14} y={g.y + 20} fontSize={12} fontWeight={600} fill={t.stroke} fontFamily="Inter, ui-sans-serif, system-ui, sans-serif">{g.label}</text>}
          </g>
        )
      })}
      {laid.edges.map((e, i) => <EdgeEl key={'e' + i} e={e} dark={dark} />)}
      {laid.nodes.map((n) => (
        <g key={n.id}>
          <ShapeEl n={n} dark={dark} />
          {n.lines.length > 0 && <Lines lines={n.lines} x={n.x} y={n.y} size={n.size} color={tone(n.color, dark).text} />}
        </g>
      ))}
      {laid.texts.map((t, i) => <Lines key={'t' + i} lines={t.lines} x={t.x} y={t.y} size={t.size} color={t.color ? tone(t.color, dark).stroke : tone(undefined, dark).text} anchor={t.anchor} center={false} />)}
    </>
  )
}

export function DiagramSvg({ laid, dark, className }: { laid: Laid; dark: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${laid.minX} ${laid.minY} ${laid.width} ${laid.height}`} className={className} preserveAspectRatio="xMidYMid meet">
      <DiagramScene laid={laid} dark={dark} />
    </svg>
  )
}

export function tryLayout(content: string): { laid?: Laid; error?: string } {
  try { return { laid: layoutDiagram(parseSpec(content)) } } catch (e: any) { return { error: String(e?.message ?? e) } }
}

/* ------------------------------- export ------------------------------ */
export function diagramSvgString(laid: Laid, dark: boolean, withBg = true) {
  const w = Math.ceil(laid.width), h = Math.ceil(laid.height)
  const inner = renderToStaticMarkup(<DiagramScene laid={laid} dark={dark} />)
  const bg = withBg ? `<rect x="${laid.minX}" y="${laid.minY}" width="${laid.width}" height="${laid.height}" fill="${dark ? '#0d0d0e' : '#ffffff'}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${laid.minX} ${laid.minY} ${laid.width} ${laid.height}">${bg}${inner}</svg>`
}

export async function diagramPngDataUrl(laid: Laid, dark: boolean, scale = 2): Promise<string> {
  const svg = diagramSvgString(laid, dark)
  const img = new Image()
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render PNG')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) })
  const c = document.createElement('canvas')
  c.width = Math.ceil(laid.width * scale); c.height = Math.ceil(laid.height * scale)
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

/* ------------------------------- viewer ------------------------------ */
export interface Bounds { minX: number; minY: number; width: number; height: number }
export interface View { k: number; x: number; y: number }

/** A surface you can drag around and zoom (wheel, buttons, double-click to fit). */
export function PanZoom({ bounds, children }: { bounds: Bounds; children: (view: View) => ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const { minX, minY, width, height } = bounds

  const fit = () => {
    const el = box.current
    if (!el) return
    const { width: W, height: H } = el.getBoundingClientRect()
    const k = Math.min(W / width, H / height, 1.4) * 0.94
    setView({ k, x: (W - width * k) / 2 - minX * k, y: (H - height * k) / 2 - minY * k })
  }
  useEffect(() => {
    fit()
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [minX, minY, width, height]) // eslint-disable-line

  const zoomAt = (f: number, cx: number, cy: number) =>
    setView((v) => { const k = Math.min(6, Math.max(0.1, v.k * f)); const r = k / v.k; return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r } })

  return (
    <div
      ref={box}
      className="relative h-full min-h-[320px] cursor-grab touch-none select-none overflow-hidden bg-surface-2/30 active:cursor-grabbing"
      onWheel={(e) => { e.preventDefault(); const r = box.current!.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top) }}
      onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }}
      onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })) }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={fit}
    >
      {children(view)}
      <div className="glass-strong absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full p-1" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <IconButton className="h-8 w-8" title="Zoom out" onClick={() => { const r = box.current!.getBoundingClientRect(); zoomAt(1 / 1.25, r.width / 2, r.height / 2) }}><Minus size={15} /></IconButton>
        <span className="w-11 text-center text-xs tabular-nums text-muted">{Math.round(view.k * 100)}%</span>
        <IconButton className="h-8 w-8" title="Zoom in" onClick={() => { const r = box.current!.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2) }}><Plus size={15} /></IconButton>
        <IconButton className="h-8 w-8" title="Fit to view" onClick={fit}><Maximize size={15} /></IconButton>
      </div>
    </div>
  )
}

export function DiagramViewer({ content }: { content: string }) {
  const dark = useIsDark()
  const { laid, error } = useMemo(() => tryLayout(content), [content])
  if (error || !laid) return <div className="p-6 text-sm text-danger">Could not draw diagram: {error}</div>
  return (
    <PanZoom bounds={laid}>
      {(view) => (
        <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}><DiagramScene laid={laid} dark={dark} /></g>
        </svg>
      )}
    </PanZoom>
  )
}
