import clsx, { type ClassValue } from 'clsx'
export const cn = (...a: ClassValue[]) => clsx(a)
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
export const domainOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}
export const favicon = (domain: string, size = 64) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`
export const fmtDuration = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}
export const download = (name: string, content: string, mime = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const downloadDataUrl = (name: string, dataUrl: string) => {
  const a = document.createElement('a')
  a.href = dataUrl; a.download = name; a.click()
}
export const dataUrlExt = (u: string) => (/^data:image\/(\w+)/.exec(u)?.[1] ?? 'png').replace('jpeg', 'jpg')

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`)
