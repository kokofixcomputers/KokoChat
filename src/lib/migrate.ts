/** Moving everything from the Electron app into the Rust app. Only does anything inside the Rust shell. */
import { isTauri } from './tauri'

export interface MigrateStatus { found: boolean; dataPath: string; exporter: string | null; oldAppOnly: boolean; running: boolean; installed: string[]; cleanup: string[] }
export interface MigrateResult { chats: number; providers: number; at: number }

const PENDING = 'koko:migrate:pending', DONE = 'koko:migrate:done'
const STAGE = 'koko-migrate' // its own database: the running app never writes to it

const invoke = async <T,>(cmd: string) => (await import('@tauri-apps/api/core')).invoke<T>(cmd)
export const migrateStatus = () => invoke<MigrateStatus>('migrate_status')
export const cleanupElectron = () => invoke<string[]>('migrate_cleanup')
export const lastMigration = (): MigrateResult | null => { try { return JSON.parse(localStorage.getItem(DONE) ?? 'null') } catch { return null } }

const wait = <T,>(q: IDBRequest<T>) => new Promise<T>((res, rej) => { q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
async function database(name: string, store: string) {
  const q = indexedDB.open(name)
  q.onupgradeneeded = () => q.result.createObjectStore(store)
  return wait(q)
}
async function transact(name: string, store: string, fn: (s: IDBObjectStore) => void) {
  const db = await database(name, store)
  await new Promise<void>((res, rej) => { const t = db.transaction(store, 'readwrite'); fn(t.objectStore(store)); t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error) })
  db.close()
}
async function readKey(name: string, store: string, key: string) {
  const db = await database(name, store)
  const v = await wait(db.transaction(store).objectStore(store).get(key))
  db.close()
  return v as unknown
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
/** the reverse of the tagging in electron/export.cjs */
export function unpack(v: any): any {
  if (Array.isArray(v)) return v.map(unpack)
  if (!v || typeof v !== 'object') return v
  if (v.__koko === 'blob') return new Blob([bytes(v.data)], { type: v.type })
  if (v.__koko === 'buffer') return bytes(v.data).buffer
  if (v.__koko === 'view') { const buf = bytes(v.data).buffer; const C = (globalThis as any)[v.kind]; return v.kind === 'DataView' ? new DataView(buf) : new C(buf) }
  if (v.__koko === 'date') return new Date(v.time)
  if (v.__koko === 'map') return new Map(unpack(v.entries))
  if (v.__koko === 'set') return new Set(unpack(v.values))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]))
}

function parseExport(text: string) {
  const data = JSON.parse(text)
  if (data?.format !== 'koko-export' || !Array.isArray(data.idb)) throw new Error('The export from the Electron app is not in the expected format.')
  const main = data.idb.find(([k]: [string]) => k === 'kokochat-v1')?.[1]
  if (typeof main !== 'string') throw new Error('The Electron app has no saved chats or settings to move.')
  const state = JSON.parse(main).state ?? {}
  return { data, chats: (state.chats ?? []).length as number, providers: (state.providers ?? []).length as number }
}

/** Step 1: have the Electron app export, check the result, park it, and restart the interface so nothing overwrites it. */
export async function startMigration() {
  const text = await invoke<string>('migrate_export')
  parseExport(text) // fail here, with nothing changed, if the export is unusable
  await transact(STAGE, 'kv', (s) => { s.put(text, 'export') })
  localStorage.setItem(PENDING, '1')
  location.reload()
}

/** Step 2, before the app loads: replace this app's data with the export. The data it replaces is kept as a backup. */
export async function applyPendingMigration() {
  if (!isTauri() || localStorage.getItem(PENDING) !== '1') return
  try {
    const text = await readKey(STAGE, 'kv', 'export')
    if (typeof text !== 'string') return
    const { data, chats, providers } = parseExport(text)
    const previous = await readKey('keyval-store', 'keyval', 'kokochat-v1')
    if (previous !== undefined) await transact(STAGE, 'kv', (s) => { s.put(previous, 'backup') })
    const entries: [IDBValidKey, unknown][] = data.idb.map(([k, v]: [IDBValidKey, unknown]) => [k, unpack(v)])
    await transact('keyval-store', 'keyval', (s) => { for (const [k, v] of entries) s.put(v, k) }) // all or nothing
    for (const [k, v] of Object.entries(data.local as Record<string, string>)) if (!k.startsWith('koko:migrate')) localStorage.setItem(k, v)
    localStorage.setItem(DONE, JSON.stringify({ chats, providers, at: Date.now() }))
    sessionStorage.setItem('koko:migrate:just', '1')
    await invoke('migrate_done')
  } catch (e) {
    console.error(e)
    sessionStorage.setItem('koko:migrate:error', String((e as Error)?.message ?? e))
  } finally {
    localStorage.removeItem(PENDING)
    await transact(STAGE, 'kv', (s) => { s.delete('export') }).catch(() => {}) // it holds API keys: do not keep it
  }
}
