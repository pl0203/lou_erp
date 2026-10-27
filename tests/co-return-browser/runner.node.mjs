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
