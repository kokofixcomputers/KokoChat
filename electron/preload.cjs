'use strict'
const { contextBridge, ipcRenderer } = require('electron')

const call = (channel) => (args) => ipcRenderer.invoke(channel, args)

contextBridge.exposeInMainWorld('koko', {
  isElectron: true,
  setBusy: (n) => ipcRenderer.send('koko:busy', n),
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('koko:pick-folder'),
  reveal: (p) => ipcRenderer.invoke('koko:reveal', p),
  openFolder: (p) => ipcRenderer.invoke('koko:open-folder', p),
  fs: {
    read: call('koko:fs:read'),
    write: call('koko:fs:write'),
    edit: call('koko:fs:edit'),
    append: call('koko:fs:append'),
    writeBase64: call('koko:fs:write-base64'),
    list: call('koko:fs:list'),
    find: call('koko:fs:find'),
    search: call('koko:fs:search'),
    tree: call('koko:fs:tree'),
    readRaw: call('koko:fs:readraw'),
  },
  git: Object.fromEntries(['status', 'diff', 'stage', 'unstage', 'discard', 'commit', 'branches', 'checkout', 'push', 'pull', 'log', 'changes', 'branchchanges'].map((n) => [n, call('koko:git:' + n)])),
  quick: {
    // for the floating window
    submit: (p) => ipcRenderer.send('koko:quick:submit', p),
    hide: () => ipcRenderer.send('koko:quick:hide'),
    resize: (h) => ipcRenderer.send('koko:quick:resize', h),
    capture: () => ipcRenderer.invoke('koko:quick:capture'),
    openScreenSettings: () => ipcRenderer.invoke('koko:quick:open-screen-settings'),
    onShow: (cb) => { const f = () => cb(); ipcRenderer.on('koko:quick:show', f); return () => ipcRenderer.removeListener('koko:quick:show', f) },
    // for the main window
    onSubmit: (cb) => { const f = (_e, p) => cb(p); ipcRenderer.on('koko:quick:submit', f); return () => ipcRenderer.removeListener('koko:quick:submit', f) },
    getConfig: () => ipcRenderer.invoke('koko:quick:get'),
    setConfig: (c) => ipcRenderer.invoke('koko:quick:set', c),
    // for the screenshot overlay
    selectReady: () => ipcRenderer.send('koko:select:ready'),
    selectDone: (rect) => ipcRenderer.send('koko:select:done', rect),
    onSelectImage: (cb) => { const f = (_e, p) => cb(p); ipcRenderer.on('koko:select:image', f); return () => ipcRenderer.removeListener('koko:select:image', f) },
  },
  checkpoint: { info: call('koko:checkpoint:info'), revert: call('koko:checkpoint:revert') },
  project: { context: call('koko:project:context') },
  term: {
    open: (a) => ipcRenderer.invoke('koko:pty:open', a),
    write: (a) => ipcRenderer.send('koko:pty:write', a),
    resize: (a) => ipcRenderer.send('koko:pty:resize', a),
    kill: (a) => ipcRenderer.send('koko:pty:kill', a),
    onData: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('koko:pty:data', f); return () => ipcRenderer.removeListener('koko:pty:data', f) },
    onExit: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('koko:pty:exit', f); return () => ipcRenderer.removeListener('koko:pty:exit', f) },
  },
  browser: (op, id, args) => ipcRenderer.invoke('koko:browser', { op, id, args }),
  oauth: { popup: (a) => ipcRenderer.invoke('koko:oauth:popup', a) },
  notify: {
    show: (p) => ipcRenderer.invoke('koko:notify:show', p),
    close: (id) => ipcRenderer.send('koko:notify:close', id),
    onEvent: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('koko:notify:event', f); return () => ipcRenderer.removeListener('koko:notify:event', f) },
  },
  onCloseRequest: (cb) => { const f = (_e, n) => cb(n); ipcRenderer.on('koko:close-request', f); return () => ipcRenderer.removeListener('koko:close-request', f) },
  closeAnswer: (ok) => ipcRenderer.send('koko:close-answer', !!ok),
  onOpenSettings: (cb) => { const f = () => cb(); ipcRenderer.on('koko:open-settings', f); return () => ipcRenderer.removeListener('koko:open-settings', f) },
  onBrowserOpen: (cb) => { const f = (_e, u) => cb(u); ipcRenderer.on('koko:browser:open', f); return () => ipcRenderer.removeListener('koko:browser:open', f) },
  shell: {
    run: call('koko:shell:run'),
    kill: (id) => ipcRenderer.invoke('koko:shell:kill', id),
    /** live output of a running command */
    onData: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('koko:shell:data', f); return () => ipcRenderer.removeListener('koko:shell:data', f) },
  },
})
