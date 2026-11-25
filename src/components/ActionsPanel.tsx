import { useMemo, useState } from 'react'
import { Pencil, Play, Plus, Rocket, Sparkles, Trash2, Zap } from 'lucide-react'
import type { Block, ProjectAction } from '../types'
import { useStore } from '../store'
import { runAction } from '../lib/actions'

type Tool = Extract<Block, { type: 'tool' }>

/** The card in the chat when the AI adds an action: its command, and a button to run it. */
export function ActionCard({ block }: { block: Tool }) {
  const meta = (block.meta as { action?: { id: string; name: string; command: string } } | undefined)?.action
  const act = useStore((s) => s.actions.find((a) => a.id === meta?.id))
  if (block.status === 'running') return <span className="shimmer w-fit text-xs font-medium text-muted">Adding an action…</span>
  if (!meta || block.status === 'error') return null
  return (
    <div className="anim-fade-up w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Zap size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[13.5px] font-medium"><span className="truncate">{act?.name ?? meta.name}</span><span className="shrink-0 text-xs font-normal text-faint">Action</span></span>
          <code className="block truncate font-mono text-[12px] text-muted" title={act?.command ?? meta.command}>{act?.command ?? meta.command}</code>
        </span>
        {act ? <button onClick={() => runAction(act)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg transition active:scale-95"><Play size={12} fill="currentColor" />Run</button> : <span className="text-xs text-faint">Removed</span>}
      </div>
    </div>
  )
}

const field = 'h-9 w-full rounded-xl border border-line bg-surface-2/60 px-3 text-[13px] placeholder:text-faint focus:border-accent/60'

function Form({ cwd, init, onDone }: { cwd: string; init?: ProjectAction; onDone: () => void }) {
  const [name, setName] = useState(init?.name ?? '')
  const [command, setCommand] = useState(init?.command ?? '')
  const [description, setDescription] = useState(init?.description ?? '')
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/30 p-3">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, for example Deploy" className={field} autoFocus />
      <textarea value={command} onChange={(e) => setCommand(e.target.value)} rows={2} spellCheck={false} placeholder="Command, for example npx wrangler pages deploy dist --project-name my-site" className="w-full resize-none rounded-xl border border-line bg-surface-2/60 px-3 py-2 font-mono text-[12.5px] placeholder:text-faint focus:border-accent/60" />
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What it does (optional)" className={field} />
      <div className="flex gap-2">
        <button disabled={!name.trim() || !command.trim()} onClick={() => { useStore.getState().saveAction({ id: init?.id, cwd, name: name.trim(), command: command.trim(), description: description.trim() || undefined, source: 'user' }); onDone() }} className="h-8 rounded-full bg-fg px-4 text-[13px] font-medium text-bg disabled:opacity-40">Save</button>
        <button onClick={onDone} className="h-8 rounded-full bg-fg/8 px-4 text-[13px] font-medium">Cancel</button>
      </div>
    </div>
  )
}

/** The project's actions: run, edit, add, or ask the AI to set them up. */
export function ActionsPanel({ cwd }: { cwd: string }) {
  const all = useStore((s) => s.actions)
  const list = useMemo(() => all.filter((a) => a.cwd === cwd).sort((a, b) => a.createdAt - b.createdAt), [all, cwd])
  const del = useStore((s) => s.deleteAction)
  const [edit, setEdit] = useState<string | 'new' | null>(null)
  const askAi = () => {
    const st = useStore.getState()
    const c = st.chats.find((x) => x.id === st.activeId)
    if (c?.mode !== 'code') return
    void st.send('Look at this project and set up one-click actions for the things I will run regularly: build, test, the dev server and deploying it. Check how it is deployed (for example Cloudflare Pages or Workers with wrangler) and use the real commands. Add them with create_action, and ask me if you need something like the project name.', [])
  }
  return (
    <div className="px-1 pb-3">
      <p className="px-2.5 pb-2 text-xs leading-relaxed text-muted">One-click commands for this project. The AI can add them for you; each one runs in a terminal tab so you can watch it.</p>
      {list.map((a) => edit === a.id ? <div key={a.id} className="mb-2"><Form cwd={cwd} init={a} onDone={() => setEdit(null)} /></div> : (
        <div key={a.id} className="group mb-1.5 flex items-center gap-2.5 rounded-xl border border-line bg-surface/50 px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{/deploy|publish|release/i.test(a.name) ? <Rocket size={15} /> : <Zap size={15} />}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[13.5px] font-medium"><span className="truncate">{a.name}</span>{a.source === 'ai' && <span title="Written by the AI" className="shrink-0 text-faint"><Sparkles size={11} /></span>}</span>
            <code className="block truncate font-mono text-[11.5px] text-muted" title={a.command}>{a.command}</code>
            {a.description && <span className="block truncate text-xs text-faint">{a.description}</span>}
          </span>
          <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 max-sm:opacity-100">
            <button title="Edit" onClick={() => setEdit(a.id)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-fg/8 hover:text-fg"><Pencil size={13} /></button>
            <button title="Delete" onClick={() => del(a.id)} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-danger/10 hover:text-danger"><Trash2 size={13} /></button>
          </span>
          <button onClick={() => runAction(a)} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg transition active:scale-95"><Play size={12} fill="currentColor" />Run</button>
        </div>
      ))}
      {!list.length && edit !== 'new' && <p className="px-3 py-5 text-center text-sm text-faint">No actions yet.</p>}
      {edit === 'new' ? <Form cwd={cwd} onDone={() => setEdit(null)} /> : (
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          <button onClick={() => setEdit('new')} className="flex h-9 items-center gap-1.5 rounded-full bg-fg/8 px-4 text-[13px] font-medium transition hover:bg-fg/12 active:scale-95"><Plus size={14} />New action</button>
          <button onClick={askAi} className="flex h-9 items-center gap-1.5 rounded-full bg-accent-soft px-4 text-[13px] font-medium text-accent transition hover:bg-accent/20 active:scale-95"><Sparkles size={14} />Ask the AI to set them up</button>
        </div>
      )}
    </div>
  )
}
