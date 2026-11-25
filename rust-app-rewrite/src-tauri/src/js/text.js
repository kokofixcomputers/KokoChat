function ({ text }) {
  let el = document.activeElement
  for (;;) {
    let inner = el?.shadowRoot?.activeElement
    if (!inner && el?.tagName === 'IFRAME') { try { inner = el.contentDocument?.activeElement } catch { /* another site */ } }
    if (!inner) break
    el = inner
  }
  const doc = el?.ownerDocument
  if (!el || el === doc.body) return false
  if (doc.execCommand('insertText', false, String(text))) return true
  // fields that execCommand does not handle (number, email): set the value the way frameworks notice
  const win = doc.defaultView
  const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(text))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}
