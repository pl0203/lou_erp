import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const url=new URL('./run.mjs',import.meta.url);
test('runner is hosted-only before any build or browser invocation',async()=>{
 const source=await readFile(url,'utf8');
 assert.ok(source.indexOf("GITHUB_ACTIONS:'true'")<source.indexOf('await buildFixture('));
 for(const required of ['GITHUB_HEAD_REF','GITHUB_JOB','CO_CI_SOURCE_SHA','Target.createBrowserContext','Target.disposeBrowserContext','observeOwnedBrowser','stopOwnedBrowser',"connect-src 'none'",'CO_RETURN_NATIVE_PASSED'])assert.ok(source.includes(required),required);
 for(const forbidden of ['--no-sandbox','Page.captureScreenshot','writeFile(','CHROME_BINARY'])assert.ok(!source.includes(forbidden),forbidden);
 const result=spawnSync(process.execPath,[url.pathname],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:10000});
 assert.notEqual(result.status,0);assert.match(result.stderr,/Fixed return native CI identity/);
});
test('build module is import-safe and supports owned temporary output',async()=>{
 const module=await import('./build.mjs');assert.equal(typeof module.buildFixture,'function');
});
test('known CI identity rejects wrong repository, head branch and job before git/browser',()=>{
 const base={PATH:process.env.PATH,CI:'true',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'pl0203/lou_erp',GITHUB_WORKFLOW:'CO workspace runtime',GITHUB_JOB:'stock-return-native',GITHUB_HEAD_REF:'test/co-workspace-runtime-20261027'};
 for(const field of ['GITHUB_REPOSITORY','GITHUB_HEAD_REF','GITHUB_JOB']){
  const result=spawnSync(process.execPath,[url.pathname],{env:{...base,[field]:'unapproved'},encoding:'utf8',timeout:10000});
  assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp('Fixed return native CI identity: '+field));
 }
});
test('fixture preserves production ES worker output for the legacy recovery import graph',async()=>{
 const {default:config}=await import('./vite.config.mjs');
 assert.equal(config.worker?.format,'es');
});
test('blocked network diagnostics omit credentials, query, fragments and opaque payloads',async()=>{
 const {blockedNetworkDiagnostic}=await import('./network-diagnostic.mjs');
 const value=blockedNetworkDiagnostic('off-origin-network-attempt','https://alice:password@example.invalid/private-token?secret=value#fragment','Fetch');
 assert.deepEqual(value,{kind:'off-origin-network-attempt',scheme:'https:',origin:'https://example.invalid',path:'[redacted]',resourceType:'Fetch'});
 for(const secret of ['alice','password','private-token','secret','value','fragment'])assert.ok(!JSON.stringify(value).includes(secret));
 const opaque=blockedNetworkDiagnostic('off-origin-network-attempt','data:text/plain,secret','Image');
 assert.equal(opaque.scheme,'data:');assert.equal(opaque.origin,'[opaque]');assert.equal(opaque.path,'[redacted]');assert.equal(opaque.dataMediaType,'[other]');assert.match(opaque.dataUrlSha256,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(opaque).includes('secret'));
 assert.equal(blockedNetworkDiagnostic('off-origin-network-attempt','about:blank','Document').path,'blank');
 assert.equal(blockedNetworkDiagnostic('off-origin-request','not a URL token','unexpected token').resourceType,'Other');
});
test('opaque image diagnostics fingerprint bytes without exposing SVG or data payload',async()=>{
 const {blockedNetworkDiagnostic}=await import('./network-diagnostic.mjs');
 const value=blockedNetworkDiagnostic('off-origin-network-attempt','data:image/svg+xml,%3Csvg%3Esecret%3C/svg%3E','Image','other');
 assert.equal(value.dataMediaType,'image/svg+xml');assert.match(value.dataUrlSha256,/^[a-f0-9]{64}$/);assert.ok(value.dataUrlBytes>0);assert.equal(value.initiatorType,'other');
 assert.ok(!JSON.stringify(value).includes('secret'));assert.ok(!JSON.stringify(value).includes('%3Csvg'));
});

// Exact upstream Chromium calendar_icon.svg, not a generic data-image fixture.
const calendarSvg='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" viewBox="0 0 24 24"><path fill="WindowText" d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/><path fill="none" d="M0 0h24v24H0z"/></svg>';
const calendarUrl='data:image/svg+xml;base64,'+Buffer.from(calendarSvg).toString('base64');
test('only the proven Chromium calendar image Network event is classified as built-in',async()=>{
 const {blockedNetworkDiagnostic,isBuiltinCalendarImageDiagnostic}=await import('./network-diagnostic.mjs');
 assert.equal(typeof isBuiltinCalendarImageDiagnostic,'function');
 const event=blockedNetworkDiagnostic('off-origin-network-attempt',calendarUrl,'Image','other');
 assert.equal(event.dataUrlBytes,382);
 assert.equal(event.dataUrlSha256,'04e449d20d0365d881a54ed24af7ed00fe79dd9f9e601248f4fd7793003924f2');
 assert.equal(isBuiltinCalendarImageDiagnostic(event),true);
 for(const change of [{kind:'off-origin-request'},{scheme:'https:'},{resourceType:'Fetch'},{initiatorType:'script'},{initiatorType:'parser'},{initiatorType:undefined},{dataMediaType:'image/png'},{dataUrlBytes:383},{dataUrlSha256:'0'.repeat(64)}])assert.equal(isBuiltinCalendarImageDiagnostic({...event,...change}),false,JSON.stringify(change));
 for(const value of [calendarUrl+' ',calendarUrl.replace('PHN2','QHN2'),calendarUrl.replace('image/svg+xml','text/html'),'https://example.invalid/calendar.svg'])assert.equal(isBuiltinCalendarImageDiagnostic(blockedNetworkDiagnostic('off-origin-network-attempt',value,'Image','other')),false);
});
test('built-in classification never changes Fetch blocking or image CSP and is separately receipted',async()=>{
 const source=await readFile(url,'utf8');
 const fetch=source.slice(source.indexOf("if(message.method==='Fetch.requestPaused')"),source.indexOf("if(message.method==='Network.requestWillBeSent')"));
 assert.ok(fetch.includes("await cdp('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'}"));
 assert.ok(!fetch.includes('isBuiltinCalendarImageDiagnostic'));
 assert.ok(source.includes("img-src 'none'"));
 assert.ok(source.includes('receipt.builtinCalendarImages.push(diagnostic)'));
 assert.ok(source.includes('if(isBuiltinCalendarImageDiagnostic(diagnostic))'));
});
test('nested Keep editing waits for the same strict native focus restoration predicate',async()=>{
 const source=await readFile(url,'utf8');
 assert.ok(source.includes("await until(()=>ev(`document.querySelector('dialog').contains(document.activeElement)`),'keep editing focus restored')"));
 assert.ok(source.includes("assert.equal(await ev(`document.querySelector('dialog').contains(document.activeElement)`),true)"));
 assert.ok(source.includes('KEEP_EDITING_FOCUS_DIAGNOSTIC'));
});
test('stock browser cleanup proves owned process close before bounded profile removal',async()=>{
 const source=await readFile(new URL('../co-stock-browser/run.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("import {observeOwnedBrowser,stopOwnedBrowser} from '../co-browser/cleanup.mjs'"));
 assert.ok(source.includes('browserClosed=observeOwnedBrowser(browser)'));
 assert.ok(source.includes("await stopOwnedBrowser(browser,browserClosed,()=>cdp?cdp('Browser.close'):Promise.resolve())"));
 assert.ok(source.indexOf('await stopOwnedBrowser(')<source.indexOf('await rm(temp,'));
 assert.ok(source.includes('await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100})'));
 assert.ok(!source.includes("browser?.kill('SIGTERM')"));
 assert.ok(source.indexOf('console.log(JSON.stringify(receipt,null,2))')>source.indexOf('await rm(temp,'));
});
