// Hosted-CI-only native Chrome + production Stock Return page/modal; synthetic transport, no hosted data.
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { mkdtemp,readFile,readdir,rm,realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join,extname } from 'node:path';
import { buildFixture } from './build.mjs';
import { observeOwnedBrowser, stopOwnedBrowser } from '../co-browser/cleanup.mjs';
const git=args=>execFileSync('git',args,{encoding:'utf8',env:{PATH:process.env.PATH},timeout:10000}).trim();
for(const [key,value] of Object.entries({CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'CO workspace runtime',GITHUB_JOB:'stock-return-native',GITHUB_HEAD_REF:'test/co-workspace-runtime-20261027'}))assert.equal(process.env[key],value,`Fixed return native CI identity: ${key}`);
for(const key of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])assert.match(process.env[key]??'',/^[1-9][0-9]*$/);
assert.match(process.env.CO_CI_SOURCE_SHA??'',/^[a-f0-9]{40}$/);assert.equal(git(['rev-parse','HEAD']),process.env.CO_CI_SOURCE_SHA);assert.equal(git(['status','--porcelain','--untracked-files=normal']),'','Clean source required');
const receipt={commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),coverage:'Stock Return production page/modal; synthetic Auth transport only, not hosted SQL/E2E',run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,assertions:[]};
let temporary,server,browser,browserClosed,socket,fatal;let sequence=0;const calls=new Map(),sessions=new Map(),events=new Set(),violations=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+30000;while(Date.now()<end){if(fatal)throw Error(fatal);assert.deepEqual(violations,[],'Network isolation violation');if(await fn())return;await delay(30)}throw Error(`Timeout: ${label}`)}
let cdp;
async function evaluate(session,expression){const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value}
async function click(session,expression){await evaluate(session,`(${expression}).scrollIntoView({block:'center'})`);const box=await evaluate(session,`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);assert.ok(box.width>0&&box.height>0);await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x,y:box.y,button:'left',clickCount:1},session);await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x,y:box.y,button:'left',clickCount:1},session)}
try{
 temporary=await mkdtemp(join(tmpdir(),'co-native-browser-'));const out=join(temporary,'build');await buildFixture(out);
 const files=new Map();async function index(dir,prefix=''){for(const e of await readdir(dir,{withFileTypes:true})){const path=prefix+e.name;if(e.isDirectory())await index(join(dir,e.name),path+'/');else{assert.ok(e.isFile());files.set('/'+path,await readFile(join(dir,e.name)))}}}await index(out);
 server=createServer((request,response)=>{const path=new URL(request.url,'http://127.0.0.1').pathname;const target=path==='/'?'/index.html':path;if(request.method!=='GET'||(!files.has(target)&&path!=='/favicon.ico')){violations.push('unapproved-local-path');response.writeHead(403).end();return}response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; worker-src 'self'; img-src 'none'; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'");response.setHeader('Cache-Control','no-store');if(path==='/favicon.ico'){response.writeHead(204).end();return}response.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[extname(target)]??'application/octet-stream');response.end(files.get(target))});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const origin=`http://127.0.0.1:${server.address().port}`;
 const chrome=await realpath('/usr/bin/google-chrome');assert.ok(chrome.startsWith('/opt/google/chrome/'),'Official preinstalled Chrome required');const safeEnv={PATH:process.env.PATH,HOME:temporary,TMPDIR:temporary,LANG:'C.UTF-8'};receipt.browser=execFileSync(chrome,['--version'],{env:safeEnv,encoding:'utf8',timeout:10000}).trim();
 browser=spawn(chrome,['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${join(temporary,'profile')}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-component-extensions-with-background-pages','--disable-default-apps','about:blank'],{env:safeEnv,stdio:['ignore','ignore','pipe']});browserClosed=observeOwnedBrowser(browser);let endpoint;browser.once('error',e=>{fatal=e.message});browser.once('exit',code=>{if(!endpoint)fatal=`Chrome exited ${code}`});browser.stderr.on('data',b=>{const m=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/.exec(String(b));if(m)endpoint=m[1]});await until(()=>!!endpoint,'sandboxed Chrome');socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 cdp=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{calls.delete(id);reject(Error(`CDP timeout ${method}`))},30000);calls.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject:e=>{clearTimeout(timer);reject(e)}});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
 const filter=[{type:'browser',exclude:true},{type:'tab',exclude:true},{type:'browser_ui',exclude:true},{}];
 socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.id){const call=calls.get(message.id);if(call){calls.delete(message.id);message.error?call.reject(Error(message.error.message)):call.resolve(message.result)}return}const task=(async()=>{
  if(message.method==='Target.attachedToTarget'){const {sessionId,targetInfo}=message.params;if(!['page','worker'].includes(targetInfo.type)){violations.push('unexpected-target');await cdp('Target.closeTarget',{targetId:targetInfo.targetId});return}await cdp('Network.enable',{},sessionId);await cdp('Runtime.enable',{},sessionId);if(targetInfo.type==='page')await cdp('Fetch.enable',{patterns:[{urlPattern:'*'}]},sessionId);if(targetInfo.type==='page')await cdp('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter},sessionId);await cdp('Runtime.runIfWaitingForDebugger',{},sessionId);sessions.set(targetInfo.targetId,sessionId)}
  if(message.method==='Fetch.requestPaused'){const {requestId,request}=message.params;let allowed=false;try{allowed=new URL(request.url).origin===origin}catch{}if(!allowed){violations.push('off-origin-request');await cdp('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'},message.sessionId)}else await cdp('Fetch.continueRequest',{requestId},message.sessionId)}
  if(message.method==='Network.requestWillBeSent'){let allowed=false;try{allowed=new URL(message.params.request.url).origin===origin}catch{}if(!allowed)violations.push('off-origin-network-attempt')}
  if(message.method==='Network.webSocketCreated')violations.push('unexpected-websocket');
  if(message.method==='Runtime.exceptionThrown')fatal='Uncaught native browser exception';
 })().catch(error=>{fatal??=error.message});events.add(task);void task.finally(()=>events.delete(task))});
 await cdp('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true,filter});
 // Every independent case owns a new incognito context: no stale JS, cache or recovery storage.
 async function scenario(name,width,exercise){
  const {browserContextId}=await cdp('Target.createBrowserContext');
  try{
   const {targetId}=await cdp('Target.createTarget',{url:'about:blank',browserContextId});
   await until(()=>sessions.has(targetId),'guarded fresh return page');const session=sessions.get(targetId);
   await cdp('Page.enable',{},session);await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},session);
   await cdp('Page.navigate',{url:origin+'/?scenario='+name},session);
   await until(()=>evaluate(session,`document.querySelectorAll('main > .co-return-table-scroll tbody tr').length===1`),'recorded return');
   const ev=expression=>evaluate(session,expression);
   const tap=async expression=>{await until(()=>ev(`!!(${expression})&&!(${expression}).disabled`),'visible enabled control');await click(session,expression)};
   const button=text=>`Array.from(document.querySelectorAll('button')).find(x=>(x.getAttribute('aria-label')||x.textContent).trim()===${JSON.stringify(text)})`;
   const key=async(key,code,virtual,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await cdp('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:virtual,modifiers},session)};
   const type=async(selector,text)=>{await tap(selector);await key('a','KeyA',65,2);await cdp('Input.insertText',{text},session)};
   const contains=text=>ev(`document.body.innerText.includes(${JSON.stringify(text)})`);
   const waitButton=text=>until(()=>ev(`!!(${button(text)})`),text);
   const noUUID=async()=>assert.equal(await ev(`/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(document.body.innerText)`),false);
   const geometry=async()=>{
    const r=await ev(`(()=>{const d=document.querySelector('dialog');const box=e=>{const b=e.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}};return {page:document.documentElement.scrollWidth,viewport:innerWidth,height:innerHeight,dialog:d?box(d):null,footer:d?.querySelector('footer')?box(d.querySelector('footer')):null,cards:Array.from(document.querySelectorAll('.co-return-selected-table tbody tr')).map(box)}})()`);
    assert.ok(r.page<=r.viewport+1,'page horizontal containment');
    if(r.dialog){assert.ok(r.dialog.left>=0&&r.dialog.right<=r.viewport+1,'dialog horizontal containment');assert.ok(r.dialog.top>=0&&r.dialog.bottom<=r.height+1,'dialog vertical containment');}
    if(r.footer)assert.ok(r.footer.top>=0&&r.footer.bottom<=r.height+1,'sticky footer remains in viewport');
    if(width===390)for(const card of r.cards)assert.ok(card.left>=r.dialog.left&&card.right<=r.dialog.right+1,'mobile selected-item card contained');
   };

   await exercise({session,ev,tap,button,key,type,contains,waitButton,noUUID,geometry});
   receipt.assertions.push(name+' '+width);
  }finally{await cdp('Target.disposeBrowserContext',{browserContextId})}
 }
 for(const width of [1365,390])await scenario('success',width,async({ev,tap,button,key,contains,noUUID,geometry})=>{
  for(const text of ['Tercatat','3 PCS','1 BOX','Actions'])assert.equal(await contains(text),true,text);
  await geometry();await noUUID();await tap(button('Buka'));
  await until(()=>contains('CO-CONTOH-1'),'source detail');
  for(const text of ['Harga satuan','Nilai retur','Sumber CO','CO-CONTOH-2','10.000','30.000'])assert.equal(await contains(text),true,text);
  await geometry();await noUUID();await key('Escape','Escape',27);
  await until(()=>ev(`!document.querySelector('dialog')`),'detail escape');
  assert.equal(await ev(`document.activeElement===(${button('Buka')})`),true);
 });
 await scenario('success',390,async({ev,tap,button,key,type,waitButton,contains,geometry})=>{
  await tap(button('Create Stock Return'));await waitButton('Toko Contoh Nusantara');
  assert.equal(await contains('Toko Riwayat'),false);
  await type(`document.querySelector('#return-customer-search')`,'Toko');await waitButton('Toko Contoh Nusantara');
  await tap(button('Toko Contoh Nusantara'));await waitButton('Tambah SEMEN-003');
  assert.equal(await ev(`(${button('Tambah SEMEN-003')}).disabled`),true);
  await tap(button('Tambah CAT-001'));await tap(button('Tambah KUAS-002'));
  await tap(button('Hapus CAT-001'));await tap(button('Tambah CAT-001'));
  assert.equal(await ev(`document.querySelectorAll('.co-return-selected-table input').length`),2);
  await type(`document.querySelector('[aria-label="Qty retur CAT-001"]')`,'3');await geometry();
  // Real keyboard events exercise native dialog focus wrapping and nested dirty guard.
  await ev(`(${button('Tutup form retur')}).focus()`);await key('Tab','Tab',9,8);
  assert.equal(await ev(`document.activeElement===(${button('Catat retur')})`),true);await key('Tab','Tab',9);
  assert.equal(await ev(`document.activeElement===(${button('Tutup form retur')})`),true);
  await key('Escape','Escape',27);await waitButton('Tetap mengedit');
  assert.equal(await ev(`document.activeElement===(${button('Tetap mengedit')})`),true);
  await key('Tab','Tab',9);assert.equal(await ev(`document.activeElement===(${button('Buang perubahan')})`),true);
  await tap(button('Tetap mengedit'));await until(()=>ev(`document.querySelectorAll('dialog').length===1`),'keep edits');
  assert.equal(await ev(`document.querySelector('[aria-label="Qty retur CAT-001"]').value`),'3');
  assert.equal(await ev(`document.querySelector('dialog').contains(document.activeElement)`),true);
  await key('Escape','Escape',27);await waitButton('Buang perubahan');await tap(button('Buang perubahan'));
  await until(()=>ev(`!document.querySelector('dialog')`),'discard form');
  assert.equal(await ev(`document.activeElement===(${button('Create Stock Return')})`),true);
  assert.equal(await ev('returnFixture.commits'),0);
 });
 await scenario('loading',390,async({ev,tap,button,type,waitButton,contains})=>{
  await tap(button('Create Stock Return'));await waitButton('Toko Contoh Nusantara');await tap(button('Toko Contoh Nusantara'));
  await until(()=>contains('Memuat stok'),'held items');
  await type(`document.querySelector('#return-item-search')`,'CAT');
  assert.equal(await ev(`document.querySelector('#return-item-search').value`),'CAT');
  assert.equal(await ev(`document.activeElement===document.querySelector('#return-item-search')`),true);
  assert.equal(await ev(`Array.from(document.querySelectorAll('button')).some(x=>x.getAttribute('aria-label')?.startsWith('Tambah '))`),false);
  await until(()=>ev(`returnFixture.calls.some(x=>x.name==='pilot_co_return_items_v1'&&x.args.p_search==='CAT')`),'held typed search');
  await ev('releaseReturnItems()');await waitButton('Tambah CAT-001');
  assert.equal(await ev(`document.querySelector('#return-item-search').value`),'CAT');
 });
 for(const name of ['success','uncertain'])await scenario(name,1365,async({ev,tap,button,type,waitButton,contains,noUUID})=>{
  await tap(button('Create Stock Return'));await waitButton('Toko Contoh Nusantara');await tap(button('Toko Contoh Nusantara'));await waitButton('Tambah CAT-001');
  await tap(button('Tambah CAT-001'));await tap(button('Tambah KUAS-002'));
  const qty=sku=>`document.querySelector('[aria-label="Qty retur ${sku}"]')`;
  await type(qty('CAT-001'),'99');await type(qty('KUAS-002'),'2');await type(`document.querySelector('#return-reason')`,'Synthetic native validation');
  // Date segment entry is locale-specific; invoke the native setter and input/change for deterministic UTC cutoff.
  await ev(`(()=>{const e=document.querySelector('#return-date');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,new Date().toISOString().slice(0,10));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await tap(button('Catat retur'));await until(()=>contains('Qty retur CAT-001 harus 1 sampai 40.'),'quantity validation');
  assert.equal(await ev('returnFixture.commits'),0);assert.equal(await ev(`returnFixture.calls.filter(x=>x.name==='pilot_co_return_create_v1').length`),0);
  await type(qty('CAT-001'),'3');await tap(button('Catat retur'));
  if(name==='uncertain'){await waitButton('Periksa hasil');assert.equal(await ev(`(${button('Create Stock Return')}).disabled`),true);assert.equal(await ev('returnFixture.commits'),1);await tap(button('Periksa hasil'));}
  await until(()=>contains('Stock return berhasil dicatat.'),'canonical success');
  assert.equal(await ev('returnFixture.commits'),1);assert.equal(await ev(`returnFixture.calls.filter(x=>x.name==='pilot_co_return_create_v1').length`),1);
  assert.equal(await ev(`returnFixture.calls.some(x=>x.name==='pilot_co_return_v1')`),true);
  if(name==='uncertain')assert.equal(await ev(`returnFixture.calls.filter(x=>x.name==='pilot_co_return_create_result_v1').length`),1);
  await until(()=>ev(`document.querySelectorAll('main > .co-return-table-scroll tbody tr').length===2`),'refreshed rows');await noUUID();
 });
 await Promise.all([...events]);assert.deepEqual(violations,[]);assert.ok(!fatal,fatal);
}finally{
 // Never delete a profile while the owned Chrome may still be writing it.
 try{if(browser)await stopOwnedBrowser(browser,browserClosed,()=>cdp?cdp('Browser.close'):Promise.resolve())}
 finally{if(socket){for(const call of calls.values())call.reject(Error('Browser cleanup'));calls.clear();socket.close()}if(server)await new Promise(resolve=>server.close(resolve))}
 // Chromium child processes can finish a final profile rename just after close.
 // Retry only the exact mkdtemp-owned tree, bounded; exhaustion remains failure.
 if(temporary)await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
console.log('CO_RETURN_NATIVE_PASSED '+JSON.stringify(receipt));
