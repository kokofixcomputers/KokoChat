import { useMemo, useRef, useState } from 'react'
import { FileText, FolderOpen, Loader2, Plus, Trash2, Upload, X } from 'lucide-react'
import { useStore } from '../store'
import { dropKb, indexFile } from '../lib/kb'
import { isPdf } from '../lib/kb'
import { isTextFile } from '../lib/images'
import { toast } from '../lib/toast'
import { IconButton } from './ui'
import { cn, fmtBytes } from '../lib/utils'

const MAX_BYTES = 40 * 1024 * 1024

export function ProjectDialog() {
  const id = useStore((s) => s.projectDialog)
  const project = useStore((s) => s.projects.find((p) => p.id === s.projectDialog))
  const allFiles = useStore((s) => s.kbFiles)
  const files = useMemo(() => allFiles.filter((f) => f.scope.project === id), [allFiles, id])
  const { openProject, updateProject, deleteProject, newChat, setSidebar } = useStore()
  const [busy, setBusy] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  if (!id || !project) return null

  const add = async (list: FileList | File[]) => {
    const ok = [...list].filter((f) => isPdf(f) || isTextFile(f))
    if (ok.length < [...list].length) toast.error('Only PDFs and text, code or data files are supported.')
    for (const f of ok) {
      if (f.size > MAX_BYTES) { toast.error(`${f.name} is larger than 40 MB.`); continue }
      const key = f.name + Math.random()
      setBusy((b) => ({ ...b, [key]: `${f.name}|Reading` }))
      try { await indexFile(f, { project: id }, (st) => setBusy((b) => ({ ...b, [key]: `${f.name}|${st}` }))) }
      catch (e: any) { toast.error(`${f.name}: ${e.message}`) }
      setBusy((b) => { const n = { ...b }; delete n[key]; return n })
    }
  }

  const close = () => openProject(null)
  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass-strong anim-pop flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px]">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"><FolderOpen size={19} /></span>
          <input value={project.name} onChange={(e) => updateProject(id, { name: e.target.value })} onBlur={() => !project.name.trim() && updateProject(id, { name: 'Untitled project' })} className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight" placeholder="Project name" />
          <IconButton onClick={close}><X size={18} /></IconButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
          <section>
            <div className="mb-1 text-sm font-medium">Instructions</div>
            <p className="mb-2 text-xs text-muted">The AI follows these in every chat in this project.</p>
            <textarea value={project.instructions} onChange={(e) => updateProject(id, { instructions: e.target.value })} rows={5} placeholder="For example: You are helping me write my thesis on coral reefs. Cite the attached papers and keep a formal tone." className="w-full resize-y rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-sm leading-relaxed placeholder:text-faint focus:border-accent/60 focus:bg-surface" />
          </section>

          <section onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files) }}>
            <div className="mb-1 flex items-center justify-between"><span className="text-sm font-medium">Files</span>
              <button onClick={() => input.current?.click()} className="flex h-8 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg active:scale-95"><Plus size={14} />Add files</button>
              <input ref={input} type="file" multiple hidden accept=".pdf,application/pdf,text/*,.md,.json,.csv,.tsv,.yaml,.yml,.xml,.log,.sql,.py,.js,.jsx,.ts,.tsx,.go,.rs,.java,.c,.cpp,.cs,.php,.rb,.toml,.html,.css" onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
            </div>
            <p className="mb-2 text-xs text-muted">Every chat in this project can search these files. They are split into passages and stored only in this browser.</p>
            <div className={cn('flex flex-col rounded-2xl border border-dashed p-1.5 transition', drag ? 'border-accent bg-accent-soft' : 'border-line')}>
              {files.map((f) => (
                <div key={f.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-fg/4">
                  <FileText size={17} className="shrink-0 text-accent" />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{f.name}</div><div className="text-xs text-muted">{fmtBytes(f.size)} · {f.chunks} passages · {f.embedded ? 'meaning-based search' : 'keyword search'}</div></div>
                  <IconButton title="Remove file" className="h-8 w-8 hover:text-danger" onClick={() => void dropKb([f.id])}><Trash2 size={15} /></IconButton>
                </div>
              ))}
              {Object.entries(busy).map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 rounded-xl px-3 py-2.5"><Loader2 size={17} className="spin shrink-0 text-accent" /><div className="min-w-0 flex-1 truncate text-sm">{v.split('|')[0]}</div><span className="shimmer text-xs font-medium">{v.split('|')[1]}…</span></div>
              ))}
              {!files.length && !Object.keys(busy).length && (
                <button onClick={() => input.current?.click()} className="flex flex-col items-center gap-2 rounded-xl py-8 text-sm text-muted transition hover:text-fg"><Upload size={20} />Drop PDFs, notes or code here, or click to choose</button>
              )}
            </div>
          </section>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <button onClick={() => { if (confirm(`Delete the project "${project.name}" and its files? Its chats are kept.`)) deleteProject(id) }} className="flex h-9 items-center gap-2 rounded-full px-3 text-sm text-muted transition hover:bg-danger/10 hover:text-danger"><Trash2 size={14} />Delete project</button>
          <button onClick={() => { close(); newChat(id); if (innerWidth < 900) setSidebar(false); window.dispatchEvent(new Event('koko:focus-composer')) }} className="flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-sm font-medium text-bg active:scale-95"><Plus size={15} />New chat in project</button>
        </div>
      </div>
    </div>
  )
}
