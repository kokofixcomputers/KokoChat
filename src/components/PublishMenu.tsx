import { useEffect, useState } from 'react'
import { askConfirm } from '../lib/confirm'
import { Globe, Check, Copy, ExternalLink, Loader2, Trash2, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import type { Artifact } from '../types'
import { IconButton, Popover } from './ui'
import { publishArtifact, publishedUrl, unpublish, usePublished } from '../lib/publish'
import { toast } from '../lib/toast'
import { fmtBytes } from '../lib/utils'

const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Link copied'), () => toast.error('Could not copy'))

/** Publish button for HTML artifacts: puts the page on the KokoChat server and gives back a public link. */
export function PublishMenu({ artifact }: { artifact: Artifact }) {
  const signedIn = useStore((s) => !!s.sync.token)
  const items = usePublished((s) => s.items)
  const loaded = usePublished((s) => s.loaded)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (signedIn && !loaded) usePublished.getState().load().catch(() => {}) }, [signedIn, loaded])
  const live = items.find((p) => p.ref === artifact.id)
  const url = live ? publishedUrl(live.id) : ''

  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } catch (e: any) { toast.error(e.message) } finally { setBusy(false) } }
  const doPublish = () => run(async () => { const r = await publishArtifact(artifact.id, artifact.title, artifact.content); await copy(r.url); toast.success(r.republished ? 'Page updated' : 'Published, link copied') })

  return (
    <Popover side="bottom" align="right" button={(open, toggle) => (
      <IconButton title={live ? 'Published' : 'Publish'} className={`h-8 w-8 ${live ? 'text-accent' : ''}`} onClick={toggle} aria-pressed={open}><Globe size={16} /></IconButton>
    )} panelClassName="w-72 p-3">
      {(close) => !signedIn ? (
        <div className="text-sm"><div className="font-medium">Publish this page</div><p className="mt-1 text-xs text-muted">Sign in under Settings → Sync to put this page online.</p>
          <button onClick={() => { close(); useStore.getState().openSettings('sync') }} className="mt-2 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg">Open Sync</button></div>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <div className="font-medium">{live ? 'Published' : 'Publish this page'}</div>
          {live ? (<>
            <div className="break-all rounded-xl bg-surface-2 px-2.5 py-2 text-xs">{url}</div>
            <div className="text-xs text-muted">{live.views} view{live.views === 1 ? '' : 's'} · {fmtBytes(live.size)} of your storage</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => copy(url)} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs hover:bg-surface-2"><Copy size={12} />Copy link</button>
              <button onClick={() => window.open(url, '_blank')} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs hover:bg-surface-2"><ExternalLink size={12} />Open</button>
              <button disabled={busy} onClick={doPublish} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs hover:bg-surface-2">{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}Update</button>
              <button disabled={busy} onClick={() => run(async () => { await unpublish(live.id); toast.success('Unpublished'); close() })} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-red-500 hover:bg-surface-2"><Trash2 size={12} />Unpublish</button>
            </div>
          </>) : (<>
            <p className="text-xs text-muted">Anyone with the link can open it. It counts towards your cloud storage, and you can unpublish it any time.</p>
            <button disabled={busy} onClick={doPublish} className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-3 py-2 text-xs font-medium text-accent-fg">{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Publish and copy link</button>
          </>)}
        </div>
      )}
    </Popover>
  )
}

/** Settings page: everything you have published, with copy / open / unpublish. */
export function PublishedSettings() {
  const signedIn = useStore((s) => !!s.sync.token)
  const items = usePublished((s) => s.items)
  const loaded = usePublished((s) => s.loaded)
  const [err, setErr] = useState('')
  useEffect(() => { if (signedIn) usePublished.getState().load().catch((e) => setErr(e.message)) }, [signedIn])
  if (!signedIn) return <div className="rounded-2xl border border-line bg-surface/50 p-4 text-sm text-muted">Sign in under <button className="underline" onClick={() => useStore.getState().openSettings('sync')}>Sync</button> to publish pages and see them here.</div>
  const total = items.reduce((n, p) => n + p.size, 0)
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted">Web pages you published from artifacts. {items.length ? `${items.length} page${items.length === 1 ? '' : 's'}, ${fmtBytes(total)} of your storage.` : ''}</div>
      {err && <div className="text-xs text-red-500">{err}</div>}
      {loaded && !items.length && <div className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Nothing published yet. Open an HTML artifact and press the globe button.</div>}
      {items.map((p) => (
        <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface/50 p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Globe size={16} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{p.title}</div>
            <div className="truncate text-xs text-muted">{publishedUrl(p.id)}</div>
            <div className="text-xs text-muted">{p.views} view{p.views === 1 ? '' : 's'} · {fmtBytes(p.size)} · updated {new Date(p.updated).toLocaleDateString()}</div>
          </div>
          <IconButton title="Copy link" className="h-8 w-8" onClick={() => copy(publishedUrl(p.id))}><Copy size={15} /></IconButton>
          <IconButton title="Open" className="h-8 w-8" onClick={() => window.open(publishedUrl(p.id), '_blank')}><ExternalLink size={15} /></IconButton>
          <IconButton title="Unpublish" className="h-8 w-8 text-red-500" onClick={async () => { if (await askConfirm(`Unpublish "${p.title}"? Its link will stop working.`)) unpublish(p.id).then(() => toast.success('Unpublished')).catch((e) => toast.error(e.message)) }}><Trash2 size={15} /></IconButton>
        </div>
      ))}
    </div>
  )
}
