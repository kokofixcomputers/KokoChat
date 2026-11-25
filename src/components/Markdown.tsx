import { memo, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { useEffect } from 'react'
import { Check, Copy } from 'lucide-react'
import type { Source } from '../types'
import { Favicon } from './ui'
import { cn } from '../lib/utils'
import { toast } from '../lib/toast'

function nodeText(n: ReactNode): string {
  if (typeof n === 'string') return n
  if (Array.isArray(n)) return n.map(nodeText).join('')
  if (n && typeof n === 'object' && 'props' in (n as any)) return nodeText((n as any).props.children)
  return ''
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); toast.success('Copied to clipboard'); setOk(true); setTimeout(() => setOk(false), 1400) }}
      className={cn('flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted transition hover:bg-fg/5 hover:text-fg', className)}
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}{ok ? 'Copied' : 'Copy'}
    </button>
  )
}

function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  const [err, setErr] = useState('')
  const [src, setSrc] = useState(false)
  useEffect(() => {
    let dead = false
    const t = setTimeout(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        const dark = document.documentElement.classList.contains('dark')
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', fontFamily: 'Inter, sans-serif' })
        const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), code)
        if (!dead) { setSvg(svg); setErr('') }
      } catch (e: any) { if (!dead) setErr(String(e?.message ?? e).split('\n')[0]) }
    }, 350)
    return () => { dead = true; clearTimeout(t) }
  }, [code])
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-line bg-surface-2/70">
      <div className="flex items-center justify-between border-b border-line px-4 py-1.5">
        <span className="font-mono text-xs text-muted">mermaid</span>
        <span className="flex items-center"><button onClick={() => setSrc((s) => !s)} className="rounded-full px-2 py-1 text-xs text-muted hover:bg-fg/5 hover:text-fg">{src ? 'Diagram' : 'Source'}</button><CopyButton text={code} /></span>
      </div>
      {src || (err && !svg) ? <pre className="code"><code>{code}</code>{err && <div className="mt-2 text-danger">{err}</div>}</pre> : svg ? <div className="flex justify-center overflow-x-auto p-4 [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="p-6 text-center text-sm text-muted"><span className="shimmer">Rendering diagram…</span></div>}
    </div>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code: any = (children as any)?.props
  const lang = /language-(\w+)/.exec(code?.className ?? '')?.[1] ?? 'text'
  const text = nodeText(code?.children).replace(/\n$/, '')
  if (lang === 'mermaid') return <Mermaid code={text} />
  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-line bg-surface-2/70">
      <div className="flex items-center justify-between border-b border-line px-4 py-1.5">
        <span className="font-mono text-xs text-muted">{lang}</span>
        <CopyButton text={text} />
      </div>
      <pre className="code"><code className={code?.className}>{code?.children}</code></pre>
    </div>
  )
}

export function Cite({ n, source }: { n: number; source?: Source }) {
  if (!source) return <span className="text-muted">[{n}]</span>
  return (
    <span className="group relative mx-0.5 inline-block align-baseline">
      <a
        href={source.url} target="_blank" rel="noreferrer"
        className="inline-grid h-[18px] min-w-[18px] -translate-y-px place-items-center rounded-full bg-accent-soft px-1 text-[11px] font-semibold leading-none text-accent no-underline transition group-hover:bg-accent group-hover:text-accent-fg"
      >
        {n}
      </a>
      <span className="glass-strong pointer-events-none invisible absolute bottom-full left-1/2 z-40 mb-2 w-72 -translate-x-1/2 translate-y-1 rounded-2xl p-3 text-left opacity-0 transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
        <span className="flex items-center gap-2 text-xs text-muted"><Favicon domain={source.domain} size={14} />{source.domain}</span>
        <span className="mt-1 block text-[13px] font-medium leading-snug text-fg">{source.title}</span>
        <span className="mt-1 line-clamp-3 block text-xs leading-snug text-muted">{source.snippet}</span>
      </span>
    </span>
  )
}

/** Normalise \( \) and \[ \] LaTeX delimiters to $$ so remark-math picks them up (skips code). */
function withMath(md: string) {
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((seg, i) =>
      i % 2
        ? seg
        : seg
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => '\n$$\n' + m + '\n$$\n')
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => '$$' + m + '$$'),
    )
    .join('')
}

/** Turn [1] / [1][2] into links the renderer swaps for citation pills (skips code). */
function withCites(md: string, hasSources: boolean) {
  if (!hasSources) return md
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((seg, i) => (i % 2 ? seg : seg.replace(/\[(\d{1,3})\](?!\()/g, '[$1](#cite-$1)')))
    .join('')
}

export const Markdown = memo(function Markdown({ text, sources, small, className }: { text: string; sources?: Source[]; small?: boolean; className?: string }) {
  const src = useMemo(() => withCites(withMath(text), !!sources?.length), [text, sources])
  const components = useMemo(
    () => ({
      a: ({ href, children, ...rest }: any) => {
        const m = /^#cite-(\d+)$/.exec(href ?? '')
        if (m) { const n = +m[1]; return <Cite n={n} source={sources?.find((s) => s.n === n)} /> }
        return <a href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>
      },
      pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
      table: ({ children }: any) => <div className="my-4 overflow-x-auto rounded-xl border border-line"><table>{children}</table></div>,
    }),
    [sources],
  )
  return (
    <div className={cn(small ? 'md md-sm' : 'md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], [rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {src}
      </ReactMarkdown>
    </div>
  )
})
