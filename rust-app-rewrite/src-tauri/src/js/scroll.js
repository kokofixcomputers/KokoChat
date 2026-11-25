function ({ x = 200, y = 200, dx = 0, dy = 0 }) {
  let el = document.elementFromPoint(x, y)
  while (el && el !== document.body && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) { el.scrollBy(dx, dy); return true }
    el = el.parentElement
  }
  window.scrollBy(dx, dy)
  return true
}
