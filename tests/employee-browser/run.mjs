import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {readFile,writeFile,mkdtemp,mkdir,rm,lstat,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,extname} from 'node:path'
import {prepareEmployeeBrowser,root,output,safeEnv} from './prepare.mjs'
import {sha,allowBrowserRequest} from './guards.mjs'
let report={status:'failed',assertions:[],screenshots:[],networkViolations:[]},temporary,browser,server,socket,cdp,fatal,activeSession,proofComplete=false,ownsOutput=false
const pending=new Map(),sessions=new Map(),eventTasks=new Set()
const targetFilter=[{type:'browser',exclude:true},{type:'tab',exclude:true},{type:'browser_ui',exclude:true},{}]
let sequence=0
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
const button = text => `Array.from(document.querySelectorAll('button,a')).find(node => node.textContent.trim() === ${JSON.stringify(text)})`
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
const ledgerExpression = `JSON.parse(localStorage.getItem('employee-synthetic-v1:server') || 'null')`
const durableExpression = `Object.keys(localStorage).filter(key => key.startsWith('employee-operation:')).length`
async function ledger(session) { return evaluate(session, ledgerExpression) }
async function shot(session, name) {
  check(); const result = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, session)
  const bytes = Buffer.from(result.data, 'base64'); await writeFile(join(output, name + '.png'), bytes)
  report.screenshots.push({ file: name + '.png', sha256: sha(bytes), bytes: bytes.length })
}
function proved(name, evidence = {}) { check(); report.assertions.push({ name, ...evidence }) }

try{
 report=await prepareEmployeeBrowser(process.argv.slice(2));ownsOutput=true
 if(report.mode==='local-prepare')console.log('EMPLOYEE_BROWSER_PREPARED_NOT_EXECUTED')
 else{
 report.status='failed';temporary=await mkdtemp(join(tmpdir(),'employee-native-'));const home=join(temporary,'home');await mkdir(home)
 const files=new Map(await Promise.all(report.build.map(async f=>['/'+f.path,await readFile(join(output,'site',f.path))])))
 server=createServer((request,response)=>{
 let path=new URL(request.url,'http://127.0.0.1').pathname
 if(path==='/'||/^\/ihr\/employees(?:\/new|\/[a-f0-9-]{36}(?:\/edit|\/reporting)?)?$/.test(path))path='/index.html'
 if(request.method!=='GET'||(!files.has(path)&&path!=='/favicon.ico')){report.networkViolations.push({kind:'unapproved-local-path',path});response.writeHead(403).end();return}
 response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; worker-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'")
 response.setHeader('Cache-Control','no-store');if(path==='/favicon.ico'){response.writeHead(204).end();return}
 response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.svg':'image/svg+xml'})[extname(path)]??'application/octet-stream');response.end(files.get(path))
 })
 await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes)})
 const origin=`http://127.0.0.1:${server.address().port}`
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
  const allow = url => allowBrowserRequest(url,origin)
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
 const {targetId}=await cdp('Target.createTarget',{url:'about:blank'});await waitFor(()=>sessions.has(targetId),'guarded page attached')
 const a=sessions.get(targetId);activeSession=a
 await cdp('Page.enable',{},a);await cdp('Runtime.enable',{},a)
 await cdp('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false},a)
 await cdp('Page.navigate',{url:origin},a)
 const textHas=text=>evaluate(a,`document.body.textContent.includes(${JSON.stringify(text)})`)
 const waitText=text=>waitFor(()=>textHas(text),text)
 const fill=async(selector,text)=>{await click(a,`document.querySelector(${JSON.stringify(selector)})`);await key(a,'a','KeyA',65,2);await cdp('Input.insertText',{text},a)}
 const review=async(reason='Synthetic browser verification')=>{await fill('#employee-reason',reason);await clickText(a,'Tinjau perubahan');await waitText('Tinjau sebelum menyimpan');assert.equal(await evaluate(a,'document.activeElement.textContent'),'Tinjau sebelum menyimpan')}
 const save=async()=>{await clickText(a,'Simpan perubahan');await waitText('Perubahan sudah tersimpan');await waitFor(()=>evaluate(a,`!location.pathname.endsWith('/edit')&&!location.pathname.endsWith('/new')&&!location.pathname.endsWith('/reporting')`),'saved detail route')}
 const controls=async()=>{if(!await evaluate(a,`document.querySelector('.qa-controls').open`))await click(a,`document.querySelector('.qa-controls summary')`)}
 const setMode=async(index,expected)=>{await controls();await selectIndex(a,'#qa-mode',index);await waitFor(async()=>(await ledger(a)).mode===expected,'fixture mode')}
 await waitText('Tambah karyawan');await shot(a,'01-desktop-1366');proved('actual employee list and IHR navigation render')
 assert.deepEqual(await evaluate(a,'[isSecureContext,typeof crypto.randomUUID,typeof HTMLDialogElement.prototype.showModal]'),[true,'function','function'])
 await clickText(a,'Tambah karyawan');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')`),'new editor')
 await clickText(a,'Tinjau perubahan');await waitText('Alasan perubahan wajib diisi.');assert.equal(await evaluate(a,`document.activeElement.getAttribute('role')`),'alert')
 await fill('#employee-name','Synthetic Native Create 李');await review();await shot(a,'02-preview');await save()
 assert.equal((await ledger(a)).commits,1);assert.equal((await ledger(a)).records.length,3);proved('native create, validation focus, actual preview and single save')
 const employee=(await ledger(a)).records.find(x=>x.fields.name==='Synthetic Native Create 李').id
 const savedHistory=await cdp('Page.getNavigationHistory',{},a);await cdp('Page.reload',{},a);await waitText('Synthetic Native Create 李');assert.equal((await ledger(a)).commits,1)
 await clickText(a,'Kembali ke daftar');await waitText('Tambah karyawan')
 const back=(await cdp('Page.getNavigationHistory',{},a)).entries.find(x=>x.url===origin+'/ihr/employees/'+employee);assert.ok(back)
 await cdp('Page.navigateToHistoryEntry',{entryId:back.id},a);await waitText('Ubah data dasar')
 const history=await cdp('Page.getNavigationHistory',{},a),forward=history.entries[history.currentIndex+1];assert.ok(forward)
 await cdp('Page.navigateToHistoryEntry',{entryId:forward.id},a);await waitText('Tambah karyawan');proved('reload and browser Back/Forward resolve canonical records without duplicate save')
 for(const width of [360,390,768,1366]){await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},a);assert.equal(await evaluate(a,'innerWidth'),width);assert.equal(await evaluate(a,'document.documentElement.scrollWidth<=innerWidth'),true);await shot(a,`03-list-${width}`)}
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},a)
 assert.equal(await evaluate(a,`matchMedia('(prefers-reduced-motion: reduce)').matches`),true)
 await clickText(a,'Tambah karyawan');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')`),'reduced motion editor')
 const motion=await evaluate(a,`getComputedStyle(document.querySelector('.employee-editor')).animationDuration`);assert.ok(motion.split(',').every(x=>parseFloat(x)<=0.01));await shot(a,'04-reduced-motion');proved('all four actual CSS viewports and verified reduced-motion emulation',{motion})
 await fill('#employee-name','Retained unsaved draft');await clickText(a,'Batal');await waitText('Buang perubahan?')
 for(let i=0;i<6;i++){await key(a,'Tab','Tab',9);assert.equal(await evaluate(a,`document.querySelector('dialog:modal').contains(document.activeElement)`),true)}
 await key(a,'Escape','Escape',27);await waitFor(()=>evaluate(a,`!document.querySelector('dialog:modal')`),'Escape keeps draft');assert.equal(await evaluate(a,`document.querySelector('#employee-name').value`),'Retained unsaved draft')
 await setMode(1,'slow');await controls();await clickText(a,'Refresh authority');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')&&!document.querySelector('#employee-name').disabled`),'slow refresh restores editor');assert.equal(await evaluate(a,`document.querySelector('#employee-name').value`),'Retained unsaved draft')
 await setMode(0,'normal');await clickText(a,'Batal');await waitText('Buang perubahan?');await clickText(a,'Buang perubahan');await waitText('Tambah karyawan');proved('native keyboard focus containment, cancel and slow authority refresh preserve draft')
 await setMode(2,'lost-after');await clickText(a,'Tambah karyawan');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')`),'lost reply editor');await fill('#employee-name','Synthetic Lost Reply');await review();await clickText(a,'Simpan perubahan');await waitText('Hasil penyimpanan belum pasti')
 const commits=(await ledger(a)).commits;assert.equal(commits,2);await cdp('Page.reload',{},a);await waitText('Periksa hasil');await clickText(a,'Periksa hasil');await waitText('Synthetic Lost Reply');await waitText('Ubah data dasar');assert.equal((await ledger(a)).commits,commits);await shot(a,'05-reload-recovered');proved('after-commit lost response and reload recover the original operation without duplicate')
 await setMode(3,'lost-before');await clickText(a,'Kembali ke daftar');await clickText(a,'Tambah karyawan');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')`),'before-commit editor');await fill('#employee-name','Synthetic Never Committed');await review();await clickText(a,'Simpan perubahan');await waitText('Hasil penyimpanan belum pasti');await clickText(a,'Periksa hasil');await waitText('Batalkan operasi lama');await clickText(a,'Batalkan operasi lama');await waitText('Batalkan operasi lama?');await clickText(a,'Konfirmasi pembatalan');assert.equal((await ledger(a)).commits,commits);await setMode(0,'normal');proved('before-commit interruption confirms abandonment without inventing a save')
 await cdp('Page.navigate',{url:origin+'/ihr/employees/'+employee},a);await waitText('Tautkan akun');await clickText(a,'Tautkan akun');await waitText('Akun Tidak Aktif');await click(a,`document.querySelector('input[type="radio"]')`);await review();await save();await waitText('Tidak aktif')
 assert.equal((await ledger(a)).records.find(x=>x.id===employee).account.active,false)
 await clickText(a,'Tinjau tautan akun');await waitText('Saya ingin mengarantina');await click(a,`document.querySelector('.employee-check input')`);await review();await save();await waitText('Dikarantina');assert.equal((await ledger(a)).records.find(x=>x.id===employee).account.active,false);proved('inactive-account link and quarantine preserve synthetic login facts')
 await controls();await clickText(a,'Toggle synthetic UTC');await waitText('Ubah riwayat pelaporan');await clickText(a,'Ubah riwayat pelaporan');await waitText('Linimasa lengkap')
 await selectIndex(a,'#reporting-mode',1);await fill('#reporting-reason','Synthetic historical correction');await fill('#reporting-source','Synthetic verified source');await clickText(a,'Tambah periode');await clickText(a,'Pilih atasan');await waitText('Pilih atasan pelaporan');await key(a,'Tab','Tab',9);assert.equal(await evaluate(a,`document.querySelector('dialog:modal').contains(document.activeElement)`),true);await key(a,'Escape','Escape',27);await clickText(a,'Hapus periode');await clickText(a,'Tinjau perubahan');await waitText('Tinjau sebelum menyimpan');await save();await waitText('Riwayat perubahan');proved('reporting correction preview, manager-dialog keyboard and audit render')
 await clickText(a,'Ubah data dasar');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')`),'protected edit');await fill('#employee-name','Discard on access loss');await controls();await clickText(a,'Toggle server access');await waitText('Akses Data Karyawan dibatasi');assert.equal(await evaluate(a,`!!document.querySelector('#employee-name')`),false);await shot(a,'06-access-loss');proved('server access loss removes protected screen and draft')
 await clickText(a,'Toggle server access');await waitFor(()=>evaluate(a,`!!document.querySelector('#employee-name')`),'fresh reauthorization');assert.notEqual(await evaluate(a,`document.querySelector('#employee-name').value`),'Discard on access loss')
 await setMode(5,'malformed');await cdp('Page.navigate',{url:origin+'/ihr/employees'},a);await waitText('Data belum dapat ditampilkan');assert.equal(await evaluate(a,`document.querySelectorAll('.employee-directory tbody tr').length`),0);proved('malformed synthetic RPC cannot bypass actual production decoder')
 check();proofComplete=true
 }
}catch(error){report.error=String(error?.message??error).replaceAll(temporary??'\0','<disposable>').replaceAll(root,'<repo>');if(cdp&&activeSession)try{await shot(activeSession,'failure-state')}catch{};process.exitCode=1}
finally{
 if(cdp)try{await cdp('Browser.close')}catch{}
 if(browser&&browser.exitCode===null&&browser.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{fatal??='Browser did not terminate';browser.kill('SIGKILL');resolve()},5000);browser.once('exit',()=>{clearTimeout(timer);resolve()});browser.kill('SIGTERM')})
 if(socket&&socket.readyState!==WebSocket.CLOSED)await new Promise(resolve=>{const timer=setTimeout(()=>{fatal??='Browser event stream did not close';resolve()},5000);socket.addEventListener('close',()=>{clearTimeout(timer);resolve()},{once:true});socket.close()})
 await Promise.allSettled([...eventTasks]);if(server)await new Promise(resolve=>server.close(resolve));if(temporary)try{await rm(temporary,{recursive:true,force:true})}catch{fatal??='Owned browser profile cleanup failed'}
 try{check();if(proofComplete&&!report.error)report.status='passed'}catch(error){report.error??=error.message}
 if(report.mode==='github-ci'&&report.status!=='passed')process.exitCode=1
 if(ownsOutput)await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
 if(report.status==='passed')console.log('EMPLOYEE_NATIVE_BROWSER_QA_PASSED')
 else if(report.status!=='prepared')console.error('EMPLOYEE_NATIVE_BROWSER_QA_FAILED:',report.error)
}
