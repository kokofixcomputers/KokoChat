import * as dagre from '@dagrejs/dagre'

/* ------------------------------- spec ------------------------------- */
export type ShapeName = 'rect' | 'rounded' | 'pill' | 'diamond' | 'ellipse' | 'circle' | 'hexagon' | 'cylinder' | 'parallelogram' | 'note'
export type ColorName = 'green' | 'blue' | 'amber' | 'red' | 'purple' | 'teal' | 'pink' | 'gray'

export interface LNode { id: string; x: number; y: number; w: number; h: number; shape: ShapeName; color?: string; lines: string[]; size: number; filled: boolean }
export interface LEdge { points: [number, number][]; label?: string; lx?: number; ly?: number; dash?: 'dashed' | 'dotted'; arrowEnd: boolean; arrowStart: boolean; color?: string }
export interface LGroup { x: number; y: number; w: number; h: number; label?: string; color?: string }
export interface LText { x: number; y: number; lines: string[]; size: number; color?: string; anchor: 'start' | 'middle' }
export interface Laid { width: number; height: number; minX: number; minY: number; nodes: LNode[]; edges: LEdge[]; groups: LGroup[]; texts: LText[] }

const SHAPES: ShapeName[] = ['rect', 'rounded', 'pill', 'diamond', 'ellipse', 'circle', 'hexagon', 'cylinder', 'parallelogram', 'note']
const FONT = 14
const CHAR_W = 7.6
const LINE_H = 18

export function parseSpec(content: string): any {
  const t = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const j = JSON.parse(t)
  if (!j || typeof j !== 'object') throw new Error('Diagram must be a JSON object')
  return j
}

export function wrap(label: string, max = 24): string[] {
  const out: string[] = []
  for (const para of String(label ?? '').split(/\n|\\n/)) {
    let cur = ''
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w } else cur = cur ? cur + ' ' + w : w
    }
    out.push(cur)
  }
  return out.length ? out : ['']
}

function sizeFor(shape: ShapeName, lines: string[], size = FONT) {
  const tw = Math.max(...lines.map((l) => l.length)) * CHAR_W * (size / FONT)
  const th = lines.length * LINE_H * (size / FONT)
  let w = Math.max(84, tw + 36)
  let h = Math.max(44, th + 24)
  switch (shape) {
    case 'diamond': w = Math.max(110, w * 1.5); h = Math.max(70, h * 1.7); break
    case 'ellipse': w = Math.max(100, w * 1.25); h = Math.max(54, h * 1.3); break
    case 'circle': w = h = Math.max(w, h) * 1.15; break
    case 'hexagon': case 'parallelogram': w += 32; break
    case 'cylinder': h += 18; break
    case 'pill': w += 12; break
  }
  return { w: Math.round(w), h: Math.round(h) }
}

const asShape = (s: any): ShapeName => (SHAPES.includes(s) ? s : 'rounded')

/** Point on a node's border along the ray from its centre towards (tx, ty). */
function clip(n: { x: number; y: number; w: number; h: number; shape?: string }, tx: number, ty: number): [number, number] {
  const dx = tx - n.x, dy = ty - n.y
  if (!dx && !dy) return [n.x, n.y]
  const a = n.w / 2, b = n.h / 2
  let k: number
  if (n.shape === 'ellipse' || n.shape === 'circle') k = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
  else if (n.shape === 'diamond') k = 1 / (Math.abs(dx) / a + Math.abs(dy) / b)
  else k = Math.min(a / Math.abs(dx || 1e-9), b / Math.abs(dy || 1e-9))
  return [n.x + dx * k, n.y + dy * k]
}

const arrowFlags = (a: any): { end: boolean; start: boolean } => ({ end: a !== 'none' && a !== 'start', start: a === 'both' || a === 'start' })

/* ------------------------------ layout ------------------------------ */
export function layoutDiagram(spec: any): Laid {
  const laid: Laid = { width: 0, height: 0, minX: 0, minY: 0, nodes: [], edges: [], groups: [], texts: [] }
  if (spec.type === 'canvas' || Array.isArray(spec.elements)) layoutCanvas(spec, laid)
  else layoutGraph(spec, laid)
  // bounds
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  for (const n of laid.nodes) { grow(n.x - n.w / 2, n.y - n.h / 2); grow(n.x + n.w / 2, n.y + n.h / 2) }
  for (const g of laid.groups) { grow(g.x, g.y); grow(g.x + g.w, g.y + g.h) }
  for (const e of laid.edges) { e.points.forEach(([x, y]) => grow(x, y)); if (e.label && e.lx != null) { const w = e.label.length * 6.8 / 2 + 10; grow(e.lx - w, e.ly! - 12); grow(e.lx + w, e.ly! + 12) } }
  for (const t of laid.texts) { const w = Math.max(...t.lines.map((l) => l.length)) * CHAR_W * (t.size / FONT); const left = t.anchor === 'middle' ? t.x - w / 2 : t.x; grow(left, t.y - t.size); grow(left + w, t.y + t.lines.length * t.size * 1.3) }
  if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 100 }
  const pad = 28
  laid.minX = x0 - pad; laid.minY = y0 - pad
  laid.width = x1 - x0 + pad * 2; laid.height = y1 - y0 + pad * 2
  return laid
}

function layoutGraph(spec: any, laid: Laid) {
  const rawNodes: any[] = Array.isArray(spec.nodes) ? spec.nodes : []
  if (!rawNodes.length) throw new Error('Diagram has no nodes')
  const dir = String(spec.direction ?? 'TB').toUpperCase()
  const g = new dagre.graphlib.Graph({ compound: true, multigraph: true })
  g.setGraph({ rankdir: ['LR', 'RL', 'BT'].includes(dir) ? dir : 'TB', nodesep: 44, ranksep: 62, edgesep: 20, marginx: 10, marginy: 10 })
  g.setDefaultEdgeLabel(() => ({}))

  const groups: any[] = Array.isArray(spec.groups) ? spec.groups : []
  const groupIds = new Set(groups.map((x) => String(x.id)))
  for (const gr of groups) g.setNode(String(gr.id), {})
  const meta = new Map<string, { shape: ShapeName; lines: string[]; color?: string }>()
  for (const n of rawNodes) {
    const id = String(n.id ?? n.label)
    const shape = asShape(n.shape)
    const lines = wrap(n.label ?? id)
    const { w, h } = sizeFor(shape, lines)
    g.setNode(id, { width: w, height: h })
    meta.set(id, { shape, lines, color: n.color })
    if (n.group != null && groupIds.has(String(n.group))) g.setParent(id, String(n.group))
  }
  const edges: any[] = (Array.isArray(spec.edges) ? spec.edges : []).filter((e: any) => e && meta.has(String(e.from)) && meta.has(String(e.to)) && String(e.from) !== String(e.to))
  edges.forEach((e, i) => {
    const lw = e.label ? String(e.label).length * 7 + 14 : 0
    g.setEdge(String(e.from), String(e.to), lw ? { width: lw, height: 22, labelpos: 'c' } : {}, String(i))
  })
  dagre.layout(g)

  for (const gr of groups) {
    const n = g.node(String(gr.id))
    if (n && n.width) laid.groups.push({ x: n.x - n.width / 2, y: n.y - n.height / 2, w: n.width, h: n.height, label: gr.label, color: gr.color })
  }
  for (const [id, m] of meta) {
    const n = g.node(id)
    laid.nodes.push({ id, x: n.x, y: n.y, w: n.width, h: n.height, shape: m.shape, color: m.color, lines: m.lines, size: FONT, filled: true })
  }
  edges.forEach((e, i) => {
    const d = g.edge(String(e.from), String(e.to), String(i))
    if (!d?.points) return
    const f = arrowFlags(e.arrow)
    laid.edges.push({ points: d.points.map((p: any) => [p.x, p.y] as [number, number]), label: e.label, lx: d.x, ly: d.y, dash: e.style === 'dashed' || e.style === 'dotted' ? e.style : undefined, arrowEnd: f.end, arrowStart: f.start, color: e.color })
  })
}

function layoutCanvas(spec: any, laid: Laid) {
  const els: any[] = Array.isArray(spec.elements) ? spec.elements : []
  if (!els.length) throw new Error('Canvas has no elements')
  const byId = new Map<string, LNode>()
  // shapes first so connectors can reference them
  els.forEach((e, i) => {
    if (!['rect', 'ellipse', 'diamond', 'rounded', 'circle', 'pill', 'hexagon', 'cylinder', 'parallelogram', 'note'].includes(e.type)) return
    const shape = asShape(e.type === 'rect' ? 'rect' : e.type)
    const w = Number(e.w ?? e.width ?? 120), h = Number(e.h ?? e.height ?? 60)
    const lines = e.text ? wrap(e.text, Math.max(8, Math.floor((w - 20) / CHAR_W))) : []
    const n: LNode = { id: String(e.id ?? `e${i}`), x: Number(e.x ?? 0) + w / 2, y: Number(e.y ?? 0) + h / 2, w, h, shape, color: e.color, lines, size: Number(e.size ?? FONT), filled: e.fill !== false }
    laid.nodes.push(n)
    byId.set(n.id, n)
  })
  for (const e of els) {
    if (e.type === 'text') {
      laid.texts.push({ x: Number(e.x ?? 0), y: Number(e.y ?? 0), lines: wrap(e.text ?? '', 60), size: Number(e.size ?? FONT), color: e.color, anchor: e.align === 'middle' || e.align === 'center' ? 'middle' : 'start' })
    } else if (e.type === 'line' || e.type === 'arrow') {
      let pts: [number, number][] = (Array.isArray(e.points) ? e.points : []).map((p: any) => [Number(p[0]), Number(p[1])] as [number, number])
      const from = e.from != null ? byId.get(String(e.from)) : undefined
      const to = e.to != null ? byId.get(String(e.to)) : undefined
      if (from || to) {
        const mid = pts
        const first = from ? ([from.x, from.y] as [number, number]) : pts[0]
        const last = to ? ([to.x, to.y] as [number, number]) : pts[pts.length - 1]
        if (!first || !last) continue
        const toward1 = mid[0] ?? last
        const toward2 = mid[mid.length - 1] ?? first
        const a = from ? clip(from, toward1[0], toward1[1]) : first
        const b = to ? clip(to, toward2[0], toward2[1]) : last
        pts = [a, ...mid, b]
      }
      if (pts.length < 2) continue
      const f = arrowFlags(e.arrow ?? (e.type === 'arrow' ? 'end' : 'none'))
      const m = pts[Math.floor(pts.length / 2)], m0 = pts[Math.max(0, Math.floor(pts.length / 2) - 1)]
      laid.edges.push({ points: pts, label: e.label ?? e.text, lx: (m[0] + m0[0]) / 2, ly: (m[1] + m0[1]) / 2, dash: e.style === 'dashed' || e.style === 'dotted' ? e.style : undefined, arrowEnd: f.end, arrowStart: f.start, color: e.color })
    }
  }
}
