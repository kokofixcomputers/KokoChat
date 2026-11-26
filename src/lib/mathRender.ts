/** KaTeX, its stylesheet and (through it) its fonts. Only loaded once a message contains maths; see Markdown.tsx. */
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { PluggableList } from 'unified'

// Anything KaTeX can't parse shows as its source in muted text (the reason is in the tooltip) instead of a red error.
export const mathPlugin: PluggableList[number] = [rehypeKatex, { strict: false, errorColor: 'var(--muted)', maxSize: 40, maxExpand: 500 }]
