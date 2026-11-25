/**
 * Presentations. The AI describes a deck as JSON (a theme and slides that each use a layout); this file turns every slide
 * into a list of simple drawing operations (rectangles, circles, text, images, charts, tables) in inches on a 13.33 x 7.5
 * slide. The same operations are drawn by the live preview (SlidesViewer) and written into the .pptx (slidesPptx.ts),
 * so what you see is what you download.
 */

export const SLIDE_W = 13.333
export const SLIDE_H = 7.5

/* ----------------------------------------------------------------------------------------- spec (what the AI writes) */
export interface SlideImage { prompt?: string; /** filled in when the picture was generated */ data?: string; emoji?: string }
export interface Slide {
  layout: 'title' | 'section' | 'bullets' | 'cards' | 'stats' | 'compare' | 'steps' | 'quote' | 'image' | 'chart' | 'table' | 'closing'
  title?: string
  subtitle?: string
  tag?: string
  number?: string
  bullets?: string[]
  text?: string
  side?: { stat?: string; label?: string }
  cards?: { icon?: string; title: string; text?: string }[]
  stats?: { value: string; label: string; note?: string }[]
  summary?: string
  left?: { heading: string; points: string[] }
  right?: { heading: string; points: string[] }
  steps?: { title: string; text?: string }[]
  quote?: string
  author?: string
  image?: SlideImage
  imageSide?: 'left' | 'right'
  chart?: { type: 'bar' | 'line' | 'pie' | 'doughnut' | 'area'; labels: string[]; series: { name: string; values: number[] }[] }
  takeaway?: string
  columns?: string[]
  rows?: string[][]
  contact?: string
  notes?: string
}
export interface Deck { title?: string; theme?: string; accent?: string; font?: 'modern' | 'serif' | 'classic'; slides: Slide[] }

export const LAYOUTS = ['title', 'section', 'bullets', 'cards', 'stats', 'compare', 'steps', 'quote', 'image', 'chart', 'table', 'closing'] as const

/* ----------------------------------------------------------------------------------------------------- drawing ops */
export type Op =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; radius?: number; alpha?: number; line?: string; lineW?: number }
  | { t: 'ellipse'; x: number; y: number; w: number; h: number; fill: string; alpha?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: boolean }
  | { t: 'text'; x: number; y: number; w: number; h: number; text: string; size: number; color: string; font: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom'; spacing?: number }
  | { t: 'image'; x: number; y: number; w: number; h: number; data: string }
  | { t: 'wedge'; cx: number; cy: number; r: number; a0: number; a1: number; fill: string }
  | { t: 'table'; x: number; y: number; w: number; h: number; columns: string[]; rows: string[][]; head: string; headText: string; zebra: string; text: string; line: string; font: string; size: number }

export interface SlideOps { bg: string; ops: Op[]; notes?: string }

/* --------------------------------------------------------------------------------------------------------- themes */
export interface Theme { name: string; dark: boolean; bg: string; bgAlt: string; surface: string; text: string; muted: string; accent: string; accent2: string; onAccent: string }

export const THEMES: Record<string, Theme> = {
  midnight: { name: 'Midnight', dark: true, bg: '0B1220', bgAlt: '111B2E', surface: '17233B', text: 'F3F6FB', muted: '93A4BF', accent: '22D3B6', accent2: '6C8CFF', onAccent: '04121C' },
  clean: { name: 'Clean', dark: false, bg: 'FFFFFF', bgAlt: 'F3F6FB', surface: 'F1F5FB', text: '0F172A', muted: '5B6B82', accent: '2563EB', accent2: '7C3AED', onAccent: 'FFFFFF' },
  sunset: { name: 'Sunset', dark: false, bg: 'FFF8F1', bgAlt: 'FFEBD9', surface: 'FFFFFF', text: '2B1B12', muted: '8A6A58', accent: 'F2542D', accent2: 'F5A524', onAccent: 'FFFFFF' },
  forest: { name: 'Forest', dark: true, bg: '0F1F17', bgAlt: '16301F', surface: '1B3A28', text: 'EAF5EC', muted: '95B8A0', accent: '5BD38A', accent2: 'D6E86B', onAccent: '07140C' },
  violet: { name: 'Violet', dark: true, bg: '14102A', bgAlt: '1D1740', surface: '261E55', text: 'F4F1FF', muted: 'A59BD4', accent: 'A78BFA', accent2: 'F472B6', onAccent: '140E2E' },
  mono: { name: 'Mono', dark: false, bg: 'FAFAFA', bgAlt: 'EFEFEF', surface: 'FFFFFF', text: '111111', muted: '6B6B6B', accent: '111111', accent2: 'E11D48', onAccent: 'FFFFFF' },
  ocean: { name: 'Ocean', dark: false, bg: 'F4FAFF', bgAlt: 'DDF0FF', surface: 'FFFFFF', text: '0B2540', muted: '4C6A88', accent: '0EA5E9', accent2: '14B8A6', onAccent: 'FFFFFF' },
  rose: { name: 'Rose', dark: false, bg: 'FFF5F7', bgAlt: 'FFE1E8', surface: 'FFFFFF', text: '2A1218', muted: '8C5A66', accent: 'E11D74', accent2: 'FB7185', onAccent: 'FFFFFF' },
}
export const THEME_NAMES = Object.keys(THEMES)

export const FONTS = {
  modern: { heading: 'Calibri', body: 'Calibri', css: '"Calibri","Carlito","Segoe UI",system-ui,sans-serif', cssHeading: '"Calibri","Carlito","Segoe UI",system-ui,sans-serif' },
  serif: { heading: 'Georgia', body: 'Calibri', css: '"Calibri","Carlito","Segoe UI",system-ui,sans-serif', cssHeading: 'Georgia,"Times New Roman",serif' },
  classic: { heading: 'Arial', body: 'Arial', css: 'Arial,Helvetica,sans-serif', cssHeading: 'Arial,Helvetica,sans-serif' },
} as const

const hex = (c: string) => c.replace('#', '').toUpperCase()
const isHex = (c: unknown): c is string => typeof c === 'string' && /^#?[0-9a-fA-F]{6}$/.test(c.trim())

export function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16)
  const ch = (i: number) => Math.round(p(a, i) * (1 - t) + p(b, i) * t).toString(16).padStart(2, '0')
  return (ch(0) + ch(2) + ch(4)).toUpperCase()
}

export function themeOf(deck: Deck): Theme {
  const base = THEMES[String(deck.theme ?? '').toLowerCase()] ?? THEMES.midnight
  if (!isHex(deck.accent)) return base
  const accent = hex(deck.accent.trim())
  // pick readable text for the accent colour
  const lum = (parseInt(accent.slice(0, 2), 16) * 299 + parseInt(accent.slice(2, 4), 16) * 587 + parseInt(accent.slice(4, 6), 16) * 114) / 1000
  return { ...base, accent, onAccent: lum > 150 ? '10131A' : 'FFFFFF' }
}

/* ------------------------------------------------------------------------------------------------- text fitting */
/** How many lines `text` needs in a box `w` inches wide at `size` pt (average character width, word wrapping). */
export function wrapLines(text: string, w: number, size: number, bold = false): number {
  const cpl = Math.max(1, Math.floor((w * 72) / (size * (bold ? 0.55 : 0.5))))
  let lines = 0
  for (const para of String(text).split('\n')) {
    lines += 1
    let cur = 0
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const n = word.length
      if (cur === 0) cur = n
      else if (cur + 1 + n <= cpl) cur += 1 + n
      else { lines++; cur = n }
      while (cur > cpl) { lines++; cur -= cpl } // a very long word
    }
  }
  return lines
}
/** The biggest font size (between min and max) at which the text fits in the box. */
export function fit(text: string, w: number, h: number, max: number, min: number, bold = false, spacing = 1.22): number {
  for (let s = max; s >= min; s--) if (wrapLines(text, w, s, bold) * s * spacing / 72 <= h) return s
  return min
}

/** The biggest size at which the text fits on ONE line (for big numbers). */
export function fit1(text: string, w: number, max: number, min: number, bold = false): number {
  for (let s = max; s >= min; s--) if ((String(text).length * s * (bold ? 0.58 : 0.52)) / 72 <= w) return s
  return min
}

/* ---------------------------------------------------------------------------------------------------- layouts */
const M = 0.7 // side margin
const CW = SLIDE_W - 2 * M // content width
const TOP = 1.95 // where content starts under the title
const BOT = 6.75 // where it must end

const clean = (s: unknown, max = 400) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const list = <T,>(v: unknown, max: number): T[] => (Array.isArray(v) ? (v.slice(0, max) as T[]) : [])

const nice = (max: number) => {
  if (!(max > 0)) return { max: 1, step: 0.25 }
  const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag
  return { max: step * Math.ceil(max / step), step }
}
const num = (v: number) => (Math.abs(v) >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : Math.abs(v) >= 1e4 ? +(v / 1e3).toFixed(0) + 'k' : Math.abs(v) >= 1e3 ? +(v / 1e3).toFixed(1) + 'k' : String(+v.toFixed(2)))

/** A chart drawn from plain shapes, so it looks the same in the preview, PowerPoint, Keynote and Google Slides. */
function chartOps(c: NonNullable<Slide['chart']>, box: { x: number; y: number; w: number; h: number }, th: Theme, f: { body: string }): Op[] {
  const ops: Op[] = []
  const labels = c.labels.slice(0, 12).map((l) => clean(l, 22))
  const series = c.series.slice(0, 4).map((se) => ({ name: clean(se.name, 28), values: labels.map((_, i) => Number(se.values?.[i]) || 0) }))
  const colors = [th.accent, th.accent2, mix(th.accent, th.text, 0.4), mix(th.accent2, th.text, 0.4), mix(th.accent, th.surface, 0.5), mix(th.accent2, th.surface, 0.5), mix(th.accent, th.text, 0.65), mix(th.accent2, th.text, 0.65)]
  const txt = (t: string, x: number, y: number, w: number, h: number, size: number, color: string, o: Partial<Extract<Op, { t: 'text' }>> = {}) => ops.push({ t: 'text', x, y, w, h, text: t, size, color, font: f.body, ...o })
  if (!labels.length || !series.length) return ops

  if (c.type === 'pie' || c.type === 'doughnut') {
    const vals = series[0].values.map((v) => Math.max(0, v)), total = vals.reduce((a, b) => a + b, 0) || 1
    const r = Math.min(box.h / 2 - 0.1, box.w * 0.26), cx = box.x + box.w * 0.28, cy = box.y + box.h / 2
    let a = -90
    vals.forEach((v, i) => { const sweep = (v / total) * 360; if (sweep > 0.01) ops.push({ t: 'wedge', cx, cy, r, a0: a, a1: a + sweep, fill: colors[i % colors.length] }); a += sweep })
    if (c.type === 'doughnut') { ops.push({ t: 'ellipse', x: cx - r * 0.55, y: cy - r * 0.55, w: r * 1.1, h: r * 1.1, fill: th.surface }); txt(num(total), cx - r * 0.5, cy - 0.4, r, 0.8, fit(num(total), r, 0.8, 30, 14, true, 1), th.text, { bold: true, align: 'center', valign: 'middle', spacing: 1 }) }
    const lx = box.x + box.w * 0.58, rowH = Math.min(0.62, (box.h - 0.4) / labels.length), ly = cy - (rowH * labels.length) / 2
    labels.forEach((l, i) => {
      const yy = ly + i * rowH
      ops.push({ t: 'ellipse', x: lx, y: yy + rowH / 2 - 0.1, w: 0.2, h: 0.2, fill: colors[i % colors.length] })
      txt(l, lx + 0.4, yy, box.w * 0.42 - 1.7, rowH, fit(l, box.w * 0.42 - 1.7, rowH, 17, 11), th.text, { valign: 'middle' })
      txt(Math.round((vals[i] / total) * 100) + '%', box.x + box.w - 1.15, yy, 1.0, rowH, 17, th.muted, { bold: true, align: 'right', valign: 'middle' })
    })
    return ops
  }

  // bar and line charts share axes
  const legend = series.length > 1
  const left = 0.85, bottom = legend ? 1.0 : 0.6, top = 0.25
  const px = box.x + left, py = box.y + top, pw = box.w - left - 0.15, ph = box.h - top - bottom
  const maxV = Math.max(...series.flatMap((se) => se.values), 0), minV = Math.min(...series.flatMap((se) => se.values), 0)
  const { max, step } = nice(maxV)
  const lo = minV < 0 ? -nice(-minV).max : 0, span = max - lo
  const yOf = (v: number) => py + ph - ((v - lo) / span) * ph
  for (let v = lo; v <= max + step / 2; v += step) {
    ops.push({ t: 'line', x1: px, y1: yOf(v), x2: px + pw, y2: yOf(v), color: mix(th.muted, th.surface, 0.8), width: v === 0 ? 1.5 : 0.75 })
    txt(num(v), box.x, yOf(v) - 0.15, left - 0.15, 0.3, 11, th.muted, { align: 'right', valign: 'middle' })
  }
  const n = labels.length, gw = pw / n
  labels.forEach((l, i) => txt(l, px + i * gw, py + ph + 0.1, gw, 0.45, fit(l, gw - 0.05, 0.45, 13, 8), th.muted, { align: 'center', valign: 'top' }))
  if (c.type === 'bar') {
    const bw = Math.min(0.9, (gw * 0.72) / series.length)
    series.forEach((se, k) => se.values.forEach((v, i) => {
      const x = px + i * gw + (gw - bw * series.length) / 2 + k * bw, y0 = yOf(Math.max(v, 0)), h = Math.max(0.03, Math.abs(yOf(v) - yOf(0)))
      ops.push({ t: 'rect', x: x + 0.02, y: y0, w: bw - 0.04, h, fill: colors[k], radius: Math.min(0.06, bw / 4) })
      if (series.length === 1 && n <= 8) txt(num(v), x - 0.2, y0 - 0.34, bw + 0.4, 0.3, 12, th.text, { bold: true, align: 'center', valign: 'middle' })
    }))
  } else {
    series.forEach((se, k) => {
      const pts = se.values.map((v, i) => ({ x: px + (i + 0.5) * gw, y: yOf(v) }))
      pts.slice(1).forEach((p, i) => ops.push({ t: 'line', x1: pts[i].x, y1: pts[i].y, x2: p.x, y2: p.y, color: colors[k], width: 3.5 }))
      pts.forEach((p) => { ops.push({ t: 'ellipse', x: p.x - 0.12, y: p.y - 0.12, w: 0.24, h: 0.24, fill: th.surface }); ops.push({ t: 'ellipse', x: p.x - 0.08, y: p.y - 0.08, w: 0.16, h: 0.16, fill: colors[k] }) })
    })
  }
  if (legend) {
    let lx = box.x + left
    series.forEach((se, k) => {
      const w = se.name.length * 0.1 + 0.55
      ops.push({ t: 'ellipse', x: lx, y: box.y + box.h - 0.38, w: 0.18, h: 0.18, fill: colors[k] })
      txt(se.name, lx + 0.28, box.y + box.h - 0.5, w, 0.42, 12, th.muted, { valign: 'middle' })
      lx += w + 0.35
    })
  }
  return ops
}

export function layoutSlide(s: Slide, th: Theme, ctx: { n: number; total: number; deck: string; font: keyof typeof FONTS }): SlideOps {
  const f = FONTS[ctx.font] ?? FONTS.modern
  // wide letterforms (serif, Arial) need more room per character than the Calibri the estimate is based on
  const wf = ctx.font === 'serif' ? 1.2 : ctx.font === 'classic' ? 1.1 : 1
  const fitS = (t: string, w: number, h: number, max: number, min: number, bold = false, sp = 1.22) => fit(t, w / wf, h, max, min, bold, sp)
  const fit1S = (t: string, w: number, max: number, min: number, bold = false) => fit1(t, w / wf, max, min, bold)
  const ops: Op[] = []
  const rect = (x: number, y: number, w: number, h: number, fill: string, o: Partial<Extract<Op, { t: 'rect' }>> = {}) => ops.push({ t: 'rect', x, y, w, h, fill, ...o })
  const dot = (x: number, y: number, d: number, fill: string, alpha?: number) => ops.push({ t: 'ellipse', x, y, w: d, h: d, fill, alpha })
  const text = (t: string, x: number, y: number, w: number, h: number, size: number, color: string, o: Partial<Extract<Op, { t: 'text' }>> = {}) => ops.push({ t: 'text', x, y, w, h, text: t, size, color, font: o.bold ? f.heading : f.body, ...o })
  const heading = (t: string, x: number, y: number, w: number, h: number, max: number, min: number, color: string, o: Partial<Extract<Op, { t: 'text' }>> = {}) => text(t, x, y, w, h, fitS(t, w, h, max, min, true, 1.15), color, { bold: true, font: f.heading, spacing: 1.05, valign: 'middle', ...o })
  const title = clean(s.title, 120)

  const chrome = () => {
    dot(10.9, -2.0, 4.6, th.accent, 0.07)
    dot(12.3, 5.8, 2.4, th.accent2, 0.08)
    rect(M, 0.62, 0.62, 0.08, th.accent, { radius: 0.04 })
    if (title) heading(title, M, 0.8, CW - 1.0, 0.95, 34, 22, th.text, { valign: 'top' })
    text(clean(ctx.deck, 60), M, 7.02, 7, 0.3, 10, th.muted, { valign: 'middle' })
    text(`${ctx.n} / ${ctx.total}`, SLIDE_W - M - 1.2, 7.02, 1.2, 0.3, 10, th.muted, { align: 'right', valign: 'middle' })
  }
  const done = (bg: string): SlideOps => ({ bg, ops, notes: s.notes ? String(s.notes).slice(0, 2000) : undefined })
  const bulletRows = (items: string[], x: number, y: number, w: number, h: number, size = 20) => {
    const n = items.length, gap = 0.16
    const rowH = Math.min(n <= 3 ? 1.5 : n === 4 ? 1.2 : 1.0, (h - gap * (n - 1)) / n)
    items.forEach((it, i) => {
      const yy = y + i * (rowH + gap)
      rect(x, yy, w, rowH, th.surface, { radius: 0.14 })
      rect(x, yy, 0.09, rowH, i % 2 ? th.accent2 : th.accent, { radius: 0.045 })
      text(it, x + 0.4, yy + 0.08, w - 0.7, rowH - 0.16, fitS(it, w - 0.7, rowH - 0.16, rowH > 1.1 ? size + 4 : size, 13), th.text, { valign: 'middle' })
    })
  }

  switch (s.layout) {
    case 'title': {
      rect(8.35, 0.8, 4.3, 5.9, th.accent, { radius: 0.55 })
      dot(7.5, 4.5, 2.9, th.accent2, 0.9)
      dot(10.9, 0.35, 1.7, th.bgAlt, 0.85)
      dot(11.2, 5.1, 1.2, th.onAccent, 0.18)
      rect(8.9, 2.1, 2.6, 0.12, th.onAccent, { radius: 0.06, alpha: 0.35 })
      rect(8.9, 2.45, 1.8, 0.12, th.onAccent, { radius: 0.06, alpha: 0.2 })
      const tag = clean(s.tag, 50)
      if (tag) { const tw = Math.min(5, tag.length * 0.115 + 0.7); rect(0.9, 1.45, tw, 0.46, th.accent, { radius: 0.23, alpha: 0.18 }); text(tag, 0.9, 1.45, tw, 0.46, 14, th.accent, { bold: true, align: 'center', valign: 'middle' }) }
      heading(title || ctx.deck, 0.9, 2.15, 6.8, 2.3, 54, 32, th.text)
      const sub = clean(s.subtitle, 200)
      if (sub) text(sub, 0.9, 4.65, 6.6, 1.2, fitS(sub, 6.6, 1.2, 22, 14), th.muted, { valign: 'top' })
      return done(th.bg)
    }
    case 'section': {
      dot(8.2, -1.6, 7.6, th.onAccent, 0.07)
      dot(10.4, 3.6, 4.4, th.onAccent, 0.09)
      text(clean(s.number, 4) || String(ctx.n).padStart(2, '0'), 0.9, 0.9, 8, 2.6, 150, mix(th.accent, th.onAccent, 0.3), { bold: true, font: f.heading, valign: 'middle', spacing: 1 })
      heading(title, 0.9, 3.9, 9.2, 1.7, 50, 30, th.onAccent, { valign: 'top' })
      const sub = clean(s.subtitle, 200)
      if (sub) text(sub, 0.9, 5.75, 8.5, 0.9, fitS(sub, 8.5, 0.9, 22, 14), mix(th.onAccent, th.accent, 0.25), { valign: 'top' })
      return done(th.accent)
    }
    case 'bullets': {
      chrome()
      const items = list<string>(s.bullets, 6).map((b) => clean(b, 160)).filter(Boolean)
      const side = s.side && (s.side.stat || s.side.label)
      bulletRows(items, M, TOP, side ? 7.7 : CW, BOT - TOP, 22)
      if (side) {
        rect(8.7, TOP, 3.93, BOT - TOP, th.accent, { radius: 0.22 })
        dot(10.3, TOP - 0.7, 2.6, th.onAccent, 0.1)
        dot(8.4, BOT - 1.3, 1.8, th.onAccent, 0.1)
        const stat = clean(s.side?.stat, 14)
        text(stat, 8.95, TOP + 0.9, 3.43, 1.6, fit1S(stat, 3.43, 66, 28, true), th.onAccent, { bold: true, font: f.heading, align: 'center', valign: 'middle', spacing: 1 })
        const lab = clean(s.side?.label, 90)
        if (lab) text(lab, 9.05, TOP + 2.6, 3.23, 1.5, fitS(lab, 3.23, 1.5, 18, 12), th.onAccent, { align: 'center', valign: 'top' })
      }
      return done(th.bg)
    }
    case 'cards': {
      chrome()
      const cards = list<NonNullable<Slide['cards']>[number]>(s.cards, 6)
      const n = Math.max(1, cards.length), cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 0.3
      const cw = (CW - gap * (cols - 1)) / cols, ch = (BOT - TOP - gap * (rows - 1)) / rows
      cards.forEach((c, i) => {
        const x = M + (i % cols) * (cw + gap), y = TOP + Math.floor(i / cols) * (ch + gap)
        const col = i % 2 ? th.accent2 : th.accent
        rect(x, y, cw, ch, th.surface, { radius: 0.2 })
        dot(x + 0.3, y + 0.3, 0.72, col)
        const ic = clean(c.icon, 4) || String(i + 1)
        text(ic, x + 0.3, y + 0.3, 0.72, 0.72, 22, th.onAccent, { bold: true, align: 'center', valign: 'middle', spacing: 1 })
        const ct = clean(c.title, 60)
        heading(ct, x + 0.3, y + 1.15, cw - 0.6, 0.62, 22, 15, th.text, { valign: 'top' })
        const body = clean(c.text, 220)
        if (body) text(body, x + 0.3, y + 1.8, cw - 0.6, ch - 2.0, fitS(body, cw - 0.6, ch - 2.0, 16, 11), th.muted, { valign: 'top' })
      })
      return done(th.bg)
    }
    case 'stats': {
      chrome()
      const st = list<NonNullable<Slide['stats']>[number]>(s.stats, 4)
      const hasNotes = st.some((x) => clean(x.note, 5))
      const n = Math.max(1, st.length), gap = 0.35, cw = (CW - gap * (n - 1)) / n, ch = hasNotes ? (s.summary ? 3.5 : 4.1) : 3.3, y = s.summary ? 2.2 : 2.3 + (4.1 - ch) / 2
      st.forEach((it, i) => {
        const x = M + i * (cw + gap), col = i % 2 ? th.accent2 : th.accent
        rect(x, y, cw, ch, th.surface, { radius: 0.2 })
        rect(x, y, cw, 0.14, col, { radius: 0.07 })
        const v = clean(it.value, 12)
        text(v, x + 0.2, y + 0.45, cw - 0.4, 1.5, fit1S(v, cw - 0.4, 62, 26, true), col, { bold: true, font: f.heading, align: 'center', valign: 'middle', spacing: 1 })
        const lab = clean(it.label, 60)
        text(lab, x + 0.25, y + 2.1, cw - 0.5, 0.8, fitS(lab, cw - 0.5, 0.8, 20, 13, true), th.text, { bold: true, align: 'center', valign: 'top' })
        const note = clean(it.note, 120)
        if (note) text(note, x + 0.25, y + 2.95, cw - 0.5, ch - 3.1, fitS(note, cw - 0.5, ch - 3.1, 14, 10), th.muted, { align: 'center', valign: 'top' })
      })
      const sum = clean(s.summary, 200)
      if (sum) { rect(M, 6.0, CW, 0.75, th.accent, { radius: 0.18, alpha: 0.14 }); text(sum, M + 0.3, 6.0, CW - 0.6, 0.75, fitS(sum, CW - 0.6, 0.75, 18, 12), th.text, { bold: true, valign: 'middle', align: 'center' }) }
      return done(th.bg)
    }
    case 'compare': {
      chrome()
      const sides = [s.left, s.right]
      sides.forEach((sd, i) => {
        if (!sd) return
        const x = M + i * (CW / 2 + 0.15), w = CW / 2 - 0.15, col = i ? th.accent2 : th.accent
        rect(x, TOP, w, BOT - TOP, th.surface, { radius: 0.22 })
        rect(x, TOP, w, 0.14, col, { radius: 0.07 })
        const hd = clean(sd.heading, 40)
        const cwid = Math.min(w - 0.6, hd.length * 0.17 + 0.8)
        rect(x + 0.35, TOP + 0.45, cwid, 0.52, col, { radius: 0.26 })
        text(hd, x + 0.35, TOP + 0.45, cwid, 0.52, 17, th.onAccent, { bold: true, align: 'center', valign: 'middle' })
        const pts = list<string>(sd.points, 5).map((p) => clean(p, 110)).filter(Boolean)
        const top = TOP + 1.3, avail = BOT - top - 0.2, rowH = Math.min(1.05, avail / Math.max(1, pts.length))
        pts.forEach((p, k) => {
          const yy = top + k * rowH
          dot(x + 0.38, yy + rowH / 2 - 0.09, 0.18, col)
          text(p, x + 0.75, yy, w - 1.1, rowH, fitS(p, w - 1.1, rowH - 0.05, 21, 13), th.text, { valign: 'middle' })
        })
      })
      return done(th.bg)
    }
    case 'steps': {
      chrome()
      const st = list<NonNullable<Slide['steps']>[number]>(s.steps, 6)
      const n = Math.max(1, st.length), cw = CW / n
      ops.push({ t: 'line', x1: M + cw / 2, y1: 3.05, x2: M + cw * (n - 0.5), y2: 3.05, color: mix(th.muted, th.bg, 0.55), width: 2.5 })
      st.forEach((it, i) => {
        const cx = M + cw * (i + 0.5), col = i % 2 ? th.accent2 : th.accent
        dot(cx - 0.48, 2.57, 0.96, th.bg)
        dot(cx - 0.42, 2.63, 0.84, col)
        text(String(i + 1), cx - 0.42, 2.63, 0.84, 0.84, 26, th.onAccent, { bold: true, align: 'center', valign: 'middle', spacing: 1 })
        const t = clean(it.title, 50)
        heading(t, cx - cw / 2 + 0.12, 3.8, cw - 0.24, 0.85, 24, 14, th.text, { align: 'center', valign: 'top' })
        const tx = clean(it.text, 160)
        if (tx) text(tx, cx - cw / 2 + 0.15, 4.75, cw - 0.3, 1.95, fitS(tx, cw - 0.3, 1.95, 18, 11), th.muted, { align: 'center', valign: 'top' })
      })
      return done(th.bg)
    }
    case 'quote': {
      dot(-1.5, 3.8, 5.5, th.onAccent, 0.07)
      dot(10.2, -1.8, 5.2, th.onAccent, 0.08)
      text('“', 0.9, 0.2, 3, 2.6, 220, mix(th.accent, th.onAccent, 0.3), { bold: true, font: 'Georgia', spacing: 1, valign: 'top' })
      const q = clean(s.quote ?? s.text, 320)
      text(q, 1.5, 1.9, 10.3, 3.5, fitS(q, 10.3, 3.5, 38, 20), th.onAccent, { italic: true, font: 'Georgia', align: 'center', valign: 'middle' })
      const au = clean(s.author, 80)
      if (au) text('— ' + au, 1.5, 5.75, 10.3, 0.6, 20, mix(th.onAccent, th.accent, 0.25), { bold: true, align: 'center', valign: 'middle' })
      return done(th.accent)
    }
    case 'image': {
      chrome()
      const left = s.imageSide === 'left'
      const ix = left ? M : SLIDE_W - M - 5.7, tx = left ? M + 6.1 : M, tw = CW - 6.1
      rect(ix + (left ? -0.12 : 0.12), TOP + 0.14, 5.7, BOT - TOP, th.accent, { radius: 0.24, alpha: 0.25 })
      if (s.image?.data) ops.push({ t: 'image', x: ix, y: TOP, w: 5.7, h: BOT - TOP, data: s.image.data })
      else {
        rect(ix, TOP, 5.7, BOT - TOP, th.accent, { radius: 0.24 })
        dot(ix + 2.2, TOP - 0.8, 4, th.onAccent, 0.1)
        dot(ix - 0.8, BOT - 2.2, 3, th.onAccent, 0.1)
        text(clean(s.image?.emoji, 4) || '◆', ix, TOP, 5.7, BOT - TOP, 110, th.onAccent, { align: 'center', valign: 'middle', spacing: 1 })
      }
      const items = list<string>(s.bullets, 5).map((b) => clean(b, 140)).filter(Boolean)
      if (items.length) {
        const rowH = Math.min(0.95, (BOT - TOP) / items.length)
        items.forEach((it, i) => { const yy = TOP + 0.1 + i * rowH; dot(tx, yy + rowH / 2 - 0.1, 0.2, i % 2 ? th.accent2 : th.accent); text(it, tx + 0.45, yy, tw - 0.5, rowH - 0.05, fitS(it, tw - 0.5, rowH - 0.1, 22, 13), th.text, { valign: 'middle' }) })
      } else { const t = clean(s.text, 600); text(t, tx, TOP, tw, BOT - TOP, fitS(t, tw, BOT - TOP, 24, 14), th.text, { valign: 'middle', spacing: 1.3 }) }
      return done(th.bg)
    }
    case 'chart': {
      chrome()
      const c = s.chart
      const tk = clean(s.takeaway, 220)
      const cwid = tk ? 8.3 : CW
      rect(M, TOP, cwid, BOT - TOP, th.surface, { radius: 0.22 })
      if (c && Array.isArray(c.labels) && Array.isArray(c.series)) ops.push(...chartOps({ ...c, type: c.type ?? 'bar' }, { x: M + 0.25, y: TOP + 0.2, w: cwid - 0.5, h: BOT - TOP - 0.4 }, th, f))
      if (tk) {
        rect(9.3, TOP, SLIDE_W - M - 9.3, BOT - TOP, th.accent, { radius: 0.22 })
        dot(10.9, TOP - 0.7, 2.4, th.onAccent, 0.1)
        text('KEY TAKEAWAY', 9.65, TOP + 0.4, 2.9, 0.4, 12, mix(th.onAccent, th.accent, 0.3), { bold: true, valign: 'middle' })
        text(tk, 9.65, TOP + 0.95, 2.95, BOT - TOP - 1.3, fitS(tk, 2.95, BOT - TOP - 1.3, 24, 14, true), th.onAccent, { bold: true, valign: 'top', font: f.heading })
      }
      return done(th.bg)
    }
    case 'table': {
      chrome()
      const cols = list<string>(s.columns, 6).map((c) => clean(c, 40))
      const rows = list<string[]>(s.rows, 8).map((r) => (Array.isArray(r) ? r.slice(0, cols.length || 6).map((c) => clean(c, 80)) : []))
      const size = rows.length > 6 || cols.length > 4 ? 13 : 16
      const h = Math.min(BOT - TOP, (rows.length + 1) * (size > 14 ? 0.62 : 0.52))
      ops.push({ t: 'table', x: M, y: TOP, w: CW, h, columns: cols, rows, head: th.accent, headText: th.onAccent, zebra: th.surface, text: th.text, line: mix(th.muted, th.bg, 0.75), font: f.body, size })
      return done(th.bg)
    }
    case 'closing': {
      rect(0.0, 0.0, 0.35, SLIDE_H, th.accent)
      dot(8.4, 0.5, 5.6, th.accent, 0.12)
      dot(10.6, 3.9, 3.8, th.accent2, 0.16)
      dot(7.6, 5.3, 1.3, th.accent, 0.35)
      heading(title || 'Thank you', 1.0, 2.0, 8.0, 2.0, 66, 36, th.text)
      const sub = clean(s.subtitle, 200)
      if (sub) text(sub, 1.0, 4.15, 7.4, 1.0, fitS(sub, 7.4, 1.0, 24, 14), th.muted, { valign: 'top' })
      const ct = clean(s.contact, 120)
      if (ct) { const cw = Math.min(8, ct.length * 0.14 + 0.8); rect(1.0, 5.5, cw, 0.6, th.accent, { radius: 0.3 }); text(ct, 1.0, 5.5, cw, 0.6, 18, th.onAccent, { bold: true, align: 'center', valign: 'middle' }) }
      return done(th.bg)
    }
    default: {
      chrome()
      const t = clean(s.text ?? (s.bullets ?? []).join('\n'), 800)
      if (t) text(t, M, TOP, CW, BOT - TOP, fitS(t, CW, BOT - TOP, 24, 14), th.text, { valign: 'top' })
      return done(th.bg)
    }
  }
}

export function layoutDeck(deck: Deck): { theme: Theme; slides: SlideOps[] } {
  const theme = themeOf(deck)
  const font = (deck.font && deck.font in FONTS ? deck.font : 'modern') as keyof typeof FONTS
  const slides = (deck.slides ?? []).map((s, i, all) => layoutSlide({ ...s, layout: LAYOUTS.includes(s?.layout as any) ? s.layout : 'bullets' }, theme, { n: i + 1, total: all.length, deck: deck.title ?? '', font }))
  return { theme, slides }
}

/** Parse and tidy what the AI sent. Throws a message the AI can act on. */
export function parseDeck(raw: unknown): Deck {
  let d: any = raw
  if (typeof raw === 'string') { try { d = JSON.parse(raw) } catch { throw new Error('The presentation must be valid JSON.') } }
  if (!d || typeof d !== 'object' || !Array.isArray(d.slides) || !d.slides.length) throw new Error('Pass an object with a "slides" array containing at least one slide.')
  if (d.slides.length > 40) throw new Error('A presentation can have at most 40 slides.')
  const slides: Slide[] = d.slides.map((s: any, i: number) => {
    if (!s || typeof s !== 'object') throw new Error(`Slide ${i + 1} must be an object.`)
    if (!LAYOUTS.includes(s.layout)) throw new Error(`Slide ${i + 1}: unknown layout "${s.layout}". Use one of: ${LAYOUTS.join(', ')}.`)
    return s as Slide
  })
  return { title: clean(d.title, 100), theme: d.theme, accent: d.accent, font: d.font, slides }
}

/** Plain-language suggestions for the AI after it made a deck (so it can fix weak spots). */
export function deckAdvice(d: Deck): string[] {
  const tips: string[] = []
  const s = d.slides
  if (s.length < 5) tips.push('The deck is short; most topics need 7 to 12 slides.')
  if (s[0]?.layout !== 'title') tips.push('Start with a "title" slide.')
  if (s.length > 4 && s[s.length - 1]?.layout !== 'closing') tips.push('End with a "closing" slide.')
  let run = 1
  for (let i = 1; i < s.length; i++) { run = s[i].layout === s[i - 1].layout ? run + 1 : 1; if (run === 3) { tips.push(`Three "${s[i].layout}" slides in a row: mix in cards, stats, steps, compare, a chart or a quote.`); break } }
  const bullets = s.filter((x) => x.layout === 'bullets').length
  if (bullets > Math.max(2, s.length / 3)) tips.push('Too many bullet slides: turn some into cards, stats, steps or compare layouts.')
  s.forEach((x, i) => {
    const long = (x.bullets ?? []).filter((b) => String(b).length > 90).length
    if (long) tips.push(`Slide ${i + 1}: shorten bullets to under about 12 words each.`)
    if ((x.bullets ?? []).length > 5) tips.push(`Slide ${i + 1}: use at most 5 bullets.`)
    if (!x.notes && x.layout !== 'title' && x.layout !== 'closing' && x.layout !== 'section') { if (i === 2) tips.push('Add speaker "notes" to the slides.') }
  })
  return tips.slice(0, 6)
}

export const deckOf = (content: string): Deck | null => { try { return parseDeck(content) } catch { return null } }
