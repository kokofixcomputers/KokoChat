import { useState, type ReactNode } from 'react'
import { BookOpenText, CalendarDays, Files, Check, ChevronRight, CircleAlert, ExternalLink, HardDrive, Loader2, Mail, Package } from 'lucide-react'
import type { Block } from '../types'
import { describeCall, type Describe } from '../lib/integrations'
import { cn } from '../lib/utils'

export function GithubMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/** The logo tile of an integration (real marks where we have them, a tinted glyph otherwise). */
export function BrandTile({ id, size = 32 }: { id: string; size?: number }) {
  const inner = Math.round(size * 0.56)
  const img = (src: string) => <img src={src} width={inner} height={inner} alt="" draggable={false} />
  const glyph = (node: ReactNode, color: string) => <span style={{ color }}>{node}</span>
  const content: ReactNode =
    id === 'github' ? <GithubMark size={inner} />
    : id === 'google' ? img('/integrations/google.svg')
    : id === 'huggingface' ? img('/integrations/huggingface.svg')
    : id === 'notion' ? img('/integrations/notion.svg')
    : id === 'files' ? glyph(<Files size={inner} />, '#10a37f')
    : id === 'gmail' ? glyph(<Mail size={inner} />, '#ea4335')
    : id === 'calendar' ? glyph(<CalendarDays size={inner} />, '#4285f4')
    : id === 'drive' ? glyph(<HardDrive size={inner} />, '#188038')
    : id === 'wikipedia' ? glyph(<BookOpenText size={inner} />, '#202122')
    : id === 'npm' ? glyph(<Package size={inner} />, '#cb3837')
    : id === 'pypi' ? glyph(<Package size={inner} />, '#3775a9')
    : <Package size={inner} />
  return (
    <span style={{ width: size, height: size }} className={cn('grid shrink-0 place-items-center rounded-xl', id === 'github' ? 'bg-fg text-bg' : 'bg-white ring-1 ring-black/10')}>
      {content}
    </span>
  )
}

type Tool = Extract<Block, { type: 'tool' }>
interface Info { b: Tool; d: Describe; name: string; id: string }

const reason = (r?: string) => (r ?? '').replace(/^Error:\s*/, '').trim()

/** "Fetching GitHub repository owner/repo" — what the user reads instead of a tool name. */
function Sentence({ i }: { i: Info }) {
  const { b, d } = i
  const verb = b.status === 'running' ? d.present : b.status === 'error' ? d.failed : d.past
  return (
    <span className="min-w-0">
      <span className={cn(b.status === 'running' && 'shimmer')}>{verb}</span>
      {(((b.meta as any)?.label as string | undefined) ?? d.subject) && <> <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{((b.meta as any)?.label as string | undefined) ?? d.subject}</code></>}
      {d.in && <span className="text-muted"> in <code className="font-mono text-[12.5px]">{d.in}</code></span>}
      {d.extra && <span className="text-muted"> {d.extra}</span>}
    </span>
  )
}

const StatusIcon = ({ s }: { s: Tool['status'] }) =>
  s === 'running' ? <Loader2 size={14} className="spin shrink-0 text-accent" /> : s === 'error' ? <CircleAlert size={14} className="shrink-0 text-danger" /> : <Check size={14} strokeWidth={3} className="shrink-0 text-accent" />

/**
 * One calm line (or a collapsible timeline when the agent makes several calls in a row)
 * for everything an integration does. No tool names, no jargon.
 */
export function IntegrationActivity({ blocks, live }: { blocks: Block[]; live: boolean }) {
  const [open, setOpen] = useState(false)
  const infos: Info[] = []
  for (const b of blocks) {
    if (b.type !== 'tool') continue
    const r = describeCall(b.name, b.args)
    if (r) infos.push({ b, d: r.d, name: r.integration.name, id: r.integration.id })
  }
  if (!infos.length) return null
  const brand = infos[0]
  const running = infos.find((x) => x.b.status === 'running')
  const anyFailed = infos.some((x) => x.b.status === 'error')
  const single = infos.length === 1
  const lead = single ? infos[0] : running ?? infos[infos.length - 1]
  const repos = [...new Set(infos.map((x) => x.d.in ?? (x.d.subject && !x.d.subject.startsWith('“') ? x.d.subject.split('/').slice(0, 2).join('/') : '')).filter(Boolean))].slice(0, 3)
  const err = single && infos[0].b.status === 'error' ? reason(infos[0].b.result) : ''
  const link = lead.b.meta && (lead.b.meta as any).url ? String((lead.b.meta as any).url) : lead.d.url

  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <BrandTile id={infos.length > 1 && new Set(infos.map((x) => x.d.icon ?? x.id)).size > 1 ? brand.id : brand.d.icon ?? brand.id} />
        <button onClick={() => !single && setOpen((o) => !o)} className={cn('flex min-w-0 flex-1 items-center gap-2 text-left text-[13.5px] leading-snug', single && 'cursor-default')}>
          <span className="min-w-0 flex-1">
            {single || (live && running) ? (
              <>
                <Sentence i={lead} />
                {!single && <span className="ml-1.5 text-xs text-faint">· step {infos.indexOf(lead) + 1} of {infos.length}</span>}
              </>
            ) : (
              <>
                <span className="font-medium">{anyFailed && !infos.some((x) => x.b.status === 'done') ? `Couldn't reach ${brand.name}` : `Explored ${brand.name}`}</span>
                {repos.length > 0 && <> <code className="rounded-md bg-fg/6 px-1.5 py-0.5 font-mono text-[12.5px]">{repos.join(', ')}</code></>}
                <span className="ml-1.5 text-xs text-faint">· {infos.length} steps</span>
              </>
            )}
            {err && <span className="mt-0.5 block text-xs text-danger">{err}</span>}
            {single && lead.b.status === 'done' && (lead.b.meta as any)?.summary && <span className="ml-1.5 text-xs text-faint">· {(lead.b.meta as any).summary}</span>}
          </span>
          {!single && <ChevronRight size={14} className={cn('shrink-0 text-faint transition-transform', open && 'rotate-90')} />}
        </button>
        {single && <StatusIcon s={lead.b.status} />}
        {single && link && <a href={link} target="_blank" rel="noreferrer" title={`Open on ${brand.name}`} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted transition hover:bg-fg/8 hover:text-fg"><ExternalLink size={13} /></a>}
        {!single && live && running && <Loader2 size={14} className="spin shrink-0 text-accent" />}
      </div>
      {live && running && !single && <div className="imggen-sweep relative h-0.5 overflow-hidden bg-fg/6" />}
      {open && !single && (
        <div className="max-h-72 overflow-y-auto border-t border-line px-2 py-1.5">
          {infos.map((x) => {
            const u = (x.b.meta as any)?.url ?? x.d.url
            return (
              <div key={x.b.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]">
                <StatusIcon s={x.b.status} />
                <span className="min-w-0 flex-1 truncate"><Sentence i={x} />{x.b.status === 'error' && <span className="ml-1.5 text-xs text-danger">{reason(x.b.result)}</span>}</span>
                {x.b.status === 'done' && (x.b.meta as any)?.summary && <span className="hidden shrink-0 text-xs text-faint sm:inline">{(x.b.meta as any).summary}</span>}
                {u && <a href={u} target="_blank" rel="noreferrer" title="Open on the website" className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><ExternalLink size={12} /></a>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
