import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile, writeFile, appendFile, mkdir, mkdtemp, symlink, rm, lstat, realpath, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, dirname, join, extname } from 'node:path'

// CI-only native-browser proof. No npm install, hosted client, credentials or deployment.
const root = process.cwd(), testDir = resolve(root, 'tests/catalogue-browser')
const output = resolve(root, 'scale-results/catalogue-browser')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
const ownedFiles = ['index.html', 'harness.tsx', 'fixture.tsx', 'vite.config.ts', 'source-manifest.json', 'run.mjs'].map(name => `tests/catalogue-browser/${name}`)
const workflowFiles = ['.github/workflows/pilot-safety.yml', 'tests/co/ci-workflow.test.ts']
const report = { version: 1, status: 'failed', assertions: [], screenshots: [], networkViolations: [], source: [], harness: [] }
let temporary, browser, server, socket, cdp, fatal, activeSession, ownsOutput = false, proofComplete = false
const pending = new Map(), sessions = new Map(), eventTasks = new Set()
// CDP's browser/tab defaults plus Chromium's internal WebUI, never application workers.
// https://github.com/ChromeDevTools/devtools-protocol/blob/master/pdl/domains/Target.pdl
// https://chromium.googlesource.com/chromium/src/+/a24f112f7dcefa1402ba08df5f325679679e44fc%5E%21/
const targetFilter = [{ type: 'browser', exclude: true }, { type: 'tab', exclude: true }, { type: 'browser_ui', exclude: true }, {}]
let sequence = 0
const safeEnv = home => ({ PATH: process.env.PATH, HOME: home, TMPDIR: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', NODE_ENV: 'production' })
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' }
const git = args => execFileSync('git', args, { cwd: root, env: gitEnv, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function check() { if (fatal) throw Error(fatal); assert.deepEqual(report.networkViolations, [], 'Browser target or request isolation guard refused') }
async function waitFor(action, label, timeout = 15000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { check(); if (await action()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  throw Error(`Timed out: ${label}`)
}
async function evaluate(session, expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
  if (result.exceptionDetails) throw Error(`Browser evaluation failed: ${result.exceptionDetails.text}`)
  return result.result.value
}
async function key(session, name, code, virtual, modifiers = 0) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtual, modifiers }, session)
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtual, modifiers }, session)
}
const button = text => `Array.from(document.querySelectorAll('button')).find(node => node.textContent.trim() === ${JSON.stringify(text)})`
async function click(session, expression) {
  await cdp('Page.bringToFront', {}, session)
  await waitFor(() => evaluate(session, `!!(${expression}) && !(${expression}).disabled`), 'requested native control enabled after focus')
  const box = await evaluate(session, `(async () => { const node = (${expression}); if (!node || node.disabled) throw Error('Enabled control missing'); node.scrollIntoView({block:'center'}); await new Promise(requestAnimationFrame); const b=node.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2,width:b.width,height:b.height}; })()`)
  assert.ok(box.width > 0 && box.height > 0, 'Control must have real geometry')
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, session)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, session)
}
async function clickText(session, text) { await click(session, button(text)) }
async function selectIndex(session, selector, index) {
  await click(session, `document.querySelector(${JSON.stringify(selector)})`)
  await key(session, 'Home', 'Home', 36)
  for (let i = 0; i < index; i++) await key(session, 'ArrowDown', 'ArrowDown', 40)
  await key(session, 'Enter', 'Enter', 13)
}
const ledgerExpression = `JSON.parse(localStorage.getItem('synthetic-browser-qa:0150feb9:server') || 'null')`
const durableExpression = `Object.keys(localStorage).filter(key => key.startsWith('catalogue-request:')).length`
async function ledger(session) { return evaluate(session, ledgerExpression) }
async function shot(session, name) {
  check(); const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session)
  const bytes = Buffer.from(result.data, 'base64'); await writeFile(join(output, name + '.png'), bytes)
  report.screenshots.push({ file: name + '.png', sha256: sha(bytes), bytes: bytes.length })
}
function proved(name, evidence = {}) { check(); report.assertions.push({ name, ...evidence }) }
async function form(session, name) {
  await waitFor(() => evaluate(session, `!!(${button('+ Tambah Pelanggan')}) && !(${button('+ Tambah Pelanggan')}).disabled`), 'customer create admitted')
  await clickText(session, '+ Tambah Pelanggan')
  await waitFor(() => evaluate(session, `!!document.querySelector('dialog:modal')`), 'native modal open')
  await click(session, `document.querySelector('#catalog-customer-name')`)
  await cdp('Input.insertText', { text: name }, session)
  await click(session, `document.querySelector('dialog select[id^="customer-category"]') || document.querySelector('dialog select')`)
  await key(session, 'End', 'End', 35); await key(session, 'Enter', 'Enter', 13)
  assert.equal(await evaluate(session, `document.querySelector('dialog select').value`), 'perorangan')
}
async function mode(session, index, expected) {
  await selectIndex(session, 'aside[aria-label="Synthetic QA controls"] select', index)
  await waitFor(async () => (await ledger(session))?.mode === expected, `fixture mode ${expected}`)
}

try {
  const outputParent = dirname(output)
  try { await mkdir(outputParent) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const parentInfo = await lstat(outputParent); assert.ok(parentInfo.isDirectory() && !parentInfo.isSymbolicLink())
  await mkdir(output); ownsOutput = true // Existing/stale/nonregular artifact output fails closed.
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.GITHUB_REPOSITORY, 'pl0203/lou_erp')
  assert.equal(process.env.GITHUB_WORKFLOW, 'Pilot safety checks')
  assert.equal(process.env.GITHUB_JOB, 'synthetic-safety')
  assert.match(process.env.GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/)
  assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9][0-9]*$/)
  assert.ok(['pull_request', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME))
  report.context = { repository: process.env.GITHUB_REPOSITORY, workflow: process.env.GITHUB_WORKFLOW, job: process.env.GITHUB_JOB, event: process.env.GITHUB_EVENT_NAME, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }
  const expected = process.env.CATALOGUE_BROWSER_SOURCE_SHA
  assert.match(expected ?? '', /^[0-9a-f]{40}$/, 'Exact immutable head is required')
  assert.equal(git(['rev-parse', 'HEAD']), expected, 'Checked out head differs')
  report.commit = expected; report.tree = git(['rev-parse', 'HEAD^{tree}'])
  async function publicBytes(path) {
    assert.ok(!path.includes('..') && !path.includes('\\') && !path.split('/').some(part => /^(?:\.env.*|\.npmrc|\.git|credentials|config)$/i.test(part)), 'Unsafe public path')
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const info = await lstat(resolve(root, ...parts.slice(0, i)))
      assert.ok(!info.isSymbolicLink() && (i === parts.length ? info.isFile() : info.isDirectory()), 'Only regular public inputs are allowed')
    }
    return readFile(resolve(root, path))
  }
  const manifestBytes = await publicBytes('tests/catalogue-browser/source-manifest.json')
  assert.equal(blob(manifestBytes), git(['rev-parse', 'HEAD:tests/catalogue-browser/source-manifest.json']))
  const manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.version, 1); assert.equal(manifest.repository, 'pl0203/lou_erp')
  report.publicSourceHead = manifest.public_source_head
  const allPaths = [...manifest.files.map(file => file.path), ...ownedFiles, ...workflowFiles]
  assert.equal(new Set(allPaths).size, allPaths.length)
  for (const path of allPaths) assert.match(path, /^(?:src\/|public\/fonts\/plus-jakarta-sans\/|tests\/catalogue-browser\/|tests\/co\/ci-workflow\.test\.ts$|\.github\/workflows\/pilot-safety\.yml$|package(?:-lock)?\.json$)/)
  const entries = git(['ls-tree', '-z', 'HEAD', '--', ...allPaths]).split('\0').filter(Boolean)
  const tracked = new Map(entries.map(entry => { const match = /^100644 blob ([a-f0-9]{40})\t([^\0]+)$/.exec(entry); assert.ok(match, 'Only exact regular public blobs allowed'); return [match[2], match[1]] }))
  assert.equal(tracked.size, allPaths.length)
  const inputs = new Map()
  for (const path of allPaths) {
    assert.ok(!path.includes('..') && !path.includes('\\'))
    const bytes = await publicBytes(path); assert.equal(blob(bytes), tracked.get(path), `Uncommitted input: ${path}`); inputs.set(path, bytes)
  }
  for (const file of manifest.files) {
    const bytes = inputs.get(file.path)
    assert.equal(blob(bytes), file.sha); assert.equal(sha(bytes), file.sha256); assert.equal(bytes.length, file.bytes)
    report.source.push({ path: file.path, git_blob: file.sha, sha256: file.sha256 })
  }
  for (const path of [...ownedFiles, ...workflowFiles]) report.harness.push({ path, git_blob: tracked.get(path), sha256: sha(inputs.get(path)) })
  proved('exact checked-out head and all public source/harness bytes bound')

  temporary = await mkdtemp(join(tmpdir(), 'catalogue-browser-'))
  const app = join(temporary, 'app'), home = join(temporary, 'home'), build = join(temporary, 'build')
  await mkdir(app); await mkdir(home)
  for (const file of manifest.files) {
    const relative = file.path.startsWith('src/') ? 'source/' + file.path : file.path
    const destination = join(app, relative); await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, inputs.get(file.path))
  }
  for (const name of ['index.html', 'harness.tsx', 'fixture.tsx', 'vite.config.ts']) await writeFile(join(app, name), inputs.get(`tests/catalogue-browser/${name}`))
  // Reuse only dependencies installed by the existing npm ci. No installation here.
  await symlink(resolve(root, 'node_modules'), join(app, 'node_modules'), 'dir')
  execFileSync(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(app, 'vite.config.ts'), '--outDir', build], { cwd: app, env: safeEnv(home), timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] })
  proved('isolated allowlist-only harness built with explicit config and sanitized environment')
  const files = new Map()
  async function index(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      if (entry.isDirectory()) await index(join(directory, entry.name), relative + '/')
      else { assert.ok(entry.isFile()); files.set('/' + relative, await readFile(join(directory, entry.name))) }
    }
  }
  await index(build)
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname
    if (request.method !== 'GET' || (!files.has(path === '/' ? '/index.html' : path) && path !== '/favicon.ico')) { report.networkViolations.push({ kind: 'unapproved-local-path', path }); response.writeHead(403).end(); return }
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'")
    response.setHeader('Cache-Control', 'no-store')
    if (path === '/favicon.ico') { response.writeHead(204).end(); return }
    const target = path === '/' ? '/index.html' : path
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' })[extname(target)] ?? 'application/octet-stream')
    response.end(files.get(target))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const chrome = await realpath('/usr/bin/google-chrome')
  const chromeInfo = await lstat(chrome)
  assert.ok(chromeInfo.isFile() && !chromeInfo.isSymbolicLink() && (chromeInfo.mode & 0o111), 'Installed Chrome launcher must be regular and executable')
  assert.ok(chrome.startsWith('/opt/google/chrome/'), 'Only the official preinstalled Chrome path is accepted')
  report.browser = { executable: chrome, version: execFileSync(chrome, ['--version'], { env: safeEnv(home), encoding: 'utf8', timeout: 10000 }).trim(), sandbox: 'default enabled', driver: 'Node built-in WebSocket / Chrome DevTools Protocol', targetFilter }
  assert.match(report.browser.version, /(?:Google Chrome|Chromium) \d+\./)
  browser = spawn(chrome, ['--headless=new', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-default-apps', 'about:blank'], { env: safeEnv(home), stdio: ['ignore', 'ignore', 'pipe'] })
  let websocketUrl, launchError
  browser.once('error', error => { launchError = error.message })
  browser.once('exit', code => { if (!websocketUrl) launchError = `Chrome exited ${code} before DevTools readiness` })
  browser.stderr.on('data', bytes => { const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/.exec(String(bytes)); if (match) websocketUrl = match[1] })
  await waitFor(() => { if (launchError) throw Error(launchError); return !!websocketUrl }, 'existing sandboxed Chrome startup')
  socket = new WebSocket(websocketUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout ${method}`)) }, 15000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  const allow = url => { try { return new URL(url).origin === origin } catch { return false } }
  socket.addEventListener('close', () => { for (const call of pending.values()) call.reject(Error('CDP connection closed')); pending.clear() })
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.id) { const call = pending.get(message.id); if (call) { pending.delete(message.id); message.error ? call.reject(Error(message.error.message)) : call.resolve(message.result) }; return }
    const task = (async () => {
      if (message.method === 'Target.attachedToTarget') {
        const { sessionId, targetInfo } = message.params
        if (targetInfo.type !== 'page') { report.networkViolations.push({ kind: 'unexpected-target', type: targetInfo.type }); await cdp('Target.closeTarget', { targetId: targetInfo.targetId }); return }
        await cdp('Network.enable', {}, sessionId); await cdp('Log.enable', {}, sessionId)
        await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId)
        await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: targetFilter }, sessionId)
        await cdp('Runtime.runIfWaitingForDebugger', {}, sessionId)
        sessions.set(targetInfo.targetId, sessionId)
      }
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params
        if (!allow(request.url)) { report.networkViolations.push({ kind: 'off-origin-request', url: request.url }); await cdp('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }, message.sessionId) }
        else await cdp('Fetch.continueRequest', { requestId }, message.sessionId)
      }
      if (message.method === 'Network.webSocketCreated') report.networkViolations.push({ kind: 'unexpected-websocket', url: message.params.url })
      if (message.method === 'Log.entryAdded' && message.params.entry.source === 'security' && message.params.entry.level === 'error') report.networkViolations.push({ kind: 'blocked-security-request', text: message.params.entry.text })
      if (message.method === 'Runtime.exceptionThrown') fatal = 'Uncaught exception in browser harness'
    })().catch(error => { fatal ??= error.message })
    eventTasks.add(task); void task.finally(() => eventTasks.delete(task))
  })
  await cdp('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: targetFilter })
  async function tab(width = 1280, height = 900) {
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' })
    await waitFor(() => sessions.has(targetId), 'guarded page target attached')
    const session = sessions.get(targetId)
    await cdp('Page.enable', {}, session); await cdp('Runtime.enable', {}, session)
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session)
    await cdp('Page.navigate', { url: origin }, session)
    await waitFor(() => evaluate(session, `!!(${button('+ Tambah Pelanggan')})`), 'real CustomerList rendered')
    return session
  }
  const a = await tab(); activeSession = a
  assert.deepEqual(await evaluate(a, `[isSecureContext, typeof navigator.locks.request, typeof HTMLDialogElement.prototype.showModal, typeof crypto.subtle.digest]`), [true, 'function', 'function', 'function'])
  await shot(a, '01-desktop-list'); proved('real source-bound CustomerList renders with native platform primitives')
  await form(a, 'Fictional Customer Alpha')
  const focusState = `(() => {
    const active = document.activeElement, modal = document.querySelector('dialog:modal');
    return { active: active ? { tag: active.tagName, id: active.id, role: active.getAttribute('role'), tabIndex: active.tabIndex } : null,
      modalControlIndex: modal ? Array.from(modal.querySelectorAll('input, select, textarea, button, a[href], [tabindex]')).indexOf(active) : -1,
      documentHasFocus: document.hasFocus(), visibility: document.visibilityState,
      modalOpen: !!modal, insideModal: !!modal && modal.contains(active) };
  })()`
  report.focusTrace = [{ phase: 'after form and before Tab', ...(await evaluate(a, focusState)) }]
  assert.equal(await evaluate(a, `document.querySelector('dialog:modal').contains(document.activeElement)`), true)
  for (let i = 0; i < 14; i++) {
    await key(a, 'Tab', 'Tab', 9)
    // Keep the original immediate containment measurement first. Later
    // observations are diagnostic only and cannot turn failure into success.
    const contained = await evaluate(a, `document.querySelector('dialog:modal').contains(document.activeElement)`)
    const observed = await evaluate(a, focusState)
    report.focusTrace.push({ phase: 'after native Tab', iteration: i + 1, containedAtAssertion: contained, ...observed })
    assert.equal(contained, true, 'Native Tab focus escaped modal')
  }
  await key(a, 'Escape', 'Escape', 27)
  await waitFor(() => evaluate(a, `!document.querySelector('dialog')`), 'idle Escape closes dialog')
  assert.equal(await evaluate(a, `document.activeElement.textContent.trim()`), '+ Tambah Pelanggan')
  proved('native modal Tab containment and Escape return focus')
  await form(a, 'Fictional Customer Alpha'); await clickText(a, 'Simpan')
  await waitFor(async () => (await ledger(a))?.attempts.length === 1 && !await evaluate(a, `!!document.querySelector('dialog')`), 'one customer create commits')
  assert.equal(Object.keys((await ledger(a)).receipts).length, 1); assert.equal((await ledger(a)).customers.length, 2)
  assert.equal(await evaluate(a, `document.activeElement.getAttribute('tabindex')`), '-1')
  await shot(a, '02-create-committed'); await clickText(a, 'Periksa hasil')
  await waitFor(() => evaluate(a, `${durableExpression} === 0 && document.body.textContent.includes('Fictional Customer Alpha')`), 'canonical create receipt acknowledged')
  proved('actual create dispatch once, committed receipt, canonical refresh and stable focus')
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, a)
  assert.equal(await evaluate(a, `document.documentElement.scrollWidth <= innerWidth`), true)
  await shot(a, '03-narrow-list'); await form(a, 'Fictional Narrow Draft')
  const geometry = await evaluate(a, `(() => {const d=document.querySelector('dialog').getBoundingClientRect(),f=document.querySelector('#catalog-customer-name');return {x:d.x,y:d.y,width:d.width,height:d.height,viewport:[innerWidth,innerHeight],inputHeight:f.getBoundingClientRect().height,inputFont:parseFloat(getComputedStyle(f).fontSize)};})()`)
  assert.ok(geometry.x >= 0 && geometry.y >= 0 && geometry.x + geometry.width <= 391 && geometry.y + geometry.height <= 845); assert.ok(geometry.inputHeight >= 44 && geometry.inputFont >= 16)
  await shot(a, '04-narrow-modal'); await clickText(a, 'Batal'); proved('390px modal geometry, readable input and no horizontal overflow', geometry)
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, a)

  await mode(a, 1, 'held'); await form(a, 'Fictional Held Customer'); await clickText(a, 'Simpan')
  await waitFor(async () => (await ledger(a))?.attempts.length === 2 && Object.keys((await ledger(a)).receipts).length === 2, 'held reply commits once')
  assert.equal(await evaluate(a, `document.querySelector('#catalog-customer-name').disabled && (${button('Batal')}).disabled`), true)
  await key(a, 'Escape', 'Escape', 27); assert.equal(await evaluate(a, `!!document.querySelector('dialog:modal')`), true)
  await shot(a, '05-held-modal')
  const b = await tab(); await clickText(b, 'Probe competing sender')
  let locks
  await waitFor(async () => { locks = await evaluate(b, `navigator.locks.query()`); return locks.held.some(lock => lock.name.startsWith('catalogue-native:')) && locks.pending.some(lock => lock.name.startsWith('catalogue-native:')) }, 'real cross-tab production lock contention')
  const held = locks.held.find(lock => lock.name.startsWith('catalogue-native:')), queued = locks.pending.find(lock => lock.name === held.name)
  assert.ok(queued); assert.notEqual(held.clientId, queued.clientId); assert.equal((await ledger(b)).attempts.length, 2)
  await shot(b, '06-two-tab-native-lock'); proved('native production lock held in A and queued in B; no second dispatch', { held, queued })
  await cdp('Page.reload', {}, a)
  await waitFor(() => evaluate(a, `!!(${button('Periksa hasil')})`), 'reload exposes durable recovery')
  await waitFor(() => evaluate(b, `document.querySelector('aside').textContent.includes('Probe: Refused:')`), 'queued real sender refuses durable request')
  assert.equal((await ledger(b)).attempts.length, 2)
  await clickText(a, 'Periksa hasil'); await waitFor(() => evaluate(a, `${durableExpression} === 0 && document.body.textContent.includes('Fictional Held Customer')`), 'reload recovered immutable receipt')
  await shot(a, '07-reload-recovered'); proved('reload preserves native storage request; receipt recovery settles without resend')
  await clickText(b, 'Release held replies')
  await mode(a, 2, 'lost'); await form(a, 'Fictional Lost Reply Customer'); await clickText(a, 'Simpan')
  await waitFor(() => evaluate(a, `!!document.querySelector('dialog:modal') && !!(${button('Periksa hasil')}) && !(${button('Periksa hasil')}).disabled`), 'lost response exposes frozen in-modal recovery')
  assert.equal((await ledger(a)).attempts.length, 3); assert.equal(Object.keys((await ledger(a)).receipts).length, 3)
  assert.equal(await evaluate(a, `document.querySelector('#catalog-customer-name').disabled`), true)
  await key(a, 'Escape', 'Escape', 27); assert.equal(await evaluate(a, `!!document.querySelector('dialog:modal')`), true)
  await shot(a, '08-lost-response-frozen'); await clickText(a, 'Periksa hasil')
  await waitFor(() => evaluate(a, `${durableExpression} === 0 && !document.querySelector('dialog')`), 'lost response receipt recovered')
  assert.equal((await ledger(a)).attempts.length, 3); proved('lost response freezes native form and recovers without raw fallback or resend')
  await mode(a, 3, 'unknown'); await form(a, 'Fictional Unknown Customer'); await clickText(a, 'Simpan')
  await waitFor(() => evaluate(a, `!!(${button('Periksa hasil')}) && !(${button('Periksa hasil')}).disabled`), 'unknown request recoverable')
  await clickText(a, 'Periksa hasil'); await waitFor(() => evaluate(a, `document.body.textContent.includes('Hasil belum diketahui')`), 'unknown remains unresolved')
  assert.equal(await evaluate(a, durableExpression), 1); assert.equal(Object.keys((await ledger(a)).receipts).length, 3)
  assert.equal((await ledger(a)).customers.some(row => row.name === 'Fictional Unknown Customer'), false)
  await shot(a, '09-unknown-not-success'); await clickText(a, 'Batalkan permintaan tersimpan'); await clickText(a, 'Konfirmasi pembatalan permintaan')
  await waitFor(() => evaluate(a, `${durableExpression} === 0 && !document.querySelector('#catalog-customer-name').disabled`), 'explicit abandonment unfreezes exact draft')
  assert.equal(await evaluate(a, `document.querySelector('#catalog-customer-name').value`), 'Fictional Unknown Customer')
  await clickText(a, 'Batal'); proved('missing target never proves unknown success; explicit abandonment retains exact draft')
  const final = await ledger(a)
  assert.equal(final.attempts.length, 4); assert.equal(new Set(final.attempts).size, 4); assert.equal(Object.keys(final.receipts).length, 3)
  assert.deepEqual(final.rawCalls, []); assert.deepEqual(final.unexpected, []); assert.equal(await evaluate(a, durableExpression), 0)
  await shot(a, '10-final-canonical-list'); proved('four unique commands, three receipts, zero raw/unexpected calls, zero residual request')
  for (const [path, bytes] of inputs) assert.equal(sha(await publicBytes(path)), sha(bytes), `Source mutated: ${path}`)
  const emitted = await readdir(output); assert.deepEqual(emitted.sort(), report.screenshots.map(item => item.file).sort(), 'No unlisted artifacts may be published')
  proofComplete = true
} catch (error) {
  report.error = String(error?.message ?? error).replaceAll(temporary ?? '\0', '<disposable>').replaceAll(root, '<repo>')
  if (cdp && activeSession) { try { await shot(activeSession, 'failure-state') } catch { /* Preserve original failure. */ } }
  process.exitCode = 1
} finally {
  if (cdp) { try { await cdp('Browser.close') } catch {} }
  // Terminate the owned browser and drain its event stream before declaring success.
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { fatal ??= 'Browser did not terminate'; browser.kill('SIGKILL'); resolve() }, 5000)
      browser.once('exit', () => { clearTimeout(timer); resolve() }); browser.kill('SIGTERM')
    })
  }
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { fatal ??= 'Browser event stream did not close'; resolve() }, 5000)
      socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true }); socket.close()
    })
  }
  await Promise.allSettled([...eventTasks])
  if (server) await new Promise(resolve => server.close(resolve))
  if (temporary) await rm(temporary, { recursive: true, force: true })
  try { check(); if (proofComplete && !report.error) report.status = 'passed' }
  catch (error) { report.error ??= String(error?.message ?? error) }
  if (report.status !== 'passed') process.exitCode = 1
  if (ownsOutput) {
    await writeFile(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
    assert.deepEqual((await readdir(output)).sort(), ['result.json', ...report.screenshots.map(item => item.file)].sort(), 'Refuse unlisted evidence files')
    // Publish only this fresh, completely inventoried output, including diagnostic failures.
    assert.ok(process.env.GITHUB_OUTPUT?.startsWith('/home/runner/work/_temp/_runner_file_commands/'))
    await appendFile(process.env.GITHUB_OUTPUT, 'artifact_ready=true\n')
  }
  if (report.status === 'passed') console.log('CATALOGUE_NATIVE_BROWSER_QA_PASSED')
  else console.error('CATALOGUE_NATIVE_BROWSER_QA_FAILED:', report.error)
}
