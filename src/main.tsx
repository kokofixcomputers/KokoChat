import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import 'katex/dist/katex.min.css'
import { initTauri, initTauriQuick } from './lib/tauri'

const root = () => createRoot(document.getElementById('root')!)
const q = new URLSearchParams(location.search)

// The floating quick-ask window and the screenshot overlay are separate, tiny pages: they must not load the app's store
// (two windows saving the same data would overwrite each other).
if (q.has('quick')) initTauriQuick().catch((e) => console.error(e)).then(() => import('./components/QuickAsk')).then((m) => root().render(<m.QuickAsk />))
else if (q.has('select')) import('./components/SelectOverlay').then((m) => root().render(<m.SelectOverlay />))
else if (location.pathname.startsWith('/oauth/1min')) import('./components/OneMinCallback').then((m) => root().render(<m.OneMinCallback />))
else if (location.pathname.startsWith('/oauth/callback')) import('./lib/mcpAuth').then((m) => m.handleCallback())
else if (/^\/s\/[\w-]+/.test(location.pathname)) import('./components/SharedPage').then((m) => root().render(<StrictMode><m.SharedPage /></StrictMode>))
else {
  initTauri().catch((e) => console.error(e)).then(() => import('./App')).then((m) => {
    root().render(<StrictMode><m.default /></StrictMode>)
    // tell the desktop shell how many agents are running so it can warn before closing
    const koko = (window as any).koko
    if (koko?.setBusy) import('./store').then((s) => {
      let last = -1
      const report = () => { const n = Object.keys(s.useStore.getState().streaming).length; if (n !== last) { last = n; koko.setBusy(n) } }
      s.useStore.subscribe(report); report()
    })
    if (import.meta.env.DEV) import('./store').then((s) => ((window as any).__store = s.useStore))
    if (import.meta.env.DEV) import('./lib/pluginHost').then((s) => ((window as any).__pluginUI = s.usePluginUI))
  })
}
