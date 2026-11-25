function ({ key, modifiers }) {
  const names = { Return: 'Enter', Esc: 'Escape', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Space: ' ' }
  const k = names[key] || key
  const known = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']
  if (!known.includes(k) && String(k).length !== 1) throw new Error('Unknown key')
  const m = Array.isArray(modifiers) ? modifiers.map((x) => String(x).toLowerCase()) : []
  const el = document.activeElement || document.body
  const o = { key: k, bubbles: true, cancelable: true, composed: true, shiftKey: m.includes('shift'), ctrlKey: m.includes('control') || m.includes('ctrl'), altKey: m.includes('alt'), metaKey: m.includes('meta') || m.includes('command') || m.includes('cmd') }
  // scripted key events have no built-in effect, so do what the browser would have done, unless the page cancelled the key
  const go = el.dispatchEvent(new KeyboardEvent('keydown', o))
  if (go && !o.ctrlKey && !o.metaKey) {
    const typing = el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio', 'reset'].includes(el.type))
    const page = () => scrollBy(0, innerHeight * 0.85 * (k === 'PageUp' ? -1 : 1))
    if (k === 'Enter') {
      if (el.tagName === 'TEXTAREA' || el.isContentEditable) document.execCommand('insertLineBreak')
      else if (el.tagName === 'INPUT' && el.form) el.form.requestSubmit()
      else if (el !== document.body) el.click()
    } else if (k === 'Tab') {
      const all = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && e.offsetParent !== null)
      all[(all.indexOf(el) + (o.shiftKey ? -1 : 1) + all.length) % all.length]?.focus()
    } else if (k === 'Backspace') document.execCommand('delete')
    else if (k === 'Delete') document.execCommand('forwardDelete')
    else if (k.length === 1) { if (typing) document.execCommand('insertText', false, k); else if (k === ' ') { if (el !== document.body) el.click(); else scrollBy(0, innerHeight * 0.85) } }
    else if (k === 'PageUp' || k === 'PageDown') page()
    else if (!typing && (k === 'ArrowUp' || k === 'ArrowDown')) scrollBy(0, k === 'ArrowUp' ? -60 : 60)
    else if (!typing && (k === 'Home' || k === 'End')) scrollTo(0, k === 'Home' ? 0 : document.documentElement.scrollHeight)
  }
  el.dispatchEvent(new KeyboardEvent('keyup', o))
  return true
}
