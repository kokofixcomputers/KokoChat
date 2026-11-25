/** The Rust (Tauri) desktop shell in rust-app-rewrite/. It runs the same interface as the Electron app. */
export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Call before the app starts. Does nothing outside the Tauri shell. */
export async function initTauri() {
  if (!isTauri()) return
  const { installTauriBridge } = await import('./tauriBridge')
  await installTauriBridge()
  const { applyPendingMigration } = await import('./migrate')
  await applyPendingMigration() // before the app reads its data
  const [{ fetch: nativeFetch }, { openUrl }] = await Promise.all([import('@tauri-apps/plugin-http'), import('@tauri-apps/plugin-opener')])

  // Model providers often send no CORS headers, so web requests are made by Rust. The app's own files stay with the webview.
  const webFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href)
    const remote = /^https?:$/.test(url.protocol) && url.origin !== location.origin && url.hostname !== 'ipc.localhost'
    return remote ? nativeFetch(input as any, init) : webFetch(input, init)
  }

  // the webview does not open new windows: send links to the normal browser
  const external = (u: string) => /^(https?|mailto):/i.test(u) && !u.startsWith(location.origin)
  const open = window.open.bind(window)
  window.open = ((u?: string | URL, ...rest: any[]) => {
    if (u && external(String(u))) { void openUrl(String(u)); return null }
    return open(u, ...rest)
  }) as typeof window.open
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (a && !a.download && external(a.href)) { e.preventDefault(); void openUrl(a.href) }
  }, true)
}
