function ({ text }) {
  const el = document.activeElement
  if (!el || el === document.body) return false
  if (document.execCommand('insertText', false, String(text))) return true
  // fields that execCommand does not handle (number, email): set the value the way frameworks notice
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(text))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
}
