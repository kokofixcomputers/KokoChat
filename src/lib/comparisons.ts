/**
 * The landing page's comparisons. Every statement about another app comes from the pages listed in its `sources`
 * (checked on CHECKED); re-check them before changing a claim, and leave out what those pages don't say.
 */
export const CHECKED = 'November 27, 2026'

export type Cell = { yes?: boolean; text: string }
export interface Rival {
  name: string
  intro: string
  rows: [label: string, koko: Cell, them: Cell][]
  sources: [label: string, url: string][]
}

const y = (text: string): Cell => ({ yes: true, text })
const n = (text: string): Cell => ({ text })
const FREE = y('Free')
const MIT = y('Yes, MIT license')
const OWN_KEY = y('Yes')

export const RIVALS: Rival[] = [
  {
    name: 'ChatWise',
    intro: 'A polished desktop chat app.',
    rows: [
      ['Price', FREE, n('Free basic plan for personal, non-commercial use. Pro is $49 once, with a year of Pro feature updates')],
      ['Where it runs', y('In your browser, or as a desktop app'), n('Desktop app')],
      ['On your phone', y('Works in the mobile browser'), n('No mobile app planned')],
      ['Sync between devices', y('Optional, with optional end-to-end encryption'), n('Not yet. Data is local; sync is planned')],
      ['Bring your own API key', OWN_KEY, y('Yes')],
      ['Web search and artifacts', y('Included'), y('Listed under Pro')],
      ['MCP tools', y('Remote servers'), y('Yes. Unlimited tools listed under Pro')],
      ['Use a Claude or Copilot subscription', n('No. Connect with API keys'), y('Yes')],
    ],
    sources: [['website', 'https://chatwise.app'], ['pricing page', 'https://chatwise.app/pricing']],
  },
  {
    name: 'TypingMind',
    intro: 'A feature-rich chat interface with plans for teams.',
    rows: [
      ['Price', FREE, n('Free to try. Premium features come with a paid lifetime license')],
      ['Bring your own API key', OWN_KEY, y('Yes, with no monthly fee')],
      ['Where your data lives', y('On your device, with optional sync'), y('On your device, with sign-in to sync')],
      ['Compare models side by side', y('Yes'), y('Yes')],
      ['Artifacts, web search and MCP', y('Yes'), y('Yes')],
      ['Coding agent that works in your folders', y('Yes, in the desktop app'), n('Not mentioned on its home page')],
      ['Team workspaces and agent builder', n('No'), y('Yes')],
    ],
    sources: [['website', 'https://www.typingmind.com']],
  },
  {
    name: 'Chatbox',
    intro: 'A cross-platform AI client with its own model plans.',
    rows: [
      ['Price', FREE, n('Free for light use of its AI service. Paid plans from $3.99 a month. You can also use your own key')],
      ['Open source', MIT, y('Community Edition is GPLv3')],
      ['Web app and desktop', y('Web, macOS and Windows'), y('Web, macOS, Windows and Linux')],
      ['Phone apps', n('No app. Works in the mobile browser'), y('iOS and Android apps')],
      ['Web search and MCP', y('Yes'), y('Yes')],
      ['Models without your own key', n('No. Bring a key or a local model'), y('Yes, through its paid and free plans')],
      ['File knowledge base and agent mode', y('Project files, and Code mode on desktop'), y('Local knowledge base and Work Mode')],
    ],
    sources: [['website', 'https://chatboxai.app/en'], ['pricing page', 'https://chatboxai.app/en/pricing'], ['source code', 'https://github.com/chatboxai/chatbox']],
  },
  {
    name: 'Jan',
    intro: 'An open-source desktop app focused on running models locally.',
    rows: [
      ['Open source', MIT, y('Yes, Apache 2.0')],
      ['Use it in a browser', y('Yes, nothing to install'), n('Offered as a desktop download')],
      ['Desktop systems', n('macOS and Windows'), y('macOS, Windows and Linux')],
      ['Local models', n('Needs a separate server, such as Ollama'), y('Built-in engine that downloads and runs them')],
      ['Cloud providers', y('Yes'), y('Yes')],
      ['MCP, web search and projects', y('Yes'), y('Yes')],
    ],
    sources: [['website', 'https://www.jan.ai'], ['source code', 'https://github.com/janhq/jan']],
  },
  {
    name: 'Open WebUI',
    intro: 'A platform you host yourself, for individuals and organizations.',
    rows: [
      ['Getting started', y('Open the website. No server needed'), n('Install it with Python, Docker, Kubernetes or its desktop app')],
      ['Source and license', MIT, n('Source available, with conditions on removing its branding')],
      ['Local and compatible providers', y('Yes'), y('Yes, including Ollama')],
      ['Run completely offline', n('Not designed for it'), y('Yes')],
      ['Agent that runs commands', y('Code mode on your computer, with permission controls'), y('Through Open Terminal')],
      ['Hosting for an organization', n('No organization features'), y('Yes, with enterprise plans')],
    ],
    sources: [['documentation', 'https://docs.openwebui.com'], ['license', 'https://github.com/open-webui/open-webui/blob/main/LICENSE']],
  },
]
