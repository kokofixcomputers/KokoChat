import { useStore } from '../store'
import { completeText } from './complete'
import { koko } from './desktop'

function model() {
  const { selected, providers } = useStore.getState()
  const p = providers.find((x) => x.id === selected?.providerId)
  if (!p || !selected) throw new Error('Choose a model first (top of the window).')
  return { p, model: selected.model }
}
const clean = (t: string) => t.trim().replace(/^```[a-z]*\n?|```$/g, '').replace(/^["'`]+|["'`]+$/g, '').trim()

/** A commit message for the staged changes (or for everything, when nothing is staged). */
export async function aiCommitMessage(cwd: string): Promise<string> {
  const k = koko()
  const r = await k?.git.changes({ cwd })
  if (!r?.ok) throw new Error(r && !r.ok ? r.error.message : 'Not available here.')
  if (!r.data.stat && !r.data.diff.trim()) throw new Error('There are no changes to describe.')
  const m = model()
  const out = await completeText(m.p, m.model,
    'You write git commit messages. Reply with ONLY the message, no code fences and no quotes. First line: imperative mood, at most 72 characters, no trailing period. If the change is more than trivial, add a blank line and 1 to 4 short bullet lines saying what changed and why. Match the style of the recent commit subjects (for example conventional commits such as "feat: ..." if they use that).',
    `Recent commit subjects:\n${r.data.recent || '(none yet)'}\n\n${r.data.staged ? 'Staged' : 'All'} changes:\n${r.data.stat}\n\n${r.data.diff}`)
  return clean(out)
}

/** A pull request title and description for everything on this branch. */
export async function aiPrText(cwd: string): Promise<string> {
  const k = koko()
  const r = await k?.git.branchchanges({ cwd })
  if (!r?.ok) throw new Error(r && !r.ok ? r.error.message : 'Not available here.')
  const m = model()
  const out = await completeText(m.p, m.model,
    'You write pull request descriptions. Reply with ONLY the text, no code fences. First line: the PR title (imperative, under 72 characters). Then a blank line and a Markdown body with the sections "## Summary" (1 to 3 sentences) and "## Changes" (short bullets), and "## Testing" only if the commits mention tests or you can say how to check it.',
    `Branch ${r.data.branch} compared with ${r.data.base}.\n\nCommits:\n${r.data.log}\n\nFiles:\n${r.data.stat}\n\n${r.data.diff}`)
  return clean(out)
}
