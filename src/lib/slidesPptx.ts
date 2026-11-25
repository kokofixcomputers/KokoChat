import { layoutDeck, SLIDE_H, SLIDE_W, type Deck, type Op } from './slides'

/** Write a deck as a real .pptx (shapes, text, charts and tables stay editable in PowerPoint, Keynote and Google Slides). */
export async function buildPptx(deck: Deck, outputType: 'blob' | 'nodebuffer' = 'blob'): Promise<any> {
  const mod: any = await import('pptxgenjs')
  const PptxGenJS = mod.default ?? mod
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'KOKO', width: SLIDE_W, height: SLIDE_H })
  pptx.layout = 'KOKO'
  pptx.title = deck.title || 'Presentation'
  pptx.author = 'Koko'
  const { slides } = layoutDeck(deck)
  const tr = (alpha?: number) => (alpha == null || alpha >= 1 ? 0 : Math.round((1 - alpha) * 100))

  for (const sl of slides) {
    const s = pptx.addSlide()
    s.background = { color: sl.bg }
    for (const op of sl.ops as Op[]) draw(pptx, s, op, tr)
    if (sl.notes) s.addNotes(sl.notes)
  }
  return pptx.write({ outputType })
}

function draw(pptx: any, s: any, op: Op, tr: (a?: number) => number) {
  switch (op.t) {
    case 'rect':
      s.addShape(op.radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, { x: op.x, y: op.y, w: op.w, h: op.h, fill: { color: op.fill, transparency: tr(op.alpha) }, line: op.line ? { color: op.line, width: op.lineW ?? 1 } : { type: 'none' }, ...(op.radius ? { rectRadius: Math.min(op.radius, op.h / 2, op.w / 2) } : {}) })
      return
    case 'ellipse':
      s.addShape(pptx.ShapeType.ellipse, { x: op.x, y: op.y, w: op.w, h: op.h, fill: { color: op.fill, transparency: tr(op.alpha) }, line: { type: 'none' } })
      return
    case 'line':
      // a line shape always runs from the top-left to the bottom-right of its box; flip it when the line goes the other way
      s.addShape(pptx.ShapeType.line, { x: Math.min(op.x1, op.x2), y: Math.min(op.y1, op.y2), w: Math.abs(op.x2 - op.x1), h: Math.abs(op.y2 - op.y1), flipV: (op.x2 - op.x1) * (op.y2 - op.y1) < 0, line: { color: op.color, width: op.width, ...(op.dash ? { dashType: 'dash' } : {}) } })
      return
    case 'text':
      s.addText(op.text, { x: op.x, y: op.y, w: op.w, h: op.h, fontFace: op.font, fontSize: op.size, color: op.color, bold: !!op.bold, italic: !!op.italic, align: op.align ?? 'left', valign: op.valign ?? 'top', margin: 0, wrap: true, fit: 'none', lineSpacingMultiple: (op.spacing ?? 1.2) / 1.2 })
      return
    case 'image':
      s.addImage({ data: op.data.replace(/^data:/, ''), x: op.x, y: op.y, w: op.w, h: op.h, sizing: { type: 'cover', w: op.w, h: op.h } })
      return
    case 'wedge': {
      const span = op.a1 - op.a0
      if (span >= 359.9) { s.addShape(pptx.ShapeType.ellipse, { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2, fill: { color: op.fill }, line: { type: 'none' } }); return }
      const norm = (a: number) => ((a % 360) + 360) % 360
      s.addShape(pptx.ShapeType.pie, { x: op.cx - op.r, y: op.cy - op.r, w: op.r * 2, h: op.r * 2, angleRange: [norm(op.a0), norm(op.a1)], fill: { color: op.fill }, line: { color: op.fill, width: 0.5 } })
      return
    }
    case 'table': {
      const cell = (t: string, o: Record<string, unknown>) => ({ text: t, options: { fontFace: op.font, fontSize: op.size, valign: 'middle', margin: [0.06, 0.14, 0.06, 0.14], ...o } })
      const rows = [op.columns.map((c) => cell(c, { bold: true, color: op.headText, fill: { color: op.head } })), ...op.rows.map((r, i) => op.columns.map((_, j) => cell(r[j] ?? '', { color: op.text, fill: { color: i % 2 ? 'FFFFFF' : op.zebra, transparency: i % 2 ? 100 : 0 } })))]
      s.addTable(rows, { x: op.x, y: op.y, w: op.w, colW: op.columns.map(() => op.w / op.columns.length), rowH: op.h / rows.length, border: { type: 'solid', pt: 0.75, color: op.line } })
      return
    }
  }
}
