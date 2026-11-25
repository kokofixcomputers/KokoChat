import { useEffect, useState } from 'react'
import { Quote } from 'lucide-react'
import { useStore } from '../store'

interface Pos { x: number; y: number; text: string }

/** Floating "Add to quote" button that appears when you highlight text inside a message. */
export function SelectionQuote() {
  const addQuote = useStore((s) => s.addQuote)
  const [pos, setPos] = useState<Pos | null>(null)

  useEffect(() => {
    const update = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setPos(null)
      const text = sel.toString().replace(/\s+\n/g, '\n').trim()
      if (text.length < 2) return setPos(null)
      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === 1 ? (node as Element) : node.parentElement
      if (!el?.closest('[data-quotable]')) return setPos(null)
      const r = range.getBoundingClientRect()
      if (!r.width && !r.height) return setPos(null)
      if (r.bottom < 0 || r.top > innerHeight) return setPos(null)
      setPos({ x: r.left + r.width / 2, y: r.top, text })
    }
    const later = () => setTimeout(update, 12)
    const hide = () => { if (window.getSelection()?.isCollapsed) setPos(null) }
    document.addEventListener('mouseup', later)
    document.addEventListener('keyup', later)
    document.addEventListener('touchend', later)
    document.addEventListener('selectionchange', hide)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      document.removeEventListener('mouseup', later)
      document.removeEventListener('keyup', later)
      document.removeEventListener('touchend', later)
      document.removeEventListener('selectionchange', hide)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [])

  if (!pos) return null
  const W = 148
  const left = Math.min(Math.max(8, pos.x - W / 2), innerWidth - W - 8)
  const top = pos.y > 56 ? pos.y - 46 : pos.y + 28
  return (
    <button
      // keep the text selected while clicking
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        addQuote(pos.text.slice(0, 4000))
        window.getSelection()?.removeAllRanges()
        setPos(null)
        window.dispatchEvent(new Event('koko:focus-composer'))
      }}
      style={{ left, top, width: W }}
      className="glass-strong anim-pop fixed z-[120] flex h-9 items-center justify-center gap-2 rounded-full text-[13px] font-medium shadow-lg transition hover:scale-[1.03] active:scale-95"
    >
      <Quote size={14} className="text-accent" />Add to quote
    </button>
  )
}
