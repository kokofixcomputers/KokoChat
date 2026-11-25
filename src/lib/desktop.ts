/** The bridge the Electron shell exposes (see electron/preload.cjs). Undefined in a normal browser. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { message: string; code: string } }

export interface DiffLine { t: ' ' | '+' | '-'; n: number; s: string }
export interface Diff { added: number; removed: number; lines: DiffLine[]; truncated: boolean; firstLine: number }

export interface QuickPayload { text: string; image?: string; providerId?: string; model?: string }

export interface GitFile { path: string; status: string; staged: boolean; unstaged: boolean; added?: number; removed?: number }
export interface GitStatus { isRepo: boolean; branch?: string; upstream?: string; ahead?: number; behind?: number; files: GitFile[] }

interface Paths { cwd: string; allowOutside?: boolean }

export interface KokoApi {
  isElectron: true
  platform: string
  pickFolder: () => Promise<string | null>
  reveal: (p: string) => Promise<void>
  openFolder: (p: string) => Promise<string | void>
  fs: {
    read: (a: Paths & { path: string; offset?: number; limit?: number }) => Promise<IpcResult<{ path: string; totalLines: number; from: number; to: number; text: string; truncated: boolean }>>
    write: (a: Paths & { turn?: string; path: string; content: string; guard?: boolean; overwrite?: boolean }) => Promise<IpcResult<{ path: string; created: boolean; unchanged?: boolean; bytes: number; diff: Diff; totalLines?: number; preview?: string; syntax?: string }>>
    append: (a: Paths & { turn?: string; path: string; content: string; position?: 'start' | 'end' }) => Promise<IpcResult<{ path: string; diff: Diff; bytes: number; totalLines: number; unchanged?: boolean; preview?: string; syntax?: string }>>
    edit: (a: Paths & { turn?: string; path: string; oldString: string; newString: string; replaceAll?: boolean }) => Promise<IpcResult<{ path: string; replaced: number; diff: Diff; totalLines?: number; matched?: string; syntax?: string }>>
    writeBase64: (a: Paths & { turn?: string; path: string; base64: string }) => Promise<IpcResult<{ path: string; bytes: number; created: boolean }>>
    list: (a: Paths & { path?: string; depth?: number }) => Promise<IpcResult<{ path: string; text: string; count: number }>>
    find: (a: Paths & { pattern: string; path?: string }) => Promise<IpcResult<{ path: string; files: string[]; truncated: boolean }>>
    tree: (a: Paths & { path?: string }) => Promise<IpcResult<{ path: string; entries: { name: string; type: 'dir' | 'file'; size?: number; hidden?: boolean }[]; truncated: boolean }>>
    readRaw: (a: Paths & { path: string }) => Promise<IpcResult<{ path: string; size: number; text?: string; image?: string; binary?: boolean; truncated?: boolean }>>
    search: (a: Paths & { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; context?: number }) => Promise<IpcResult<{ path: string; files: number; matches: number; text: string; truncated: boolean }>>
  }
  quick: {
    submit: (p: QuickPayload) => void
    hide: () => void
    resize: (h: number) => void
    capture: () => Promise<{ dataUrl?: string; cancelled?: boolean; error?: string }>
    openScreenSettings: () => Promise<void>
    onShow: (cb: () => void) => () => void
    onHide: (cb: () => void) => () => void
    onSubmit: (cb: (p: QuickPayload) => void) => () => void
    getConfig: () => Promise<{ enabled: boolean; shortcut: string; menuBar: boolean; registered: boolean; defaultShortcut: string }>
    setConfig: (c: { enabled?: boolean; shortcut?: string; menuBar?: boolean }) => Promise<{ enabled: boolean; shortcut: string; menuBar: boolean; registered: boolean; error?: string | null }>
    selectReady: () => void
    selectDone: (rect: { x: number; y: number; w: number; h: number } | null) => void
    onSelectImage: (cb: (p: { dataUrl: string }) => void) => () => void
  }
  git: {
    status: (a: { cwd: string }) => Promise<IpcResult<GitStatus>>
    diff: (a: { cwd: string; path: string; status?: string }) => Promise<IpcResult<{ text: string; binary?: boolean; truncated?: boolean; untracked?: boolean }>>
    stage: (a: { cwd: string; paths?: string[]; all?: boolean }) => Promise<IpcResult<true>>
    unstage: (a: { cwd: string; paths?: string[]; all?: boolean }) => Promise<IpcResult<true>>
    discard: (a: { cwd: string; paths: string[] }) => Promise<IpcResult<true>>
    commit: (a: { cwd: string; message: string; stageAll?: boolean }) => Promise<IpcResult<{ hash: string; summary: string }>>
    branches: (a: { cwd: string }) => Promise<IpcResult<{ branches: { name: string; current: boolean; upstream: string }[] }>>
    checkout: (a: { cwd: string; branch: string; create?: boolean }) => Promise<IpcResult<true>>
    push: (a: { cwd: string }) => Promise<IpcResult<{ output: string }>>
    pull: (a: { cwd: string }) => Promise<IpcResult<{ output: string }>>
    log: (a: { cwd: string; n?: number }) => Promise<IpcResult<{ commits: { hash: string; subject: string; author: string; when: string }[] }>>
    changes: (a: { cwd: string }) => Promise<IpcResult<{ stat: string; diff: string; recent: string; staged: boolean }>>
    branchchanges: (a: { cwd: string }) => Promise<IpcResult<{ base: string; branch: string; log: string; stat: string; diff: string }>>
  }
  checkpoint: {
    info: (a: { key: string; cwd?: string }) => Promise<IpcResult<{ files: string[]; reverted: boolean; count: number }>>
    revert: (a: { key: string; force?: boolean }) => Promise<IpcResult<{ restored: number; deleted: number; conflicts: string[]; already?: boolean }>>
  }
  project: { context: (a: { cwd: string }) => Promise<IpcResult<{ cwd: string; instructions: string; top: string[]; git: { branch: string; dirty: number } | null; platform: string; shell: string; home: string }>> }
  term: {
    open: (a: { id: string; cwd?: string; cols: number; rows: number }) => Promise<IpcResult<{ pid?: number; shell?: string; reused?: boolean }>>
    write: (a: { id: string; data: string }) => void
    resize: (a: { id: string; cols: number; rows: number }) => void
    kill: (a: { id: string }) => void
    onData: (cb: (d: { id: string; data: string }) => void) => () => void
    onExit: (cb: (d: { id: string; code: number }) => void) => () => void
  }
  browser: (op: 'exec' | 'shot' | 'click' | 'text' | 'key' | 'scroll', id: number, args?: Record<string, unknown>) => Promise<IpcResult<any>>
  oauth: { popup: (a: { url: string; redirectUri: string }) => Promise<{ code?: string; state?: string; error?: string }> }
  notify: {
    show: (p: { id: string; title: string; body: string; actions?: string[]; sound?: boolean }) => Promise<boolean>
    close: (id: string) => void
    onEvent: (cb: (e: { id: string; type: 'click' | 'action'; index?: number }) => void) => () => void
  }
  onCloseRequest: (cb: (running: number) => void) => () => void
  closeAnswer: (ok: boolean) => void
  onOpenSettings: (cb: () => void) => () => void
  onBrowserOpen: (cb: (url: string) => void) => () => void
  shell: {
    run: (a: { id: string; cwd: string; command: string; timeoutMs?: number }) => Promise<IpcResult<{ exitCode: number | null; signal: string | null; output: string; timedOut: boolean; killed: boolean }>>
    kill: (id: string) => Promise<boolean>
    onData: (cb: (d: { id: string; chunk: string }) => void) => () => void
  }
}

declare global { interface Window { koko?: KokoApi } }

export const koko = (): KokoApi | undefined => (typeof window !== 'undefined' ? window.koko : undefined)
export const isDesktop = () => !!koko()?.isElectron

export const baseName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
