/**
 * The marketing page shown at the root of chat.kokodev.cc only (see lib/site.ts). It must not import the app's store:
 * a visitor reading about the app shouldn't load it, or write anything to their browser.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { get as idbGet } from 'idb-keyval'
import { ArrowRight, ArrowUpRight, AudioLines, BarChart3, Blocks, Brain, Check, Cloud, Code2, Columns2, Download, FileSearch, Globe, ImageIcon, KeyRound, Link2, Lock, MessageCircle, Minus, Plug, Presentation, Telescope, Workflow } from 'lucide-react'
import { appUrl } from '../lib/site'
import './landing.css'

const REPO = 'https://github.com/kokofixcomputers/KokoChat'
const DOWNLOAD = `${REPO}/releases/latest`

const PROVIDERS: [string, string][] = [['OpenAI', '#10a37f'], ['Anthropic', '#d97757'], ['Google Gemini', '#3b82f6'], ['OpenRouter', '#6366f1'], ['Groq', '#f55036'], ['Mistral', '#fa520f'], ['DeepSeek', '#4d6bfe'], ['xAI', '#6b7280'], ['Together AI', '#0f6fff'], ['Qwen', '#615ced'], ['Z.ai', '#374151'], ['Cloudflare', '#f6821f'], ['Ollama', '#78716c'], ['LM Studio', '#8b5cf6'], ['Any compatible API', '#0ea5e9']]

const SHOTS = [
  { id: 'chart', label: 'Search & charts', icon: <BarChart3 size={15} />, title: 'Ask a question, get an answer you can see', text: 'Web search with numbered citations, and live charts that open beside the chat.', alt: 'A chat that searched the web, with cited sources and a bar chart of planet diameters in a side panel' },
  { id: 'flow', label: 'Diagrams', icon: <Workflow size={15} />, title: 'Diagrams you can move around', text: 'Flowcharts and system maps are laid out for you. Pan, zoom, export, or publish them as a link.', alt: 'A chat beside an order-processing flowchart' },
  { id: 'tools', label: 'Tools', icon: <Plug size={15} />, title: 'See every step the AI takes', text: 'GitHub, package registries, web pages and your own MCP servers, each shown as a tidy card.', alt: 'A chat showing GitHub, npm, web search and page-reading activity cards followed by an answer' },
]

const FEATURES: { icon: ReactNode; title: string; text: string; wide?: boolean }[] = [
  { icon: <Columns2 />, title: 'Compare models side by side', text: 'Send one message to several models, read the replies next to each other, and carry on with the best one.', wide: true },
  { icon: <Telescope />, title: 'Deep research', text: 'Many searches and page reads, folded into one timeline with sources.' },
  { icon: <Blocks />, title: 'Artifacts', text: 'Web pages, games, documents, SVG and code in their own panel.' },
  { icon: <Presentation />, title: 'Presentations', text: 'Designed slide decks you can preview and download as PowerPoint.' },
  { icon: <ImageIcon />, title: 'Images and video', text: 'Generate them in the chat with a supported provider.' },
  { icon: <Code2 />, title: 'A coding agent on your desktop', text: 'Code mode reads, edits and runs your project, with permission controls, diffs and undo.', wide: true },
  { icon: <FileSearch />, title: 'Projects and files', text: 'Shared instructions and searchable documents.' },
  { icon: <Brain />, title: 'Memory', text: 'It can remember what matters. You can read, edit or clear it.' },
  { icon: <AudioLines />, title: 'Voice', text: 'Dictate your messages and have replies read aloud.' },
  { icon: <Link2 />, title: 'Share links', text: 'Send a chat, chart, diagram or page to anyone with a browser.' },
]

type Cell = { yes?: boolean; text: string }
const COMPARE: [string, Cell, Cell][] = [
  ['Price', { yes: true, text: 'Free' }, { text: 'Free basic plan for personal, non-commercial use. Pro is $49 once, with a year of Pro feature updates' }],
  ['Where it runs', { yes: true, text: 'In your browser, or as a desktop app' }, { text: 'Desktop app' }],
  ['On your phone', { yes: true, text: 'Works in the mobile browser' }, { text: 'No mobile app planned' }],
  ['Sync between devices', { yes: true, text: 'Optional, with optional end-to-end encryption' }, { text: 'Not yet. Data is local; sync is planned' }],
  ['Bring your own API key', { yes: true, text: 'Yes' }, { yes: true, text: 'Yes' }],
  ['Web search and artifacts', { yes: true, text: 'Included' }, { yes: true, text: 'Listed under Pro' }],
  ['MCP tools', { yes: true, text: 'Remote servers' }, { yes: true, text: 'Yes. Unlimited tools listed under Pro' }],
  ['Use a Claude or Copilot subscription', { text: 'No. Connect with API keys' }, { yes: true, text: 'Yes' }],
]

const FAQ = [
  ['Is Koko Chat really free?', 'Yes, and the code is open source under the MIT license. You bring your own model: you pay your AI provider for what you use, or run a local model. Some extras, such as web search, need their own key.'],
  ['Where are my chats and keys kept?', 'In your own browser or desktop app. Sync is off until you sign in. When on, it stores a copy on the sync server, including provider settings and keys; set a passphrase to encrypt that copy end to end. Anything you publish or share is readable by whoever has the link.'],
  ['Does my data go to AI providers?', 'Your messages go to the provider you pick so it can answer. Tools you use, such as web search or dictation, receive what they need to do their job.'],
  ['Can I use local models?', 'Yes, with Ollama, LM Studio or another compatible server. The desktop app is the easiest way, since browsers can block requests to some servers.'],
  ['Do I need to install anything?', 'No. Open it in your browser. The desktop apps add Code mode and working with files on your computer.'],
]

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); o.disconnect() } }, { rootMargin: '0px 0px -8% 0px' })
    o.observe(ref.current!)
    return () => o.disconnect()
  }, [])
  return <div ref={ref} style={{ transitionDelay: `${delay}ms` }} className={`lp-reveal ${on ? 'lp-in' : ''} ${className}`}>{children}</div>
}

function Shot({ id, dark, alt, eager }: { id: string; dark: boolean; alt: string; eager?: boolean }) {
  return <img src={`/landing/${id}-${dark ? 'dark' : 'light'}.jpg`} alt={alt} width={2000} height={1250} loading={eager ? 'eager' : 'lazy'} className="block h-auto w-full" />
}

const Mark = () => <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-accent-fg"><MessageCircle size={16} fill="currentColor" /></span>

/** Chats saved at this address from before it showed this page must stay reachable. */
function useSavedData() {
  const [has, setHas] = useState(false)
  useEffect(() => {
    idbGet('kokochat-v1').then((raw) => {
      const s = raw ? JSON.parse(raw as string).state : null
      setHas(!!(s?.chats?.some((c: any) => c.messages?.length) || s?.providers?.length))
    }).catch(() => {})
  }, [])
  return has
}

export function Landing() {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [tab, setTab] = useState(0)
  const saved = useSavedData()
  const open = appUrl()

  useEffect(() => {
    document.title = 'Koko Chat: every AI model in one calm, private workspace'
    const meta = document.createElement('meta')
    meta.name = 'description'
    meta.content = 'A free, open-source AI chat app. Bring your own API key or local model, with web search, artifacts, charts, diagrams and a desktop coding agent.'
    document.head.appendChild(meta)
    const font = document.createElement('link')
    font.rel = 'stylesheet'
    font.href = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&display=swap'
    document.head.appendChild(font)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { setDark(mq.matches); document.documentElement.classList.toggle('dark', mq.matches) }
    apply()
    mq.addEventListener('change', apply)
    return () => { mq.removeEventListener('change', apply); meta.remove(); font.remove() }
  }, [])

  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  const cta = (label: string, className = '') => <a href={open} className={`lp-cta group inline-flex items-center gap-2 rounded-full bg-fg font-semibold text-bg ${className}`}>{label}<ArrowRight size={16} className="transition group-hover:translate-x-0.5" /></a>
  const shot = SHOTS[tab]

  return (
    <div className="lp h-full overflow-y-auto overflow-x-hidden bg-bg text-fg">
      <nav className="sticky top-0 z-50 flex justify-center px-3 pt-3">
        <div className="glass-strong flex w-full max-w-4xl items-center gap-1 rounded-full py-1.5 pl-2 pr-1.5">
          <Mark /><span className="lp-display ml-1.5 mr-auto text-[17px] font-bold">Koko Chat</span>
          {[['tour', 'Tour'], ['features', 'Features'], ['compare', 'Compare'], ['faq', 'FAQ']].map(([id, l]) => <button key={id} onClick={() => go(id)} className="hidden rounded-full px-3.5 py-2 text-sm text-muted transition hover:bg-fg/5 hover:text-fg sm:block">{l}</button>)}
          <a href={REPO} target="_blank" rel="noreferrer" className="mr-1 hidden rounded-full px-3 py-2 text-sm text-muted transition hover:text-fg md:block">GitHub</a>
          {cta('Open app', 'h-9 px-4 text-[13px]')}
        </div>
      </nav>

      {saved && (
        <div className="mx-auto mt-3 max-w-2xl px-3">
          <div className="glass flex flex-col items-center gap-3 rounded-3xl border-accent/40 px-5 py-3.5 text-center text-sm sm:flex-row sm:text-left">
            <span className="flex-1"><b>Your chats are still here.</b> <span className="text-muted">You've used Koko Chat at this address before. Open it to carry on, or to sync or export before moving.</span></span>
            <a href="/?app" className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg">Open my saved chats</a>
          </div>
        </div>
      )}

      <header className="relative px-4 pt-16 text-center sm:pt-24">
        <div className="lp-aurora" aria-hidden />
        <div className="relative">
          <span className="lp-rise glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent" />Free · Open source · Bring your own model</span>
          <h1 className="lp-display lp-rise mx-auto mt-6 max-w-5xl text-balance text-[clamp(2.7rem,8vw,5.75rem)] font-extrabold leading-[0.98] tracking-[-0.035em]" style={{ animationDelay: '70ms' }}>Every model.<br /><span className="text-accent">One calm place</span> to think.</h1>
          <p className="lp-rise mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted" style={{ animationDelay: '140ms' }}>Chat with the AI you choose, with web search, live charts, diagrams and real tools, in your browser or on your desktop.</p>
          <div className="lp-rise mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '210ms' }}>
            {cta('Open Koko Chat', 'h-12 px-7 text-[15px]')}
            <a href={DOWNLOAD} target="_blank" rel="noreferrer" className="glass inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium transition hover:-translate-y-0.5"><Download size={16} />Desktop app</a>
          </div>
          <p className="lp-rise mt-3 text-xs text-faint" style={{ animationDelay: '260ms' }}>No account needed to start. Desktop builds are nightly releases for macOS (Apple silicon) and Windows.</p>
        </div>

        <div className="lp-rise relative mx-auto mt-14 max-w-6xl" style={{ animationDelay: '320ms' }}>
          <div className="lp-frame"><Shot id="chart" dark={dark} alt={SHOTS[0].alt} eager /></div>
          <div className="lp-float glass-strong absolute -left-3 top-[22%] hidden items-center gap-2 rounded-full py-2 pl-3 pr-4 text-[13px] font-medium lg:flex" aria-hidden><Globe size={14} className="text-accent" />Searched the web</div>
          <div className="lp-float lp-float-b glass-strong absolute -right-4 top-[48%] hidden items-center gap-2.5 rounded-2xl p-2.5 pr-4 text-left text-[13px] lg:flex" aria-hidden><span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent"><BarChart3 size={17} /></span><span><b className="block font-medium">Chart ready</b><span className="text-xs text-muted">Click to open</span></span></div>
          <div className="lp-float lp-float-c glass-strong absolute -bottom-4 left-[14%] hidden items-center gap-2 rounded-full py-2 pl-3 pr-4 text-[13px] font-medium lg:flex" aria-hidden><KeyRound size={14} className="text-accent" />Your key, your model</div>
        </div>
      </header>

      <section aria-label="Supported providers" className="lp-marquee mt-20">
        <div className="lp-track">
          {[0, 1].map((k) => <div key={k} className="flex shrink-0 gap-3 pr-3" aria-hidden={k === 1}>{PROVIDERS.map(([n, c]) => <span key={n} className="glass flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{n}</span>)}</div>)}
        </div>
      </section>

      <section id="tour" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-28">
        <Reveal className="text-center"><h2 className="lp-display lp-h2">More than a text box</h2></Reveal>
        <Reveal className="mt-8 flex justify-center">
          <div role="tablist" className="glass flex gap-1 rounded-full p-1">
            {SHOTS.map((s, i) => <button key={s.id} role="tab" aria-selected={i === tab} onClick={() => setTab(i)} className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-medium transition sm:px-4 ${i === tab ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}><span className="hidden sm:block">{s.icon}</span>{s.label}</button>)}
          </div>
        </Reveal>
        <Reveal className="mt-6">
          <div key={shot.id} className="anim-fade-up">
            <p className="mx-auto mb-6 max-w-xl text-center text-muted"><b className="block text-lg text-fg">{shot.title}</b>{shot.text}</p>
            <div className="lp-frame"><Shot id={shot.id} dark={dark} alt={shot.alt} /></div>
          </div>
        </Reveal>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-28">
        <Reveal><h2 className="lp-display lp-h2 max-w-2xl">Everything in one place, without the clutter</h2></Reveal>
        <div className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 4) * 60} className={f.wide ? 'sm:col-span-2' : ''}>
              <div className={`lp-card glass h-full rounded-[28px] p-6 ${f.wide ? 'lp-card-wide' : ''}`}>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent [&>svg]:h-5 [&>svg]:w-5">{f.icon}</span>
                <h3 className="lp-display mt-5 text-xl font-bold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-muted">{f.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-28">
        <Reveal>
          <div className="glass-strong grid gap-8 rounded-[36px] p-7 sm:p-12 lg:grid-cols-[1fr_1.3fr]">
            <div><h2 className="lp-display lp-h2">Private by design, not by promise</h2><p className="mt-4 text-muted">The app is local-first, and the code is there for you to check.</p></div>
            <ul className="flex flex-col gap-3">
              {([[<Lock size={18} />, 'Saved on your device', 'Chats and API keys live in your browser or desktop app.'], [<Cloud size={18} />, 'Sync only if you want it', 'Add a passphrase to encrypt your synced data end to end.'], [<KeyRound size={18} />, 'You choose who answers', 'Use a hosted provider, your own endpoint, or a model on your machine.']] as const).map(([icon, t, d]) => (
                <li key={t} className="flex gap-4 rounded-3xl bg-surface-2/70 p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent text-accent-fg">{icon}</span><span><b className="block">{t}</b><span className="text-sm text-muted">{d}</span></span></li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      <section id="compare" className="mx-auto max-w-4xl scroll-mt-20 px-4 pt-28">
        <Reveal className="text-center"><h2 className="lp-display lp-h2">Koko Chat and ChatWise</h2><p className="mx-auto mt-4 max-w-xl text-muted">ChatWise is a polished desktop chat app. Here's where the two differ, including where it does something we don't.</p></Reveal>
        <Reveal className="mt-10">
          <div className="glass-strong overflow-hidden rounded-[28px]" role="table">
            <div role="row" className="hidden grid-cols-[1fr_1.2fr_1.2fr] gap-4 border-b border-line px-6 py-4 text-sm font-semibold sm:grid">
              <span role="columnheader" /><span role="columnheader" className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" />Koko Chat</span><span role="columnheader" className="text-muted">ChatWise</span>
            </div>
            {COMPARE.map(([label, ...cells]) => (
              <div role="row" key={label} className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-5 py-4 text-sm last:border-0 sm:grid-cols-[1fr_1.2fr_1.2fr] sm:px-6">
                <span role="rowheader" className="col-span-2 font-medium sm:col-span-1">{label}</span>
                {cells.map((c, i) => (
                  <span role="cell" key={i} className={`flex items-start gap-2 ${i ? 'text-muted' : ''}`}>
                    <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${c.yes ? (i ? 'bg-fg/10 text-muted' : 'bg-accent text-accent-fg') : 'text-faint'}`}>{c.yes ? <Check size={10} strokeWidth={3.5} /> : <Minus size={12} />}</span>
                    <span><span className="block text-[11px] font-semibold uppercase tracking-wide text-faint sm:hidden">{i ? 'ChatWise' : 'Koko'}</span>{c.text}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-center text-xs leading-relaxed text-faint">ChatWise details come from its <a className="underline hover:text-fg" href="https://chatwise.app" target="_blank" rel="noreferrer">website</a> and <a className="underline hover:text-fg" href="https://chatwise.app/pricing" target="_blank" rel="noreferrer">pricing page</a>, checked November 27, 2026, and may have changed. ChatWise is a trademark of its owner; Koko Chat is not affiliated with it.</p>
        </Reveal>
      </section>

      <section id="faq" className="mx-auto max-w-2xl scroll-mt-20 px-4 pt-28">
        <Reveal><h2 className="lp-display lp-h2 text-center">Good questions</h2></Reveal>
        <div className="mt-8 flex flex-col gap-2.5">
          {FAQ.map(([q, a]) => <Reveal key={q}><details className="lp-faq glass rounded-3xl px-5 py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">{q}<span className="lp-plus text-xl leading-none text-accent">+</span></summary><p className="mt-3 text-[14.5px] leading-relaxed text-muted">{a}</p></details></Reveal>)}
        </div>
      </section>

      <section className="relative mx-auto max-w-4xl px-4 py-28 text-center">
        <Reveal>
          <div className="glass-strong relative overflow-hidden rounded-[40px] px-6 py-16">
            <div className="lp-aurora" aria-hidden />
            <div className="relative"><h2 className="lp-display lp-h2">Bring your model. Start chatting.</h2><p className="mt-4 text-muted">It opens right in your browser.</p><div className="mt-8">{cta('Open Koko Chat', 'h-12 px-8 text-[15px]')}</div></div>
          </div>
        </Reveal>
      </section>

      <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line px-4 py-8 text-sm text-muted">
        <span className="flex items-center gap-2"><Mark />Koko Chat</span>
        <a href={REPO} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-fg">Source on GitHub<ArrowUpRight size={13} /></a>
        <a href={DOWNLOAD} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-fg">Downloads<ArrowUpRight size={13} /></a>
        <span className="text-faint">MIT licensed</span>
      </footer>
    </div>
  )
}
