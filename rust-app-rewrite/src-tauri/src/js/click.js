function ({ x, y, double }) {
  let el = document.elementFromPoint(x, y)
  // look inside web components and same-site frames for what is really under the point
  for (;;) {
    let inner = el?.shadowRoot?.elementFromPoint(x, y)
    if (el?.tagName === 'IFRAME') {
      let doc = null
      try { doc = el.contentDocument } catch { /* another site */ }
      if (doc) { const r = el.getBoundingClientRect(); x -= r.left + el.clientLeft; y -= r.top + el.clientTop; inner = doc.elementFromPoint(x, y) }
    }
    if (!inner || inner === el) break
    el = inner
  }
  if (!el) return false
  const o = { bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView, clientX: x, clientY: y, button: 0 }
  const fire = (type, extra) => el.dispatchEvent(new (el.ownerDocument.defaultView[type.startsWith('pointer') ? 'PointerEvent' : 'MouseEvent'])(type, { ...o, ...extra }))
  for (let n = 1; n <= (double ? 2 : 1); n++) {
    fire('pointerover'); fire('mouseover'); fire('mousemove')
    fire('pointerdown', { detail: n, buttons: 1 })
    const go = fire('mousedown', { detail: n, buttons: 1 })
    if (go) { const f = el.closest('input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable=true]'); if (f) f.focus(); else el.ownerDocument.activeElement?.blur?.() }
    fire('pointerup', { detail: n })
    fire('mouseup', { detail: n })
    fire('click', { detail: n })
  }
  if (double) fire('dblclick', { detail: 2 })
  return true
}
