import { useEffect, useState } from 'react'
import { ArrowRightLeft, Loader2, Trash2 } from 'lucide-react'
import { cleanupElectron, lastMigration, migrateStatus, startMigration, type MigrateStatus } from '../lib/migrate'
import { isTauri } from '../lib/tauri'
import { askConfirm } from '../lib/confirm'
import { toast } from '../lib/toast'
import { useStore } from '../store'

const list = (paths: string[]) => paths.map((p) => `• ${p}`).join('\n')

async function offerCleanup(after?: () => void) {
  const s = await migrateStatus()
  if (!s.cleanup.length) return
  if (!(await askConfirm(`Move the Electron app's leftovers to the Trash?\n\n${list(s.cleanup)}\n\nThis includes the Electron app's saved chats and keys. Check that everything is here first; until you empty the Trash you can put them back.`, { title: 'Clean up Electron', confirmLabel: 'Move to Trash', cancelLabel: 'Keep Electron', danger: true }))) return
  try { const moved = await cleanupElectron(); toast.success(`Moved ${moved.length} item${moved.length === 1 ? '' : 's'} to the Trash`); after?.() } catch (e) { toast.error(String(e)) }
}

/** Settings → General, only in the Rust app and only when the Electron app saved data on this computer. */
export function MigrationSection() {
  const [s, setS] = useState<MigrateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const done = lastMigration()
  const refresh = () => { if (isTauri()) migrateStatus().then(setS).catch(() => {}) }
  useEffect(refresh, [])
  if (!s?.found) return null

  const migrate = async () => {
    const now = await migrateStatus()
    setS(now)
    if (now.running) return void toast.error('Quit the Electron Koko app first (Cmd+Q), then try again.')
    if (!now.exporter) return void toast.error(now.oldAppOnly ? 'Your Electron app is too old to export. Rebuild it with npm run electron:pack, then try again.' : 'The Electron app was not found. It is needed to read its data.')
    const here = useStore.getState().chats.filter((c) => c.messages.length).length
    if (!(await askConfirm(`Bring everything over from the Electron app: chats, providers and keys, settings, files, memory and undo history.\n\n${here ? `The ${here} chat${here === 1 ? '' : 's'} and the settings in this app will be replaced (a backup is kept).` : 'The settings in this app will be replaced.'} The Electron app is not changed.`, { title: 'Migrate from Electron?', confirmLabel: 'Migrate everything', danger: here > 0 }))) return
    setBusy(true)
    try { await startMigration() } catch (e) { toast.error(String((e as Error)?.message ?? e)); setBusy(false) }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/50 p-4">
      <div>
        <div className="text-sm font-medium">Move from the Electron app</div>
        <div className="mt-0.5 text-xs text-muted">{done ? `Migrated ${done.chats} chats and ${done.providers} providers on ${new Date(done.at).toLocaleString()}. Check that everything is here before cleaning up.` : 'The Electron version of Koko has saved data on this computer. You can bring all of it into this app.'}</div>
        <div className="mt-1 break-all text-xs text-faint">{s.dataPath}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => void migrate()} className="flex h-9 items-center gap-2 rounded-full bg-fg px-4 text-sm font-medium text-bg transition active:scale-95 disabled:opacity-50">{busy ? <Loader2 size={14} className="spin" /> : <ArrowRightLeft size={14} />}{busy ? 'Reading Electron data…' : done ? 'Migrate again' : 'Migrate from Electron'}</button>
        {done && <button onClick={() => void offerCleanup(refresh)} className="flex h-9 items-center gap-2 rounded-full bg-danger/10 px-4 text-sm font-medium text-danger transition hover:bg-danger/20 active:scale-95"><Trash2 size={14} />Clean up Electron</button>}
      </div>
    </section>
  )
}

/** Right after the restart that applied a migration: say how it went, and ask about cleaning up. */
export function useMigrationResult(ready: boolean) {
  useEffect(() => {
    if (!ready || !isTauri()) return
    const take = (k: string) => { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v }
    const error = take('koko:migrate:error')
    if (error) return void toast.error(`Migration failed: ${error}`)
    if (!take('koko:migrate:just')) return
    const r = lastMigration()
    toast.success(`Migrated ${r?.chats ?? 0} chats and ${r?.providers ?? 0} providers from Electron`)
    void offerCleanup()
  }, [ready])
}
