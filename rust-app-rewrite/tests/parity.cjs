// Runs the same Code-mode operations through the Electron code (electron/*.cjs) and the Rust port, on two identical
// project folders, and compares what comes back and what ends up on disk.   Usage: node tests/parity.cjs
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const js = require(path.join(root, 'electron/tools.cjs'))
const cp = require(path.join(root, 'electron/checkpoints.cjs'))
execFileSync('cargo', ['build', '-q', '--example', 'cli'], { cwd: path.resolve(__dirname, '../src-tauri'), stdio: 'inherit' })

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'koko-parity-')))
const A = path.join(tmp, 'a/proj'), B = path.join(tmp, 'b/proj')
const SRC = 'function a() {\n  const x = 1\n  return x\n}\n\nfunction b() {\n\tconst y = 2\n\treturn y\n}\n'
const many = Array.from({ length: 24 }, (_, i) => `export function f${i}() { return ${i} }`).join('\n') + '\n'
function seed(dir) {
  const w = (n, c) => { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), c) }
  w('src/app.js', SRC); w('src/crlf.js', SRC.replace(/\n/g, '\r\n')); w('src/lib.ts', many); w('README.md', '# Hi\n\nTODO: write\n'); w('CLAUDE.md', 'Be nice.\n')
  w('data/bin.dat', Buffer.from([0, 1, 2, 3])); w('node_modules/x/index.js', 'TODO hidden\n'); w('file2.txt', 'two\n'); w('file10.txt', 'ten\n'); w('uni.txt', 'héllo 🌍 wörld\n')
  fs.writeFileSync(path.join(path.dirname(dir), 'outside.txt'), 'secret')
  fs.symlinkSync(path.dirname(dir), path.join(dir, 'escape'))
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@example.com'); git('config', 'user.name', 'T'); git('add', '-A'); git('commit', '-qm', 'first')
}
seed(A); seed(B)
cp.init(path.join(tmp, 'cp-js'))
const rust = spawn(path.resolve(__dirname, '../src-tauri/target/debug/examples/cli'), [path.join(tmp, 'cp-rs')], { stdio: ['pipe', 'pipe', 'inherit'] })
const waiting = []; let buf = ''
rust.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { waiting.shift()(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1) } })
const callRust = (op, args) => new Promise((r) => { waiting.push(r); rust.stdin.write(JSON.stringify({ op, args }) + '\n') })

const tracked = (fn) => async (a) => {
  if (!a.turn) return fn(a)
  const abs = js.resolveIn(a.cwd, a.path, a.allowOutside).abs
  await cp.before(a.turn, abs); try { return await fn(a) } finally { await cp.after(a.turn, abs) }
}
const JS = {
  'fs:read': js.readFile, 'fs:write': tracked(js.writeFile), 'fs:append': tracked(js.appendFile), 'fs:edit': tracked(js.editFile), 'fs:writeBase64': tracked(js.writeBase64),
  'fs:list': js.listFiles, 'fs:find': js.findFiles, 'fs:search': js.searchCode, 'fs:tree': js.readTree, 'fs:readRaw': js.readRaw, 'project:context': js.projectContext,
  'git:status': js.gitStatus, 'git:diff': js.gitDiff, 'git:stage': js.gitStage, 'git:unstage': js.gitUnstage, 'git:discard': js.gitDiscard, 'git:commit': js.gitCommit,
  'git:branches': js.gitBranches, 'git:checkout': js.gitCheckout, 'git:log': js.gitLog, 'git:changes': js.gitChangeText, 'git:branchchanges': js.gitBranchChanges,
  'checkpoint:info': (a) => cp.info(a.key, a.cwd), 'checkpoint:revert': (a) => cp.revert(a.key, !!a.force),
  'shell:run': (a) => js.runCommand(a),
}
async function callJs(op, args) {
  try { return { ok: true, data: await JS[op](args) } } catch (e) { return { ok: false, error: { message: String(e.message), code: e.code && typeof e.code === 'string' ? e.code : 'ERR' } } }
}
// the two folders differ in name, commit hashes and times differ, and list order from the disk may differ
const norm = (v, dir, op) => {
  let s = JSON.stringify(v, (k, x) => {
    if (k === 'hash' || k === 'when' || k === 'streamed') return undefined
    if (x && typeof x === 'object' && !Array.isArray(x)) return Object.fromEntries(Object.keys(x).sort().filter((q) => x[q] !== undefined).map((q) => [q, x[q]]))
    return x
  }).split(dir).join('<proj>').split(path.dirname(dir)).join('<parent>')
  if (op === 'fs:search') { const o = JSON.parse(s); if (o.data) o.data.text = o.data.text.split('\n').sort().join('\n'); s = JSON.stringify(o) }
  if (op === 'checkpoint:info' || op === 'checkpoint:revert') { const o = JSON.parse(s); o.data?.files?.sort(); s = JSON.stringify(o) }
  if (op.startsWith('git:')) s = s.replace(/index [0-9a-f]+\.\.[0-9a-f]+/g, 'index X')
  return s
}

const cases = [
  ['fs:read', { path: 'src/app.js' }], ['fs:read', { path: 'src/app.js', offset: 3, limit: 2 }], ['fs:read', { path: 'uni.txt' }], ['fs:read', { path: 'nope.js' }], ['fs:read', { path: 'src' }], ['fs:read', { path: 'data/bin.dat' }],
  ['fs:read', { path: '../outside.txt' }, 'outside: parent'], ['fs:read', { path: 'escape/outside.txt' }, 'outside: symlink'], ['fs:write', { path: 'escape/new.txt', content: 'x' }, 'outside: new file through link'], ['fs:write', { path: '/etc/koko-parity', content: 'x' }],
  ['fs:write', { path: 'src/lib.ts', content: 'export const V = 1\n', guard: true, turn: 't1' }, 'clobber refused'], ['fs:append', { path: 'src/lib.ts', content: 'export const VERSION = 1\n', turn: 't1' }],
  ['fs:append', { path: 'src/lib.ts', content: 'export const VERSION = 1\n', turn: 't1' }, 'append twice'], ['fs:append', { path: 'src/lib.ts', content: '// top\n', position: 'start', turn: 't1' }],
  ['fs:write', { path: 'new/deep/file.txt', content: 'hello\n', guard: true, turn: 't1' }], ['fs:write', { path: 'new/deep/file.txt', content: 'hello\n', guard: true }, 'identical'],
  ['fs:edit', { path: 'src/app.js', oldString: '  const x = 1\n  return x', newString: '  const x = 10\n  return x', turn: 't1' }], ['fs:edit', { path: 'src/crlf.js', oldString: '  const x = 1\n  return x', newString: '  const x = 11\n  return x', turn: 't1' }],
  ['fs:edit', { path: 'src/app.js', oldString: '2\t  const x = 10\n3\t  return x', newString: '2\t  const x = 12\n3\t  return x', turn: 't1' }, 'line numbers'], ['fs:edit', { path: 'src/app.js', oldString: 'const x = 12\nreturn x', newString: 'const x = 13\nreturn x', turn: 't1' }, 'indent lost'],
  ['fs:edit', { path: 'src/app.js', oldString: '    const y = 2\n    return y', newString: '    const y = 14\n    return y', turn: 't1' }, 'tabs as spaces'], ['fs:edit', { path: 'src/app.js', oldString: '  const x = 13;\n  return xx', newString: 'q' }, 'near miss'],
  ['fs:edit', { path: 'src/app.js', oldString: 'zzzzzz', newString: 'q' }, 'not found'], ['fs:edit', { path: 'src/app.js', oldString: 'return', newString: 'give' }, 'ambiguous'], ['fs:edit', { path: 'src/app.js', oldString: 'return', newString: 'return ', replaceAll: true, turn: 't1' }], ['fs:edit', { path: 'src/app.js', oldString: '', newString: 'q' }],
  ['fs:write', { path: 'bad.json', content: '{"a":1}' }, 'json ok'], ['fs:write', { path: 'ok.cjs', content: 'module.exports = 1\n' }], ['fs:write', { path: 'esm.js', content: 'export const a = 1\n' }],
  ['fs:writeBase64', { path: 'img/p.png', base64: 'iVBORw0KGgo=', turn: 't1' }], ['fs:readRaw', { path: 'img/p.png' }], ['fs:readRaw', { path: 'data/bin.dat' }], ['fs:readRaw', { path: 'README.md' }],
  ['fs:list', {}], ['fs:list', { path: 'src', depth: 1 }], ['fs:list', { path: 'README.md' }], ['fs:tree', {}], ['fs:tree', { path: 'src' }],
  ['fs:find', { pattern: '**/*.js' }], ['fs:find', { pattern: '*.{ts,md}' }], ['fs:find', { pattern: 'src/*.js' }], ['fs:search', { pattern: 'TODO' }], ['fs:search', { pattern: 'const (x|y)', context: 1, glob: '*.js' }], ['fs:search', { pattern: 'FUNCTION', ignoreCase: true, path: 'src/app.js' }], ['fs:search', { pattern: 'a(' }, 'bad regex'],
  ['project:context', {}], ['git:status', {}], ['git:diff', { path: 'src/lib.ts', status: 'M' }], ['git:diff', { path: 'new/deep/file.txt', status: 'U' }], ['git:changes', {}],
  ['checkpoint:info', { key: 't1' }], ['checkpoint:revert', { key: 't1' }], ['git:status', {}, 'after undo'], ['checkpoint:revert', { key: 't1' }, 'already'], ['checkpoint:info', { key: 'none' }],
  ['git:stage', { paths: ['ok.cjs', '--force'] }], ['git:status', {}], ['git:unstage', { all: true }], ['git:discard', { paths: ['ok.cjs', 'bad.json'] }], ['git:status', {}], ['git:commit', { message: '  ' }], ['git:commit', { message: 'nothing staged' }], ['git:commit', { message: 'second', stageAll: true }], ['git:log', { n: 5 }], ['git:branches', {}],
  ['git:checkout', { branch: '-x' }], ['git:checkout', { branch: 'a..b' }], ['git:branchchanges', {}, 'no base'], ['git:checkout', { branch: 'feat/one', create: true }], ['fs:write', { path: 'feature.txt', content: 'f\n' }], ['git:commit', { message: 'feature', stageAll: true }], ['git:branchchanges', {}],
  ['shell:run', { id: '1', command: 'echo out; echo err >&2; exit 3' }], ['shell:run', { id: '2', command: 'printf "%s" "$PAGER $TERM $GIT_TERMINAL_PROMPT"' }], ['shell:run', { id: '3', command: 'sleep 20', timeoutMs: 1200 }, 'timeout'], ['shell:run', { id: '4', command: 'head -c 150000 /dev/zero | tr "\\0" a' }, 'long output'],
]
;(async () => {
  let pass = 0; const fails = []
  for (const [op, a, note] of cases) {
    const x = norm(await callJs(op, { cwd: A, ...a }), A, op)
    const y = norm(await callRust(op, { cwd: B, ...a }), B, op)
    if (x === y) pass++
    else { let i = 0; while (x[i] === y[i]) i++; fails.push(`${op} ${note || JSON.stringify(a).slice(0, 80)}\n   electron: …${x.slice(Math.max(0, i - 60), i + 220)}\n   rust    : …${y.slice(Math.max(0, i - 60), i + 220)}`) }
  }
  const tree = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== '.git' && !e.isSymbolicLink()).flatMap((e) => e.isDirectory() ? tree(path.join(d, e.name), base) : [[path.relative(base, path.join(d, e.name)), fs.readFileSync(path.join(d, e.name)).toString('base64')]]).sort()
  const same = JSON.stringify(tree(A)) === JSON.stringify(tree(B))
  console.log(`${pass}/${cases.length} operations identical; final files on disk ${same ? 'identical' : 'DIFFER'}`)
  console.log(fails.join('\n'))
  rust.kill(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(fails.length || !same ? 1 : 0)
})()
