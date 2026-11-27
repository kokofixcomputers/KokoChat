import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// KaTeX lists each font as woff2, woff and ttf. Everything we run in reads woff2, so don't ship the other two.
const katexWoff2Only: Plugin = {
  name: 'katex-woff2-only',
  enforce: 'pre',
  transform(code, id) {
    if (/katex(\.min)?\.css/.test(id)) return code.replace(/,url\([^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, '')
  },
}

/**
 * The sync worker's published-chart pages load `viewer/viewer.js`: a fixed address that pulls in this build's hashed
 * files. The viewer is built alongside the app, so the two share their rendering chunks and can't drift apart.
 */
const viewerLoader: Plugin = {
  name: 'viewer-loader',
  generateBundle(_, bundle) {
    const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry && c.name === 'viewer')
    if (entry?.type !== 'chunk') return this.error('viewer entry missing from the build')
    const css = new Set<string>(), seen = new Set<string>()
    const walk = (file: string) => {
      const c = bundle[file]
      if (seen.has(file) || c?.type !== 'chunk') return
      seen.add(file)
      c.viteMetadata?.importedCss.forEach((f) => css.add(f))
      c.imports.forEach(walk)
    }
    walk(entry.fileName)
    this.emitFile({
      type: 'asset', fileName: 'viewer/viewer.js',
      source: `for (const f of ${JSON.stringify([...css])}) {\n  const l = document.createElement('link'); l.rel = 'stylesheet'; l.crossOrigin = ''; l.href = new URL('../' + f, import.meta.url); document.head.append(l)\n}\nimport(new URL('../${entry.fileName}', import.meta.url))\n`,
    })
  },
}

export default defineConfig({
  plugins: [katexWoff2Only, react(), tailwindcss(), viewerLoader],
  // lazy chunks must resolve next to the script that asks for them: the viewer's page is on the worker's address
  experimental: { renderBuiltUrl: (_, { hostType }) => (hostType === 'js' ? { relative: true } : undefined) },
  build: { rollupOptions: { input: { main: 'index.html', viewer: 'src/viewer.tsx' } } },
})
