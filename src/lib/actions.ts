import { useStore } from '../store'
import { askConfirm } from './confirm'
import { useDock } from './dock'
import type { ProjectAction } from '../types'
import type { ToolDef } from './tools'
import { baseName } from './desktop'

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })

export const ACTION_TOOLS: ToolDef[] = [
  {
    name: 'create_action',
    description: 'Add a one-click action to this project (for example "Deploy to Cloudflare Pages", "Run tests", "Start dev server"). The user sees it as a button and runs it themselves in a terminal tab, so you do not run it. Use the exact, working command for this project. If an action with the same name exists, its command is replaced.',
    parameters: obj({ name: { type: 'string', description: 'Short button label, 1 to 4 words.' }, command: { type: 'string', description: 'The shell command, run from the project folder. No secrets in it.' }, description: { type: 'string', description: 'One sentence on what it does.' } }, ['name', 'command']),
  },
  { name: 'remove_action', description: 'Remove one of this project\'s actions by name.', parameters: obj({ name: { type: 'string' } }, ['name']) },
  { name: 'list_actions', description: 'List the actions this project already has.', parameters: obj({}) },
]
export const isActionTool = (n: string) => n === 'create_action' || n === 'remove_action' || n === 'list_actions'

export const actionsFor = (cwd?: string): ProjectAction[] => (cwd ? useStore.getState().actions.filter((a) => a.cwd === cwd) : [])

export async function runActionTool(name: string, a: Record<string, any>, ctx: { chatId: string; update: (fn: (b: any) => void) => void }): Promise<{ output: string }> {
  const st = useStore.getState()
  const cwd = st.chats.find((c) => c.id === ctx.chatId)?.cwd
  if (!cwd) throw new Error('This session has no project folder.')
  if (name === 'list_actions') { const l = actionsFor(cwd); return { output: l.length ? l.map((x) => `- ${x.name}: ${x.command}${x.description ? ` (${x.description})` : ''}`).join('\n') : 'No actions yet.' } }
  if (name === 'remove_action') {
    const x = actionsFor(cwd).find((y) => y.name.toLowerCase() === String(a.name ?? '').toLowerCase())
    if (!x) return { output: 'There is no action with that name.' }
    st.deleteAction(x.id); return { output: `Removed "${x.name}".` }
  }
  const label = String(a.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  const command = String(a.command ?? '').trim().slice(0, 800)
  if (!label || !command) throw new Error('name and command are required')
  const saved = st.saveAction({ cwd, name: label, command, description: a.description ? String(a.description).slice(0, 200) : undefined, source: 'ai' })
  ctx.update((b) => { b.meta = { ...(b.meta ?? {}), action: { id: saved.id, name: saved.name, command: saved.command } } })
  return { output: `Added the action "${saved.name}". The user can run it with one click from the Actions tab of the side panel (or from the card in this chat). It runs: ${saved.command}` }
}

/** Run an action in a new terminal tab. Commands the AI wrote must be looked at and allowed first. */
export async function runAction(act: ProjectAction): Promise<boolean> {
  if (act.approved !== act.command && !(await askConfirm(`Run this command in ${baseName(act.cwd)}?\n\n${act.command}\n\n${act.source === 'ai' ? 'The AI wrote this command. ' : ''}It runs in a terminal tab where you can see everything it does.`))) return false
  const st = useStore.getState()
  st.patchAction(act.id, { approved: act.command, lastRunAt: Date.now() })
  useDock.getState().add('terminal', { cwd: act.cwd, title: act.name, input: act.command })
  return true
}
