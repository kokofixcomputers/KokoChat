import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, CircleAlert, Volume2, Square, Loader2, Pencil, FileText, Trash2, Copy, Check, GitFork } from 'lucide-react'
import { speak, stopSpeaking } from '../lib/speech'
import type { Message as Msg } from '../types'
import { Markdown, CopyButton } from './Markdown'
import { AskCard } from './AskCard'
import { IntegrationActivity } from './IntegrationCard'
import { integrationOfTool } from '../lib/integrations'
import { CodeActivity } from './CodeActivity'
import { PluginSlot } from './PluginSlot'
import { MemoryPill } from './MemoryUI'
import { ActionCard } from './ActionsPanel'
import { TodoCard } from './TodoUI'
import { AgentCard, AgentWaitRow, ReportsCard } from './AgentCard'
import { isCodeTool } from '../lib/codeTools'
import { ArtifactCard, SandboxCard, GenericToolPill, ReadPill, ResearchGroup, ImageGenCard, VideoGenCard, ReasoningBlock, SearchPill, SourcesBar } from './Blocks'
import { IconButton } from './ui'
import { ModelIcon } from './ModelIcon'
import { RegenerateMenu, VersionSwitcher } from './RegenerateMenu'
import { useStore } from '../store'
import { LiveReplyStats, ReplyStatsChip } from './ReplyStats'
import { toast } from '../lib/toast'
import { cn } from '../lib/utils'

const hoverShow = 'opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'

function Editor({ value, onChange, onCancel, onSave, children, className }: {
  value: string; onChange: (v: string) => void; onCancel: () => void; onSave: () => void; children: React.ReactNode; className?: string
}) {
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(el.scrollHeight, 460) + 'px'
  }, [value])
  useEffect(() => { ta.current?.focus(); ta.current?.setSelectionRange(value.length, value.length) }, []) // eslint-disable-line
  return (
    <div className={cn('glass-strong anim-pop w-full rounded-3xl p-2.5', className)}>
      <textarea
        ref={ta} value={value} onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave() } if (e.key === 'Escape') onCancel() }}
        className="block max-h-[460px] w-full resize-none bg-transparent px-2.5 py-1.5 text-[15.5px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <span className="mr-auto hidden pl-2.5 text-xs text-faint sm:inline">⌘↵ to save · Esc to cancel</span>
        <button onClick={onCancel} className="h-8 rounded-full px-3.5 text-[13px] font-medium text-muted hover:bg-fg/5">Cancel</button>
        {children}
      </div>
    </div>
  )
}

const primary = 'h-8 rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg disabled:opacity-40'
const secondary = 'h-8 rounded-full bg-fg/8 px-3.5 text-[13px] font-medium hover:bg-fg/12 disabled:opacity-40'

export const MessageView = memo(function MessageView({ chatId, m, last, latestUser, readOnly }: { chatId: string; m: Msg; last: boolean; latestUser: boolean; readOnly?: boolean }) {
  const setPanel = useStore((s) => s.setPanel)
  const regenerate = useStore((s) => s.regenerate)
  const panel = useStore((s) => s.panel)
  const speaking = useStore((s) => s.speaking)
  const showStats = useStore((s) => s.settings.replyStats)
  const editResend = useStore((s) => s.editResend)
  const editMessage = useStore((s) => s.editMessage)
  const forkChat = useStore((s) => s.forkChat)
  const fork = () => { if (forkChat(chatId, m.id)) toast.success('Forked into a new chat') }
  const mine = speaking?.id === m.id ? speaking.phase : null
  const compacting = useStore((s) => !!s.compacting[chatId])
  const prevUserText = useStore((s) => { const msgs = s.chats.find((c) => c.id === chatId)?.messages ?? []; const i = msgs.findIndex((x) => x.id === m.id); for (let k = i - 1; k >= 0; k--) if (msgs[k].role === 'user') return msgs[k].text ?? ''; return '' })
  const prov = useStore((s) => s.providers.find((p) => p.models.some((x) => x.id === m.model)))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const plainText = m.role === 'assistant' ? (m.blocks ?? []).filter((b) => b.type === 'text').map((b: any) => b.text as string).join('\n\n') : (m.text ?? '')
  const pluginMsg = useMemo(() => ({ chatId, message: { id: m.id, role: m.role, text: plainText, model: m.model, durationMs: m.durationMs, status: m.status } }), [chatId, m.id, m.role, plainText, m.model, m.durationMs, m.status])

  const toggleSpeak = async (text: string) => {
    const { setSpeaking, settings, providers } = useStore.getState()
    if (mine) { stopSpeaking(); setSpeaking(null); return }
    try { await speak(settings, providers, text, (ph) => setSpeaking(ph === 'idle' ? null : { id: m.id, phase: ph })) }
    catch (e: any) { setSpeaking(null); toast.error(e.message) }
  }

  const streaming = m.status === 'streaming'
  const artCount = m.artifacts?.length ?? 0
  useEffect(() => {
    if (streaming && artCount && !['image', 'video'].includes(m.artifacts![artCount - 1].kind)) setPanel({ kind: 'artifact', messageId: m.id, artifactId: m.artifacts![artCount - 1].id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, artCount])

  const remove = () => {
    const st = useStore.getState()
    const chat = st.chats.find((c) => c.id === chatId)
    const index = chat?.messages.findIndex((x) => x.id === m.id) ?? -1
    const snapshot = structuredClone(m)
    st.deleteMessage(chatId, m.id)
    toast.info('Message deleted', { label: 'Undo', run: () => useStore.getState().restoreMessage(chatId, index, { ...snapshot, status: snapshot.status === 'streaming' ? 'stopped' : snapshot.status }) })
  }
  const copy = (text: string) => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400) }

  /* ------------------------------ user ------------------------------ */
  if (m.role === 'user' && m.reports?.length) return <ReportsCard m={m} />
  if (m.role === 'user') {
    const imgs = (m.attachments ?? []).filter((a) => a.kind !== 'text')
    const files = (m.attachments ?? []).filter((a) => a.kind === 'text')
    const save = () => { const t = draft.trim(); if (!t) return; setEditing(false); latestUser ? editResend(chatId, m.id, t) : editMessage(chatId, m.id, t) }
    return (
      <div className="group/row anim-fade-up flex flex-col items-end gap-2">
        {(imgs.length > 0 || files.length > 0) && (
          <div className="flex flex-wrap justify-end gap-2">
            {imgs.map((a) => <img key={a.id} src={a.dataUrl} alt={a.name} className="max-h-56 max-w-xs rounded-2xl border border-line object-cover shadow-sm" />)}
            {files.map((a) => <div key={a.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2 px-3.5 py-2 text-[13px]"><FileText size={16} className="text-accent" />{a.name}</div>)}
          </div>
        )}
        {editing ? (
          <Editor value={draft} onChange={setDraft} onCancel={() => setEditing(false)} onSave={save} className="max-w-[90%]">
            {latestUser ? (
              <button disabled={!draft.trim()} onClick={save} className={primary}>Save &amp; regenerate</button>
            ) : (
              <>
                <button disabled={!draft.trim()} onClick={() => { const t = draft.trim(); setEditing(false); editResend(chatId, m.id, t) }} className={secondary} title="Replace everything after this message with a new reply">Save &amp; resend from here</button>
                <button disabled={!draft.trim()} onClick={save} className={primary} title="Only changes this message; later replies stay as they are">Save</button>
              </>
            )}
          </Editor>
        ) : (
          <>
            {m.quotes?.length ? <div className="flex max-w-[85%] flex-col items-end gap-1.5">{m.quotes.map((q, i) => <div key={i} className="flex max-w-full gap-2.5 rounded-2xl bg-surface-2/60 py-2 pl-3 pr-4 text-left ring-1 ring-line"><span className="w-0.5 shrink-0 rounded-full bg-accent" /><p className="line-clamp-4 whitespace-pre-wrap text-[13px] leading-snug text-muted">{q}</p></div>)}</div> : null}
            {m.cmd && !m.edited && (
              <div data-quotable className="max-w-[85%] rounded-[22px] rounded-br-lg bg-surface-2 px-4 py-2.5 text-[length:calc(15.5px*var(--tx,1))] leading-relaxed shadow-sm ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-lg bg-accent px-2 py-0.5 font-mono text-[13px] font-semibold text-accent-fg">/{m.cmd.slash}</span>
                  {Object.entries(m.cmd.fields ?? {}).filter(([, v]) => v.length <= 40 && !v.includes('\n')).map(([k, v]) => <span key={k} className="rounded-lg bg-accent-soft px-2 py-0.5 text-[13px] text-accent"><span className="opacity-70">{k.replace(/[-_]/g, ' ')}:</span> {v}</span>)}
                </div>
                {Object.entries(m.cmd.fields ?? {}).filter(([, v]) => v.length > 40 || v.includes('\n')).map(([k, v]) => <div key={k} className="mt-1.5"><div className="text-xs font-medium capitalize text-accent">{k.replace(/[-_]/g, ' ')}</div><div className="whitespace-pre-wrap">{v}</div></div>)}
                {m.cmd.input && <div className="mt-1.5 whitespace-pre-wrap">{m.cmd.input}</div>}
              </div>
            )}
            {m.text && !(m.cmd && !m.edited) && <div data-quotable className="max-w-[85%] whitespace-pre-wrap rounded-[22px] rounded-br-lg bg-surface-2 px-4 py-2.5 text-[length:calc(15.5px*var(--tx,1))] leading-relaxed shadow-sm ring-1 ring-line">{m.text}</div>}
            {!readOnly && <div className={cn('-mt-1 flex items-center gap-0.5', hoverShow)}>
              {m.edited && <span className="mr-1 text-xs text-faint">edited</span>}
              <IconButton className="h-7 w-7" title="Copy" onClick={() => copy(m.text ?? '')}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton>
              {m.text && <IconButton className="h-7 w-7" title={latestUser ? 'Edit and regenerate' : 'Edit'} onClick={() => { setDraft(m.text ?? ''); setEditing(true) }}><Pencil size={13} /></IconButton>}
              <IconButton className="h-7 w-7" title="Fork chat from here" onClick={fork}><GitFork size={13} /></IconButton>
              <IconButton className="h-7 w-7 hover:text-danger" title="Delete message" onClick={remove}><Trash2 size={13} /></IconButton>
            </div>}
          </>
        )}
      </div>
    )
  }

  /* ---------------------------- assistant --------------------------- */
  const blocks = m.blocks ?? []
  const firstText = blocks.findIndex((b) => b.type === 'text')
  const sourcesBar = m.sources?.length ? (
    <SourcesBar key="sb" sources={m.sources} active={panel?.kind === 'sources' && panel.messageId === m.id} onOpen={() => setPanel(panel?.kind === 'sources' && panel.messageId === m.id ? null : { kind: 'sources', messageId: m.id })} />
  ) : null
  const allText = blocks.filter((b) => b.type === 'text').map((b: any) => b.text).join('\n\n')
  const empty = streaming && blocks.length === 0
  const saveAssistant = () => { setEditing(false); editMessage(chatId, m.id, draft) }

  const out: React.ReactNode[] = []
  // in deep-research mode all searching / reading / thinking folds into one timeline
  const isStep = (b: (typeof blocks)[number]) => b.type === 'reasoning' || (b.type === 'tool' && (b.name === 'web_search' || b.name === 'read_url'))
  type Item = { b: (typeof blocks)[number]; i: number } | { group: typeof blocks; i: number } | { igroup: typeof blocks; integ: string; i: number } | { cgroup: typeof blocks; i: number }
  const items: Item[] = []
  const integOf = (b: (typeof blocks)[number] | undefined) => (b?.type === 'tool' ? integrationOfTool(b.name)?.id : undefined)
  blocks.forEach((b, i) => {
    const prev = items[items.length - 1]
    const integ = integOf(b)
    if (b.type === 'tool' && isCodeTool(b.name) && b.name !== 'create_action' && b.name !== 'todo_write') {
      // the agent's reads, edits and commands in a row read as one activity
      if (prev && 'cgroup' in prev) prev.cgroup.push(b)
      else items.push({ cgroup: [b], i })
    } else if (b.type === 'reasoning' && prev && 'cgroup' in prev && blocks[i + 1]?.type === 'tool' && isCodeTool((blocks[i + 1] as any).name)) {
      prev.cgroup.push(b) // thinking between two steps stays inside the activity
    } else if (m.mode === 'research' && isStep(b)) {
      if (prev && 'group' in prev) prev.group.push(b)
      else items.push({ group: [b], i })
    } else if (integ) {
      // several calls to the same service in a row read as one activity
      if (prev && 'igroup' in prev && prev.integ === integ) prev.igroup.push(b)
      else items.push({ igroup: [b], integ, i })
    } else if (b.type === 'reasoning' && prev && 'igroup' in prev && integOf(blocks[i + 1]) === prev.integ) {
      prev.igroup.push(b) // thinking between two calls stays inside the activity
    } else items.push({ b, i })
  })
  items.forEach((it, k) => {
    if ('cgroup' in it) {
      out.push(<CodeActivity key={'cg' + it.i} blocks={it.cgroup} live={streaming && k === items.length - 1} turn={k === items.findIndex((x) => 'cgroup' in x) ? `${chatId}:${m.id}` : undefined} />)
      return
    }
    if ('igroup' in it) {
      out.push(<IntegrationActivity key={'ig' + it.i} blocks={it.igroup} live={streaming && k === items.length - 1} />)
      return
    }
    if ('group' in it) {
      out.push(<ResearchGroup key={'rg' + it.i} blocks={it.group} live={streaming && k === items.length - 1} sourceCount={m.sources?.length ?? 0} />)
      return
    }
    const { b, i } = it
    if (i === firstText && sourcesBar) out.push(sourcesBar)
    if (b.type === 'reasoning') out.push(<ReasoningBlock key={b.id} block={b} streaming={streaming} />)
    else if (b.type === 'tool') {
      if (b.name === 'web_search') out.push(<SearchPill key={b.id} block={b} />)
      else if (b.name === 'read_url') out.push(<ReadPill key={b.id} block={b} />)
      else if (b.name === 'sandbox_artifact') out.push(<ArtifactCard key={b.id} block={b} messageId={m.id} artifact={m.artifacts?.find((a) => a.id === b.artifactId)} />)
      else if (b.name.startsWith('sandbox_')) out.push(<SandboxCard key={b.id} block={b} messageId={m.id} hasArtifact={!!b.artifactId} />)
      else if (b.name.startsWith('memory_')) out.push(<MemoryPill key={b.id} block={b} />)
      else if (b.name === 'create_action') out.push(<ActionCard key={b.id} block={b} />)
      else if (b.name === 'todo_write') out.push(<TodoCard key={b.id} block={b} />)
      else if (b.name === 'spawn_agent') out.push(<AgentCard key={b.id} block={b} />)
      else if (b.name === 'wait_for_agents') out.push(<AgentWaitRow key={b.id} block={b} />)
      else if (b.name === 'ask_user') out.push(<AskCard key={b.id} block={b} />)
      else if (b.name === 'generate_image') out.push(<ImageGenCard key={b.id} block={b} messageId={m.id} artifact={m.artifacts?.find((a) => a.id === b.artifactId)} />)
      else if (b.name === 'generate_video') out.push(<VideoGenCard key={b.id} block={b} messageId={m.id} artifact={m.artifacts?.find((a) => a.id === b.artifactId)} />)
      else if (b.name === 'create_artifact' || b.name === 'create_presentation') out.push(<ArtifactCard key={b.id} block={b} messageId={m.id} artifact={m.artifacts?.find((a) => a.id === b.artifactId)} />)
      else out.push(<GenericToolPill key={b.id} block={b} />)
    } else if (editing) {
      if (i === firstText) out.push(
        <Editor key="editor" value={draft} onChange={setDraft} onCancel={() => setEditing(false)} onSave={saveAssistant}>
          <button onClick={saveAssistant} className={primary}>Save</button>
        </Editor>,
      )
    } else if (b.text) {
      const isLast = i === blocks.length - 1
      out.push(
        <div key={b.id} data-quotable>
          <Markdown text={b.text} sources={m.sources} className={streaming && isLast ? 'caret' : ''} />
        </div>,
      )
    }
  })
  if (firstText < 0 && sourcesBar) out.push(sourcesBar)
  if (editing && firstText < 0) out.push(
    <Editor key="editor" value={draft} onChange={setDraft} onCancel={() => setEditing(false)} onSave={saveAssistant}><button onClick={saveAssistant} className={primary}>Save</button></Editor>,
  )

  return (
    <div className="group/row flex flex-col gap-3">
      {!streaming && <PluginSlot name="message.below" data={pluginMsg} className="flex flex-col gap-2" />}
      {empty && <span className="shimmer anim-fade-up w-fit text-sm font-medium">{compacting ? 'Compacting conversation…' : 'Thinking…'}</span>}
      {out}
      {m.error && (
        <div className="anim-fade-up flex items-start gap-2.5 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <CircleAlert size={16} className="mt-0.5 shrink-0" /><span className="break-words">{m.error}</span>
        </div>
      )}
      {m.status === 'stopped' && <span className="text-xs text-faint">Stopped</span>}
      {!streaming && !editing && !readOnly && (
        <div className={cn('-ml-2 flex flex-wrap items-center gap-0.5', last || mine ? 'opacity-100' : hoverShow)}>
          <VersionSwitcher chatId={chatId} m={m} />
          {allText && <CopyButton text={allText} />}
          {allText && (
            <IconButton className={`h-7 w-7 ${mine ? 'text-accent' : ''}`} title={mine ? 'Stop reading' : 'Read aloud'} onClick={() => toggleSpeak(allText)}>
              {mine === 'loading' ? <Loader2 size={14} className="spin" /> : mine ? <Square size={12} fill="currentColor" /> : <Volume2 size={15} />}
            </IconButton>
          )}
          <IconButton className="h-7 w-7" title="Edit message" onClick={() => { setDraft(allText); setEditing(true) }}><Pencil size={14} /></IconButton>
          <RegenerateMenu chatId={chatId} m={m} prompt={prevUserText} />
          <IconButton className="h-7 w-7" title="Fork chat from here" onClick={fork}><GitFork size={14} /></IconButton>
          <IconButton className="h-7 w-7 hover:text-danger" title="Delete message" onClick={remove}><Trash2 size={14} /></IconButton>
          {m.model && <span className="ml-2 flex items-center gap-1.5 text-xs text-faint"><ModelIcon model={m.model} preset={prov?.preset ?? 'custom'} name={prov?.name ?? ''} size={16} />{m.model}{m.durationMs ? ` · ${(m.durationMs / 1000).toFixed(m.durationMs < 10000 ? 1 : 0)}s` : ''}{m.edited ? ' · edited' : ''}</span>}
          {showStats && m.stats && <ReplyStatsChip stats={m.stats} durationMs={m.durationMs} model={m.model} />}
          <PluginSlot name="message.footer" data={pluginMsg} className="ml-2 flex items-center gap-2 text-xs text-faint" />
        </div>
      )}
      {streaming && !readOnly && (
        <div className="-ml-2 flex items-center">
          <IconButton className="h-7 w-7 shrink-0 hover:text-danger" title="Delete message" onClick={remove}><Trash2 size={14} /></IconButton>
          {showStats && <LiveReplyStats messageId={m.id} startedAt={m.createdAt} model={m.model} />}
        </div>
      )}
    </div>
  )
})
