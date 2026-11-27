/**
 * The "who made this" button on a published page opened in a browser.
 *
 * It shares the page with content we know nothing about, so it stays out of the way: no globals, its own custom element
 * with a closed shadow root (neither side's CSS reaches the other), styles set through the CSSOM so a page's own
 * `style-src` policy does not strip them, and it takes no space in the layout. The script removes its own tag.
 * This is a courtesy label, not a guarantee: a published page's own scripts can hide it.
 */

/** Enough of an email to recognise who it is, without publishing an address anyone can harvest. */
export function maskEmail(email: string | null | undefined) {
  const [name, domain] = String(email ?? '').split('@')
  if (!name || !domain) return 'an unknown user'
  return `${name.slice(0, Math.min(3, Math.max(1, name.length - 2)))}•••@${domain}`
}

// Runs in the published page. Written as a string so the bundler cannot rewrite it into something that needs helpers.
const CLIENT = `function (info) {
  var doc = document, root = doc.documentElement
  if (!root || !root.attachShadow || !doc.createElementNS) return
  var host = doc.createElement('koko-badge')
  var shadow = host.attachShadow({ mode: 'closed' })
  var css = ':host{all:initial!important;position:fixed!important;left:calc(14px + env(safe-area-inset-left,0px))!important;bottom:calc(14px + env(safe-area-inset-bottom,0px))!important;width:0!important;height:0!important;z-index:2147483647!important;display:block!important;color-scheme:light dark}'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + '.w{--s:#fff;--l:rgba(15,17,20,.09);--f:#0d0d0f;--m:#5f6368;--a:#10a37f;--h:0 1px 2px rgba(0,0,0,.06),0 8px 24px -8px rgba(0,0,0,.24);font:400 13px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:normal;text-align:left;direction:ltr}'
    + '@media (prefers-color-scheme:dark){.w{--s:#17171a;--l:rgba(255,255,255,.12);--f:#f4f4f5;--m:#a1a1aa;--a:#19c37d;--h:0 1px 2px rgba(0,0,0,.4),0 8px 24px -8px rgba(0,0,0,.7)}}'
    + 'button{position:absolute;left:0;bottom:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--l);background:var(--s);box-shadow:var(--h);cursor:pointer;display:grid;place-items:center;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:transform .15s}'
    + 'button:hover{transform:scale(1.06)}button:focus-visible{outline:2px solid var(--a);outline-offset:2px}'
    + 'svg{display:block}'
    + '.p{position:absolute;left:0;bottom:46px;width:min(280px,calc(100vw - 28px));max-height:calc(100vh - 74px);overflow:auto;background:var(--s);color:var(--f);border:1px solid var(--l);border-radius:16px;box-shadow:var(--h);padding:14px}'
    + '.p[hidden]{display:none}'
    + '.t{font-weight:600;font-size:14px}'
    + '.b{color:var(--m);margin-top:6px}'
    + '.by{margin-top:10px;padding-top:10px;border-top:1px solid var(--l);color:var(--m);overflow-wrap:anywhere}'
    + '.by b{color:var(--f);font-weight:500}'
    + '@media print{.w{display:none}}'
    + '@media (prefers-reduced-motion:reduce){button{transition:none}}'
  var styled = false
  try {
    var sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    shadow.adoptedStyleSheets = [sheet]
    styled = true
  } catch (e) {}
  if (!styled) {
    var style = doc.createElement('style')
    style.textContent = css
    shadow.appendChild(style)
  }
  function el(tag, cls, text) {
    var n = doc.createElement(tag)
    if (cls) n.className = cls
    if (text) n.textContent = text
    return n
  }
  function svg(tag, attrs) {
    var n = doc.createElementNS('http://www.w3.org/2000/svg', tag)
    for (var k in attrs) n.setAttribute(k, attrs[k])
    return n
  }
  var wrap = el('div', 'w')
  var button = el('button')
  button.type = 'button'
  button.setAttribute('aria-label', 'About this page')
  button.setAttribute('aria-expanded', 'false')
  var icon = svg('svg', { viewBox: '0 0 32 32', width: '24', height: '24', 'aria-hidden': 'true' })
  icon.appendChild(svg('rect', { width: '32', height: '32', rx: '16', fill: '#10a37f' }))
  icon.appendChild(svg('path', { d: 'M9 11a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-3l-4 4v-4a4 4 0 0 1-3-4z', fill: '#fff' }))
  button.appendChild(icon)
  var panel = el('div', 'p')
  panel.hidden = true
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', 'About this page')
  panel.appendChild(el('div', 't', 'Koko Chat'))
  panel.appendChild(el('div', 'b', 'This is user-generated content, often made with AI. Koko Chat did not write or review it and does not endorse it. Be careful about entering passwords or personal details.'))
  var by = el('div', 'by', 'Published by ')
  by.appendChild(el('b', '', info.by))
  panel.appendChild(by)
  wrap.appendChild(panel)
  wrap.appendChild(button)
  shadow.appendChild(wrap)
  function show(open) {
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }
  // events stop here so the page's own click and key handlers (games, slideshows) don't also react to the badge
  var kinds = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'wheel', 'keydown', 'keyup']
  kinds.forEach(function (k) {
    host.addEventListener(k, function (e) {
      if (k === 'keydown' && e.key === 'Escape') show(false)
      e.stopPropagation()
    }, { passive: true })
  })
  button.addEventListener('click', function () { show(panel.hidden) })
  window.addEventListener('pointerdown', function (e) { if (e.target !== host) show(false) }, true)
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') show(false) }, true)
  // outside <body>, so a page that rewrites or transforms its body leaves it alone
  function mount() { if (!host.isConnected && doc.documentElement) doc.documentElement.appendChild(host) }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount)
  else mount()
  window.addEventListener('load', mount)
}`

export function badgeScript(publisher: string, nonce?: string) {
  // `<` is escaped so the name can never close the script element
  const info = JSON.stringify({ by: publisher }).replace(/</g, '\\u003c')
  return `<script${nonce ? ` nonce="${nonce}"` : ''}>;(${CLIENT})(${info});document.currentScript&&document.currentScript.remove()</script>`
}

/**
 * Adds the badge to a published HTML page without touching anything else in it. It goes right after the doctype (which
 * must stay first, or the browser switches to quirks mode): at the end, an unclosed tag or comment could swallow it.
 */
export function addBadge(html: string, script: string) {
  const lead = /^(?:﻿|\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html)?.[0] ?? ''
  return lead + script + html.slice(lead.length)
}
