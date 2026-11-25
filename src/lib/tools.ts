import type { Artifact, ArtifactKind, Message, Provider, Settings, Source } from '../types'
import { domainOf, uid } from './utils'
import { callMcpTool, type McpBinding } from './mcp'
import { generateImage, imageProviderPref, type Aspect } from './imagegen'
import { recordImageUsage } from './usage'
import { isAgentTool, runAgentTool } from './agents'
import { deckAdvice, parseDeck, type Deck } from './slides'
import { isPluginTool, runPluginTool } from './plugins'
import { isMemoryTool, runMemoryTool } from './memory'
import { isCodeChat, isCodeTool, runCodeTool, saveImageToProject } from './codeTools'
import { generateVideo, saveVideo, videoBackend } from './videogen'
import { pickProvider } from './speech'
import { recompressImage } from './images'
import { formatAnswers, normalizeQuestions, waitForAnswers } from './ask'
import { integrationOfTool } from './integrations'
import { execInSandbox, exposePort, readSandboxText, sandboxFileToArtifact, writeSandboxFile } from './sandbox'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const WEB_SEARCH: ToolDef = {
  name: 'web_search',
  description:
    'Search the web for current information, news, facts, prices, docs, or anything you are unsure about. Returns numbered results; cite them inline as [n].',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'A concise, specific search query.' } },
    required: ['query'],
    additionalProperties: false,
  },
}

export const READ_URL: ToolDef = {
  name: 'read_url',
  description: 'Fetch and read the full text of a web page. Use it after web_search to read a promising result in depth, or when the user gives you a URL. Cite what you learn as [n].',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The full http(s) URL to read.' } },
    required: ['url'],
    additionalProperties: false,
  },
}

export const CREATE_ARTIFACT: ToolDef = {
  name: 'create_artifact',
  description:
    'Create or update a standalone artifact shown in a side panel next to the chat. Use for: complete HTML pages/apps/games (kind "html", one self-contained file with inline CSS/JS), data charts (kind "chart"), diagrams and flowcharts (kind "diagram"), SVG graphics (kind "svg"), long documents (kind "markdown"), or substantial code files (kind "code"). Pass the same id to update an existing artifact.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Optional. Reuse an existing artifact id to update it.' },
      title: { type: 'string' },
      kind: { type: 'string', enum: ['html', 'chart', 'diagram', 'svg', 'markdown', 'code'] },
      language: { type: 'string', description: 'Language for kind "code", e.g. python.' },
      content: {
        type: 'string',
        description:
          'The full content. ' + 'For kind "diagram" (flowcharts, architecture/system diagrams, org charts, mind maps, sequences of steps, simple drawings built from shapes, lines, text and arrows) content must be a JSON string in ONE of two forms. (1) GRAPH, auto-laid-out (preferred for flowcharts/architecture): {"type":"graph","direction":"TB"|"LR","nodes":[{"id":"a","label":"Start","shape":"pill|rect|rounded|diamond|ellipse|circle|hexagon|cylinder|parallelogram|note","color":"green|blue|amber|red|purple|teal|pink|gray","group":"g1"}],"edges":[{"from":"a","to":"b","label":"yes","style":"solid|dashed|dotted","arrow":"end|both|none"}],"groups":[{"id":"g1","label":"Backend","color":"blue"}]}. Use diamond for decisions, cylinder for databases, pill for start/end. Never specify coordinates for graphs. (2) CANVAS, free-form with explicit coordinates (for custom drawings/layouts): {"type":"canvas","elements":[{"type":"rect|ellipse|diamond|rounded|hexagon|cylinder","id":"r1","x":0,"y":0,"w":140,"h":60,"text":"Label","color":"blue","fill":true},{"type":"text","x":0,"y":-20,"text":"Title","size":18},{"type":"arrow|line","from":"r1","to":"r2","label":"calls","style":"dashed"} or {"type":"arrow","points":[[0,0],[100,0],[100,80]]}]}. In canvas, x/y is the top-left of a shape; connectors with from/to ids attach to the shape borders automatically; space shapes at least 60px apart.' + ' For kind "chart" this must be a JSON string: {"type":"bar|line|area|pie","xKey":"month","series":[{"key":"sales","label":"Sales"}],"data":[{"month":"Jan","sales":10}]}. For pie, use xKey as the label key and one series as the value.',
      },
    },
    required: ['title', 'kind', 'content'],
    additionalProperties: false,
  },
}

export const CREATE_PRESENTATION: ToolDef = {
  name: 'create_presentation',
  description:
    'Create a designed slide presentation (PowerPoint .pptx) that the user can preview in the side panel and download. Describe the deck as JSON; the app does the design (colours, shapes, cards, charts), so you only supply short, well-chosen content. Each slide has a "layout" and the fields that layout uses: ' +
    'title {title, subtitle, tag}; section {number, title, subtitle}; bullets {title, bullets[3-5 short lines], side?{stat,label}}; cards {title, cards[2-6]{icon(one emoji),title,text}}; stats {title, stats[2-4]{value,label,note}, summary?}; compare {title, left{heading,points[]}, right{heading,points[]}}; steps {title, steps[2-6]{title,text}}; quote {quote, author}; image {title, bullets[] or text, image{prompt?,emoji?}, imageSide}; chart {title, chart{type:bar|line|pie|doughnut, labels[], series[{name,values[]}]}, takeaway}; table {title, columns[], rows[][]}; closing {title, subtitle, contact}. Every slide may have "notes" (speaker notes). ' +
    'Themes: midnight, clean, sunset, forest, violet, mono, ocean, rose. Pass artifactId to revise an existing presentation (send the whole deck again).',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Deck title (shown in the footer and as the file name).' },
      theme: { type: 'string', enum: ['midnight', 'clean', 'sunset', 'forest', 'violet', 'mono', 'ocean', 'rose'] },
      accent: { type: 'string', description: 'Optional brand colour as a hex code like #E11D74; replaces the theme accent.' },
      font: { type: 'string', enum: ['modern', 'serif', 'classic'] },
      slides: { type: 'array', description: 'The slides, in order.', items: { type: 'object' } },
      artifactId: { type: 'string', description: 'Optional. Reuse an existing presentation id to replace it.' },
    },
    required: ['title', 'slides'],
    additionalProperties: false,
  },
}

export const ASK_USER: ToolDef = {
  name: 'ask_user',
  description:
    'Ask the user one or more clarifying questions and WAIT for their answers before continuing. Use this whenever the request is ambiguous or key details are missing, instead of guessing or assuming. The user sees an interactive form (single choice, multiple choice, or free text).',
  parameters: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: 'One to four focused questions, asked together.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Short unique id, e.g. "style".' },
            question: { type: 'string', description: 'The question, phrased for the user.' },
            type: { type: 'string', enum: ['single', 'multi', 'text'], description: 'single = pick one option, multi = pick several (checkboxes), text = free-form answer.' },
            options: {
              type: 'array',
              description: 'For single/multi: 2-6 sensible, distinct choices. Put the most likely first.',
              items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string', description: 'Optional short clarification.' } }, required: ['label'] },
            },
            allowCustomUserInput: { type: 'boolean', description: 'Let the user type their own answer instead of an option. Default true.' },
            placeholder: { type: 'string', description: 'Placeholder for text questions.' },
          },
          required: ['question', 'type'],
        },
      },
    },
    required: ['questions'],
  },
}

export const SANDBOX_TOOLS: ToolDef[] = [
  {
    name: 'sandbox_exec',
    description:
      'Run a shell command in your persistent Linux sandbox (a real VM, one per chat, created automatically on first use). It has internet access, keeps files between calls, and lets you install packages, run and test code, use git, build projects and start servers. Commands must be non-interactive. Each call is limited to 300 seconds, so start long-running servers in the background (nohup cmd > /tmp/app.log 2>&1 &) and check their log afterwards.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command(s) to run.' },
        timeoutSeconds: { type: 'number', description: 'Wall-clock limit, 1-300. Default 60.' },
        workdir: { type: 'string', description: 'Directory to run in (created if missing). Use an absolute path.' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra environment variables.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'sandbox_write_file',
    description: 'Create or overwrite a text file in the sandbox. Prefer this over echo/heredocs for source files. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path (or ~/relative to the sandbox user\'s home).' },
        content: { type: 'string', description: 'The full file content.' },
        executable: { type: 'boolean', description: 'Make the file executable.' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'sandbox_read_file',
    description: 'Read a text file from the sandbox.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, maxChars: { type: 'number', description: 'Truncate to this many characters (default 20000).' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'sandbox_expose_port',
    description:
      'DEPLOY: publish a server that is already running inside the sandbox at a public https URL (https://<name>.style.dev) and show it to the user as a live app in the side panel. Start the server first (bound to 0.0.0.0 or 127.0.0.1, in the background), then call this.',
    parameters: {
      type: 'object',
      properties: {
        port: { type: 'number', description: 'The port the server listens on.' },
        name: { type: 'string', description: 'Optional subdomain name (letters, digits, hyphens).' },
        title: { type: 'string', description: 'Short title for the app.' },
      },
      required: ['port'],
      additionalProperties: false,
    },
  },
  {
    name: 'sandbox_artifact',
    description: 'Show a file from the sandbox to the user as an artifact in the chat: an HTML page (rendered), SVG, markdown document, image (png/jpg/webp/gif), or code. Use this for results you built or generated inside the sandbox (charts, reports, screenshots, pages).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        title: { type: 'string' },
        kind: { type: 'string', enum: ['html', 'svg', 'markdown', 'image', 'code'], description: 'Optional; inferred from the file extension.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

export const GENERATE_IMAGE: ToolDef = {
  name: 'generate_image',
  description:
    'Generate an image from a text description and show it to the user (they can download it). Use whenever the user asks you to create, draw, design, or generate a picture, illustration, logo, photo, wallpaper, etc. The `prompt` you pass is sent to the image model verbatim, so write a rich, enhanced prompt yourself (see the parameter description).',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The FINAL enhanced image prompt, written by you. First expand the user\'s idea into one vivid paragraph (under 150 words): subject and action, composition and framing, setting, lighting, color palette, style or medium, mood, and for photos the lens/camera feel. Keep every detail the user gave, render quoted text verbatim, add nothing unrelated, no negative phrasing.' },
      title: { type: 'string', description: 'A short title for the image (2-5 words).' },
      aspect: { type: 'string', enum: ['square', 'landscape', 'portrait'], description: 'Image shape. Pick what suits the request.' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
}

export const GENERATE_VIDEO: ToolDef = {
  name: 'generate_video',
  description:
    'Generate a short video clip from a text description and show it to the user (they can play and download it). Use whenever the user asks you to create, animate or generate a video, clip, animation or moving scene. It takes one to several minutes. The `prompt` is sent to the video model verbatim, so write a rich, enhanced prompt yourself (see the parameter description).',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The FINAL enhanced video prompt, written by you. Expand the idea into one vivid paragraph (under 150 words) describing: subject and action over time (what happens from start to end), camera framing and movement, setting, lighting, color palette, visual style, mood, and any sound or ambience. Keep every detail the user gave, add nothing unrelated, no negative phrasing.' },
      title: { type: 'string', description: 'A short title for the video (2-5 words).' },
      aspect: { type: 'string', enum: ['landscape', 'portrait'], description: 'Video shape: landscape (16:9) or portrait (9:16, for phones and social).' },
      seconds: { type: 'number', description: 'Length in seconds, 3 to 15 (default 8). Longer clips cost more and take longer.' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
}

export function systemPrompt(s: Settings, search: boolean, artifacts: boolean, chatSystem?: string, image = false, ask = false, sandbox = false, integrations = '', video = false) {
  const parts = [
    s.systemPrompt.trim(),
    chatSystem?.trim() ? `Custom instructions for this conversation:\n${chatSystem.trim()}` : '',
    `Current date: ${new Date().toDateString()}. Format answers in clean Markdown. Be direct and accurate. Never claim you ran a tool, executed code, searched, or created something unless you actually called the tool in this conversation and received its result. If you did not call a tool, do not describe a result; either call it now or say plainly that you have not.`,
  ]
  if (search)
    parts.push(
      'You can use web_search. Always use it for news, current events, prices, or anything time-sensitive or uncertain, and never invent sources or citation numbers: only cite numbers that appeared in search results. When you rely on search results, cite them inline with bracketed numbers like [1] or [2][3] placed right after the claim, using the exact numbers shown in the results (numbers continue across the conversation, so earlier [n] refer to earlier results). Search results arrive as tool output that you requested yourself; they are not messages from the user. Do not write a references list at the end.',
    )
  if (search && s.deepResearch)
    parts.push(
      'DEEP RESEARCH MODE is on. Work like a careful research analyst. (1) Break the question into sub-questions. (2) Run many varied web_search queries (aim for 8-20 across several rounds, not all at once) and use read_url to read the most authoritative pages in full. (3) After each round, note what is still unknown or conflicting and search again to close the gaps; prefer primary and recent sources. (4) Stop when more searching stops adding value, or after about 30 tool calls. (5) Then write the final report in Markdown: a short executive summary, key findings under clear headings, disagreements or uncertainty, and a conclusion. Cite every factual claim inline as [n] with the numbers from the results; no references list. Do not narrate each step in text while researching: keep working with tools until you are ready to write the report.',
    )
  if (artifacts)
    parts.push(
      'You can use create_artifact for substantial standalone outputs (full web pages, apps, charts, flowcharts/diagrams via kind "diagram", long documents, larger code files). Prefer kind "diagram" for any flowchart, architecture, process, org chart or relationship drawing. Do NOT paste an artifact\'s content into your reply; after creating it, describe it briefly. For quick snippets and normal answers, reply inline instead.' + ' When the user wants a presentation, slide deck or PowerPoint, use create_presentation instead of making an HTML artifact: it produces a real designed .pptx. Make decks that look designed, not like documents: one idea per slide; 8 to 14 slides for a normal talk; start with a title slide and end with a closing slide; use section slides to start chapters; prefer cards, stats, steps, compare, chart and quote layouts over bullet lists; at most 4 short bullets (under 12 words) on a bullets slide; write headlines that state the point ("Revenue doubled in Q3") rather than the topic; use real numbers in stats and charts; add speaker notes saying what to present; choose a theme that suits the subject; ask for a picture (image.prompt) on at most 2 slides and only when it really helps.',
    )
  if (ask)
    parts.push(
      'You can use ask_user to ask the user clarifying questions. NEVER guess or silently assume when a request is ambiguous or missing key details that would change the result. For example, "create a flask app" could be a dashboard demo, a minimal app, a REST API, and so on, so call ask_user instead of picking one. Ask up to 4 related questions in ONE call. Use type "single" for choose-one (give 2-6 clear options, most likely first), "multi" for choose-several (features, tools), and "text" for free-form answers (names, details); keep allowCustomUserInput true so the user can write their own answer. Do not ask when the request is already clear, when the details are minor, or when you can reasonably infer them; and do not ask the same thing twice. Never ask clarifying questions as plain text in your reply; use ask_user. When ask_user returns, continue the task with the answers.',
    )
  if (sandbox)
    parts.push(
      'You have a persistent Linux sandbox VM (tools: sandbox_exec, sandbox_write_file, sandbox_read_file, sandbox_expose_port, sandbox_artifact). Use it whenever running code would beat guessing: computing, data analysis, testing code, converting files, building and deploying small apps. Work step by step, read the output of every command, fix errors, and never claim something works until you have run it. Write source files with sandbox_write_file, run things with sandbox_exec, keep servers running in the background, publish a running server with sandbox_expose_port to give the user a live URL, and show finished results (pages, charts, images, documents) with sandbox_artifact. Files persist between calls, and the VM sleeps between replies and wakes automatically (state is preserved). Keep commands non-interactive (use -y flags), and keep your final reply short.',
    )
  if (integrations) parts.push(integrations)
  if (image)
    parts.push('You can use generate_image to create images. When the user asks for an image, FIRST enhance their request yourself into a detailed prompt (subject, composition, setting, lighting, color palette, style, mood), then call generate_image with that enhanced prompt in the `prompt` argument. Do not send the user\'s bare request. Afterwards reply with at most one short sentence; do not repeat the prompt or describe the image at length.')
  if (video)
    parts.push('You can use generate_video to create short video clips. When the user asks for a video, FIRST decide it is really a video request (not an image, a chart, or just a description), then enhance their request yourself into a detailed prompt (subject and action over time, camera, setting, lighting, style, mood), then call generate_video with that enhanced prompt in the `prompt` argument. Do not send the user\'s bare request. Generation takes a while; afterwards reply with at most one short sentence and do not repeat the prompt.')
  return parts.filter(Boolean).join('\n\n')
}

export interface ToolResult {
  output: string
  /** pictures (data URLs) the model should look at next, such as a browser screenshot */
  images?: string[]
  sources?: Source[]
  artifact?: Artifact
}

export async function runTool(
  name: string,
  rawArgs: string,
  ctx: { settings: Settings; message: Message; callId: string; signal: AbortSignal; mcp: Map<string, McpBinding>; sourceBase: number; providers: Provider[]; chatId: string; update: (fn: (b: any) => void) => void },
): Promise<ToolResult> {
  let args: any = {}
  try { args = rawArgs ? JSON.parse(rawArgs) : {} } catch { return { output: 'Error: invalid JSON arguments' } }

  if (isMemoryTool(name)) return runMemoryTool(name, args, { chatId: ctx.chatId, update: ctx.update })
  if (isPluginTool(name)) return runPluginTool(name, args, { signal: ctx.signal, chatId: ctx.chatId })
  if (isAgentTool(name)) return runAgentTool(name, args, { chatId: ctx.chatId, callId: ctx.callId, signal: ctx.signal, update: ctx.update })
  if (isCodeTool(name)) return runCodeTool(name, args, { chatId: ctx.chatId, callId: ctx.callId, signal: ctx.signal, update: ctx.update, turn: `${ctx.chatId}:${ctx.message.id}` })

  const integ = integrationOfTool(name)
  if (integ) return integ.run(name, args, { chatId: ctx.chatId, settings: ctx.settings, signal: ctx.signal, update: ctx.update })

  if (name.startsWith('sandbox_')) {
    const sig = ctx.signal
    if (name === 'sandbox_exec') {
      const command = String(args.command ?? '').trim()
      if (!command) return { output: 'Error: empty command' }
      const r = await execInSandbox(ctx.chatId, command, { timeoutSeconds: Number(args.timeoutSeconds) || undefined, workdir: args.workdir ? String(args.workdir) : undefined, env: args.env && typeof args.env === 'object' ? args.env : undefined }, sig)
      ctx.update((b) => { b.meta = { exit: r.exitCode, fresh: r.fresh } })
      return { output: r.output }
    }
    if (name === 'sandbox_write_file') {
      const r = await writeSandboxFile(ctx.chatId, String(args.path ?? ''), String(args.content ?? ''), !!args.executable, sig)
      ctx.update((b) => { b.meta = { path: r.path, bytes: r.bytes } })
      return { output: `Wrote ${r.bytes} bytes to ${r.path}` }
    }
    if (name === 'sandbox_read_file') {
      const r = await readSandboxText(ctx.chatId, String(args.path ?? ''), sig)
      const max = Math.min(100_000, Math.max(500, Number(args.maxChars) || 20_000))
      ctx.update((b) => { b.meta = { path: r.path, bytes: r.size } })
      return { output: r.text.length > max ? r.text.slice(0, max) + `\n…[truncated, file is ${r.size} bytes]` : r.text }
    }
    if (name === 'sandbox_expose_port') {
      const r = await exposePort(ctx.chatId, Number(args.port), args.name ? String(args.name) : undefined, sig)
      const live = /^[23]\d\d$/.test(r.listening)
      ctx.update((b) => { b.meta = { url: r.url, port: Number(args.port), http: r.listening } })
      const artifact: Artifact = { id: uid(), title: String(args.title ?? 'Live app'), kind: 'app', content: r.url, version: 1 }
      return {
        output: live ? `Published at ${r.url} (the server answered with HTTP ${r.listening}). It is now shown to the user.` : `Published ${r.url}, but nothing answered on port ${args.port} yet (probe: ${r.listening}). Make sure the server is running and listening on that port, then tell the user.`,
        artifact,
      }
    }
    if (name === 'sandbox_artifact') {
      const artifact = await sandboxFileToArtifact(ctx.chatId, String(args.path ?? ''), args.title ? String(args.title) : undefined, args.kind ? String(args.kind) : undefined, sig)
      return { output: `Shown to the user as an artifact "${artifact.title}" (${artifact.kind}).`, artifact }
    }
    return { output: `Error: unknown sandbox tool ${name}` }
  }

  if (name === 'ask_user') {
    const qs = normalizeQuestions(args.questions)
    if (!qs.length) return { output: 'Error: provide at least one question with a "question" and "type".' }
    ctx.update((b) => { b.phase = 'asking' })
    void import('./notify').then((m) => m.notifyAsk(ctx.chatId, ctx.callId, qs[0]?.question ?? ''))
    let answers: Awaited<ReturnType<typeof waitForAnswers>>
    try { answers = await waitForAnswers(ctx.callId, ctx.signal) } finally { void import('./notify').then((m) => m.closeNotice('ask:' + ctx.callId)) }
    ctx.update((b) => { b.answers = answers ?? {}; b.skipped = !answers })
    return { output: formatAnswers(qs, answers) }
  }

  const bound = ctx.mcp.get(name)
  if (bound) return { output: await callMcpTool(bound.server, bound.tool, args, ctx.signal) }

  if (name === 'web_search') {
    const query = String(args.query ?? '').trim()
    if (!query) return { output: 'Error: empty query' }
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal: ctx.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.settings.tavilyKey}` },
      body: JSON.stringify({
        query,
        max_results: ctx.settings.deepResearch ? Math.max(ctx.settings.maxResults, 8) : ctx.settings.maxResults,
        search_depth: ctx.settings.searchDepth,
        include_answer: false,
      }),
    })
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    const known = ctx.message.sources ?? []
    const out: Source[] = []
    for (const r of json.results ?? []) {
      let s = known.find((k) => k.url === r.url) ?? out.find((k) => k.url === r.url)
      if (!s) {
        s = { n: ctx.sourceBase + known.length + out.length + 1, title: r.title || domainOf(r.url), url: r.url, snippet: String(r.content ?? '').slice(0, 400), domain: domainOf(r.url) }
        out.push(s)
      }
    }
    const lines = (json.results ?? []).map((r: any) => {
      const s = [...known, ...out].find((k) => k.url === r.url)!
      return `[${s.n}] ${r.title}\n${r.url}\n${String(r.content ?? '').slice(0, 900)}`
    })
    ctx.message.sources = [...known, ...out] // reserve the numbers right away so parallel searches never clash
    return { output: lines.join('\n\n') || 'No results found.', sources: out }
  }

  if (name === 'read_url') {
    const url = String(args.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return { output: 'Error: provide a full http(s) URL.' }
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST', signal: ctx.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.settings.tavilyKey}` },
      body: JSON.stringify({ urls: [url], extract_depth: 'basic', format: 'markdown' }),
    })
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    const page = j.results?.[0]
    if (!page?.raw_content) return { output: `Could not read ${url}: ${j.failed_results?.[0]?.error ?? 'no content'}. Try a different source.` }
    const text = String(page.raw_content)
    const known = ctx.message.sources ?? []
    let src = known.find((k) => k.url === url || k.url === page.url)
    const fresh: Source[] = []
    if (!src) {
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.slice(0, 120) ?? domainOf(url)
      src = { n: ctx.sourceBase + known.length + 1, title, url, snippet: text.replace(/\s+/g, ' ').slice(0, 300), domain: domainOf(url) }
      fresh.push(src)
      ctx.message.sources = [...known, src]
    }
    const max = ctx.settings.deepResearch ? 20000 : 14000
    return { output: `[${src.n}] ${url}\n${text.length > max ? text.slice(0, max) + `\n…[page truncated, ${text.length} characters total]` : text}`, sources: fresh }
  }

  if (name === 'generate_image') {
    const cfg = ctx.settings.image
    const prov = pickProvider(ctx.providers, cfg.providerId, [imageProviderPref(cfg.model)])
    if (!prov) return { output: 'Error: no image provider is configured. Ask the user to set one in Settings → Tools → Image generation.' }
    const prompt = String(args.prompt ?? '').trim()
    if (!prompt) return { output: 'Error: empty prompt' }
    const aspect: Aspect = cfg.aspect !== 'auto' ? cfg.aspect : (['square', 'landscape', 'portrait'].includes(args.aspect) ? args.aspect : 'auto')
    ctx.update((b) => { b.aspect = aspect === 'auto' ? 'square' : aspect })
    ctx.update((b) => { b.phase = 'generating'; b.enhanced = prompt })
    const img = await generateImage(prov, cfg.model, prompt, { aspect, quality: cfg.quality }, ctx.signal)
    recordImageUsage(prov.id, cfg.model, img.costUsd)
    // Code mode: save the picture into the project first, exactly as the model produced it
    let savedTo = ''
    if (args.path && isCodeChat(ctx.chatId)) {
      const saved = await saveImageToProject({ chatId: ctx.chatId, callId: ctx.callId, signal: ctx.signal, update: ctx.update, turn: `${ctx.chatId}:${ctx.message.id}` }, String(args.path), img.dataUrl)
      savedTo = saved.path
      ctx.update((b) => { b.meta = { ...(b.meta ?? {}), savedTo: saved.path } })
    }
    // PNGs from image models are 1.5-3 MB; WebP keeps them visually identical at a fraction of the size (matters for the 3 MB sync quota)
    if (img.dataUrl.length > 300_000) img.dataUrl = await recompressImage(img.dataUrl, { maxSide: 2048, quality: 0.92 })
    const existing = ctx.message.artifacts?.find((a) => a.id === args.id)
    const artifact: Artifact = {
      id: existing?.id ?? uid(), title: String(args.title ?? prompt.slice(0, 40)), kind: 'image', content: img.dataUrl, version: (existing?.version ?? 0) + 1,
      meta: { prompt, enhanced: img.revisedPrompt && img.revisedPrompt !== prompt ? img.revisedPrompt : undefined, model: cfg.model, aspect },
    }
    return { output: savedTo ? `Image generated and saved to ${savedTo} in the project. It is also shown to the user.` : `Image generated successfully and is now displayed to the user (artifact id: ${artifact.id}).`, artifact }
  }

  if (name === 'generate_video') {
    const cfg = ctx.settings.video
    const prov = pickProvider(ctx.providers, cfg.providerId, [/^gemini-/.test(cfg.model) ? 'gemini' : 'openai'])
    if (!prov) return { output: 'Error: no video provider is configured. Ask the user to set one in Settings → Tools → Video generation.' }
    const prompt = String(args.prompt ?? '').trim()
    if (!prompt) return { output: 'Error: empty prompt' }
    const aspect = cfg.aspect !== 'auto' ? cfg.aspect : args.aspect === 'portrait' ? 'portrait' : 'landscape'
    const seconds = Math.min(15, Math.max(3, Math.round(Number(args.seconds) || cfg.seconds || 8)))
    ctx.update((b) => { b.phase = 'generating'; b.enhanced = prompt; b.aspect = aspect; b.meta = { ...(b.meta ?? {}), seconds, progress: 0 } })
    const clip = await generateVideo(prov, cfg.model, prompt, { aspect, seconds, resolution: cfg.resolution }, ctx.signal, (pct, status) => ctx.update((b) => { b.meta = { ...(b.meta ?? {}), progress: pct, status } }))
    const existing = ctx.message.artifacts?.find((a) => a.id === args.id)
    const id = existing?.id ?? uid()
    await saveVideo(id, clip.blob)
    const artifact: Artifact = { id, title: String(args.title ?? prompt.slice(0, 40)), kind: 'video', content: '', version: (existing?.version ?? 0) + 1, meta: { prompt, model: cfg.model, aspect, seconds } }
    void videoBackend
    return { output: `Video generated successfully and is now shown to the user as a playable clip (artifact id: ${artifact.id}, ${seconds}s).`, artifact }
  }

  if (name === 'create_presentation') {
    let deck: Deck
    try { deck = parseDeck({ title: args.title, theme: args.theme, accent: args.accent, font: args.font, slides: args.slides }) } catch (e: any) { return { output: `Error: ${e.message}` } }
    // pictures the AI asked for (at most 3, only when image generation is set up)
    const cfg = ctx.settings.image
    const prov = cfg.enabled ? pickProvider(ctx.providers, cfg.providerId, [imageProviderPref(cfg.model)]) : undefined
    let made = 0, skipped = 0
    for (const s of deck.slides) {
      const prompt = s.image?.prompt
      if (!prompt) continue
      if (!prov || made >= 3) { skipped++; s.image = { emoji: s.image?.emoji ?? '🖼' }; continue }
      try {
        ctx.update((b) => { b.phase = 'generating'; b.enhanced = prompt })
        const img = await generateImage(prov, cfg.model, String(prompt), { aspect: 'landscape', quality: 'low' }, ctx.signal)
        recordImageUsage(prov.id, cfg.model, img.costUsd)
        s.image = { prompt: String(prompt).slice(0, 300), data: await recompressImage(img.dataUrl, { maxSide: 1100, quality: 0.72 }) }
        made++
      } catch { skipped++; s.image = { emoji: s.image?.emoji ?? '🖼' } }
    }
    const existing = ctx.message.artifacts?.find((a) => a.id === args.artifactId)
    const artifact: Artifact = { id: existing?.id ?? args.artifactId ?? uid(), title: deck.title || 'Presentation', kind: 'slides', content: JSON.stringify(deck), version: (existing?.version ?? 0) + 1 }
    const tips = deckAdvice(deck)
    return { output: `Presentation ${existing ? 'updated' : 'created'} (${deck.slides.length} slides, theme ${deck.theme ?? 'midnight'}, id ${artifact.id}). The user can preview it in the side panel and download it as a .pptx file.${made ? ` ${made} picture${made === 1 ? '' : 's'} generated.` : ''}${skipped ? ` ${skipped} picture${skipped === 1 ? ' was' : 's were'} replaced by an icon (image generation is off or limited to 3 per deck).` : ''}${tips.length ? `\nImprove it if you can (call create_presentation again with artifactId ${artifact.id}):\n- ${tips.join('\n- ')}` : ''}\nDo not repeat the slide contents in your reply; mention in one or two sentences what the deck covers.`, artifact }
  }

  if (name === 'create_artifact') {
    const kind = (['html', 'chart', 'diagram', 'svg', 'markdown', 'code'].includes(args.kind) ? args.kind : 'markdown') as ArtifactKind
    const existing = ctx.message.artifacts?.find((a) => a.id === args.id)
    const artifact: Artifact = {
      id: existing?.id ?? args.id ?? uid(),
      title: String(args.title ?? 'Untitled'),
      kind,
      language: args.language,
      content: String(args.content ?? ''),
      version: (existing?.version ?? 0) + 1,
    }
    return { output: `Artifact ${existing ? 'updated' : 'created'} successfully (id: ${artifact.id}). It is now displayed to the user.`, artifact }
  }

  return { output: `Error: unknown tool ${name}` }
}
