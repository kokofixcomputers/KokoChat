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

export default defineConfig({ plugins: [katexWoff2Only, react(), tailwindcss()] })
