import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, X } from 'lucide-react'
import { FONTS, SLIDE_H, SLIDE_W, deckOf, layoutDeck, type Op, type SlideOps } from '../lib/slides'
import { buildPptx } from '../lib/slidesPptx'
import { download } from '../lib/utils'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

const PX = 100 // one inch = 100 px on the stage
const css = (face: string) => (face === 'Georgia' ? 'Georgia,"Times New Roman",serif' : face === 'Arial' ? 'Arial,Helvetica,sans-serif' : FONTS.modern.css)
const rgba = (hex: string, a = 1) => `rgba(${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)},${a})`

function Draw({ op }: { op: Op }) {
  switch (op.t) {
    case 'rect':
      return <div style={{ position: 'absolute', left: op.x * PX, top: op.y * PX, width: op.w * PX, height: op.h * PX, background: rgba(op.fill, op.alpha ?? 1), borderRadius: (op.radius ?? 0) * PX, ...(op.line ? { border: `${(op.lineW ?? 1) * PX / 72}px solid #${op.line}` } : {}) }} />
    case 'ellipse':
      return <div style={{ position: 'absolute', left: op.x * PX, top: op.y * PX, width: op.w * PX, height: op.h * PX, background: rgba(op.fill, op.alpha ?? 1), borderRadius: '50%' }} />
    case 'line': {
      const dx = op.x2 - op.x1, dy = op.y2 - op.y1, len = Math.hypot(dx, dy), th = (op.width * PX) / 72
      return <div style={{ position: 'absolute', left: op.x1 * PX, top: op.y1 * PX - th / 2, width: len * PX, height: th, background: `#${op.color}`, borderRadius: th / 2, transformOrigin: '0 50%', transform: `rotate(${Math.atan2(dy, dx)}rad)` }} />
    }
    case 'text':
      return (
        <div style={{ position: 'absolute', left: op.x * PX, top: op.y * PX, width: op.w * PX, height: op.h * PX, display: 'flex', alignItems: op.valign === 'middle' ? 'center' : op.valign === 'bottom' ? 'flex-end' : 'flex-start' }}>
          <div style={{ width: '100%', textAlign: op.align ?? 'left', color: `#${op.color}`, fontFamily: css(op.font), fontSize: (op.size * PX) / 72, fontWeight: op.bold ? 700 : 400, fontStyle: op.italic ? 'italic' : 'normal', lineHeight: op.spacing ?? 1.2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{op.text}</div>
        </div>
      )
    case 'image':
      return <img src={op.data} alt="" style={{ position: 'absolute', left: op.x * PX, top: op.y * PX, width: op.w * PX, height: op.h * PX, objectFit: 'cover', borderRadius: 0.24 * PX }} />
    case 'wedge': {
      const rad = (d: number) => (d * Math.PI) / 180
      const big = op.a1 - op.a0 > 180 ? 1 : 0
      const d = op.a1 - op.a0 >= 359.9 ? 'M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z' : `M 0 0 L ${Math.cos(rad(op.a0))} ${Math.sin(rad(op.a0))} A 1 1 0 ${big} 1 ${Math.cos(rad(op.a1))} ${Math.sin(rad(op.a1))} Z`
      return <svg viewBox="-1 -1 2 2" style={{ position: 'absolute', left: (op.cx - op.r) * PX, top: (op.cy - op.r) * PX, width: op.r * 2 * PX, height: op.r * 2 * PX, overflow: 'visible' }}><path d={d} fill={`#${op.fill}`} stroke={`#${op.fill}`} strokeWidth={0.004} /></svg>
    }
    case 'table':
      return (
        <table style={{ position: 'absolute', left: op.x * PX, top: op.y * PX, width: op.w * PX, borderCollapse: 'collapse', fontFamily: css(op.font), fontSize: (op.size * PX) / 72, color: `#${op.text}`, tableLayout: 'fixed' }}>
          <thead><tr>{op.columns.map((c, i) => <th key={i} style={{ background: `#${op.head}`, color: `#${op.headText}`, textAlign: 'left', fontWeight: 700, padding: '0.06in 0.14in', height: (op.h / (op.rows.length + 1)) * PX, border: `1px solid #${op.line}` }}>{c}</th>)}</tr></thead>
          <tbody>{op.rows.map((r, i) => <tr key={i}>{op.columns.map((_, j) => <td key={j} style={{ background: i % 2 ? 'transparent' : `#${op.zebra}`, padding: '0.06in 0.14in', height: (op.h / (op.rows.length + 1)) * PX, border: `1px solid #${op.line}` }}>{r[j] ?? ''}</td>)}</tr>)}</tbody>
        </table>
      )
  }
}

/** One slide, drawn at the given width in pixels. */
export const SlideCanvas = memo(function SlideCanvas({ slide, width, className }: { slide: SlideOps; width: number; className?: string }) {
  const k = width / (SLIDE_W * PX)
  return (
    <div className={cn('relative shrink-0 overflow-hidden', className)} style={{ width, height: SLIDE_H * PX * k, background: `#${slide.bg}` }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: SLIDE_W * PX, height: SLIDE_H * PX, transformOrigin: '0 0', transform: `scale(${k})` }}>
        {slide.ops.map((op, i) => <Draw key={i} op={op} />)}
      </div>
    </div>
  )
})

/** Hook: the width of an element. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el); setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export async function downloadPptx(content: string, title: string) {
  const deck = deckOf(content)
  if (!deck) throw new Error('This presentation could not be read.')
  const blob: Blob = await buildPptx(deck, 'blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `${(title || deck.title || 'presentation').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'presentation'}.pptx`
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function Present({ slides, start, onClose }: { slides: SlideOps[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const [vw, setVw] = useState({ w: innerWidth, h: innerHeight })
  useEffect(() => {
    const r = () => setVw({ w: innerWidth, h: innerHeight })
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); setI((n) => Math.min(slides.length - 1, n + 1)) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); setI((n) => Math.max(0, n - 1)) }
    }
    addEventListener('resize', r); addEventListener('keydown', k, true)
    return () => { removeEventListener('resize', r); removeEventListener('keydown', k, true) }
  }, [slides.length, onClose])
  const width = Math.min(vw.w, (vw.h * SLIDE_W) / SLIDE_H)
  return (
    <div className="fixed inset-0 z-[150] grid place-items-center bg-black" onClick={() => setI((n) => Math.min(slides.length - 1, n + 1))}>
      <SlideCanvas slide={slides[i]} width={width} />
      <button onClick={(e) => { e.stopPropagation(); onClose() }} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20" title="Exit (Esc)"><X size={18} /></button>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs tabular-nums text-white/80">{i + 1} / {slides.length}</div>
    </div>
  )
}

/** The presentation in the side panel: big slide, thumbnails, speaker notes, present mode and the .pptx download. */
export function SlidesViewer({ content, title }: { content: string; title: string }) {
  const deck = useMemo(() => deckOf(content), [content])
  const laid = useMemo(() => (deck ? layoutDeck(deck) : null), [deck])
  const [i, setI] = useState(0)
  const [present, setPresent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ref, w] = useWidth()
  const n = laid?.slides.length ?? 0
  useEffect(() => { if (i >= n) setI(Math.max(0, n - 1)) }, [n, i])
  if (!deck || !laid) return <p className="p-6 text-sm text-muted">This presentation could not be read.</p>
  const cur = laid.slides[Math.min(i, n - 1)]
  const save = async () => { setBusy(true); try { await downloadPptx(content, title) } catch (e: any) { toast.error(e.message) } setBusy(false) }
  return (
    <div className="flex min-h-full flex-col gap-3 p-4" tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowRight') setI((x) => Math.min(n - 1, x + 1)); if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1)) }}>
      <div ref={ref} className="w-full">
        {w > 0 && <SlideCanvas slide={cur} width={w} className="rounded-xl shadow-lg ring-1 ring-black/10" />}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} className="grid h-8 w-8 place-items-center rounded-full bg-fg/6 transition hover:bg-fg/10 disabled:opacity-30"><ChevronLeft size={16} /></button>
        <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-muted">{i + 1} of {n}</span>
        <button onClick={() => setI((x) => Math.min(n - 1, x + 1))} disabled={i >= n - 1} className="grid h-8 w-8 place-items-center rounded-full bg-fg/6 transition hover:bg-fg/10 disabled:opacity-30"><ChevronRight size={16} /></button>
        <span className="flex-1" />
        <button onClick={() => setPresent(true)} className="flex h-8 items-center gap-1.5 rounded-full bg-fg/6 px-3 text-[13px] font-medium transition hover:bg-fg/10"><Maximize2 size={13} />Present</button>
        <button onClick={save} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg transition active:scale-95 disabled:opacity-60">{busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />}Download .pptx</button>
      </div>
      {cur.notes && <div className="rounded-xl bg-fg/4 px-3.5 py-2.5 text-xs leading-relaxed text-muted"><span className="font-medium text-fg/70">Speaker notes · </span>{cur.notes}</div>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {laid.slides.map((s, k) => (
          <button key={k} onClick={() => setI(k)} className={cn('overflow-hidden rounded-lg ring-2 transition', k === i ? 'ring-accent' : 'ring-transparent opacity-90 hover:opacity-100')} title={`Slide ${k + 1}`}>
            <SlideThumb slide={s} />
          </button>
        ))}
      </div>
      {present && <Present slides={laid.slides} start={i} onClose={() => setPresent(false)} />}
    </div>
  )
}

/** A slide that fills the width of its container. */
export function SlideThumb({ slide }: { slide: SlideOps }) {
  const [ref, w] = useWidth()
  return <div ref={ref} className="w-full">{w > 0 && <SlideCanvas slide={slide} width={w} />}</div>
}
