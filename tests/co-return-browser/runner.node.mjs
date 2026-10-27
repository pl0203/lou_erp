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
