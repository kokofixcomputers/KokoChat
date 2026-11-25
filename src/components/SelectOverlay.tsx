import { useEffect, useRef, useState } from 'react'
import { koko } from '../lib/desktop'

/** Full-screen overlay for choosing an area: the screen is frozen and dimmed, drag a rectangle, release to capture. */
export function SelectOverlay() {
  const [img, setImg] = useState<string | null>(null)
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const k = koko()
    const off = k?.quick.onSelectImage((p) => setImg(p.dataUrl))
    k?.quick.selectReady()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') k?.quick.selectDone(null) }
    window.addEventListener('keydown', key)
    return () => { off?.(); window.removeEventListener('keydown', key) }
  }, [])

  const norm = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-black"
      style={{ cursor: 'crosshair', backgroundImage: img ? `url(${img})` : undefined, backgroundSize: '100% 100%' }}
      onMouseDown={(e) => { start.current = { x: e.clientX, y: e.clientY }; setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 }) }}
      onMouseMove={(e) => { if (start.current) setRect(norm(start.current, { x: e.clientX, y: e.clientY })) }}
      onMouseUp={(e) => { const r = start.current ? norm(start.current, { x: e.clientX, y: e.clientY }) : null; start.current = null; koko()?.quick.selectDone(r && r.w > 4 && r.h > 4 ? r : null) }}
      onContextMenu={(e) => { e.preventDefault(); koko()?.quick.selectDone(null) }}
    >
      {/* everything outside the chosen area is dimmed */}
      <div className="pointer-events-none absolute" style={rect && rect.w > 0 ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h, boxShadow: '0 0 0 100vmax rgba(0,0,0,0.45)', outline: '1.5px solid rgba(255,255,255,0.95)' } : { inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      {rect && rect.w > 40 && rect.h > 20 && <div className="pointer-events-none absolute rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white" style={{ left: rect.x, top: Math.max(0, rect.y - 22) }}>{Math.round(rect.w)} × {Math.round(rect.h)}</div>}
      {!rect && <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white">Drag to capture an area · Esc to cancel</div>}
    </div>
  )
}
