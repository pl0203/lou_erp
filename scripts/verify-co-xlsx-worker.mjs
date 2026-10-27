// Synthetic-only emitted browser-code smoke test. Node adapter, NOT native browser/Deno acceptance.
import { build } from 'vite';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parts, zip } from '../tests/co/import/fixtures/xlsx-layout.ts';
const root=fileURLToPath(new URL('../',import.meta.url)), out=mkdtempSync(join(tmpdir(),'co-xlsx-worker-'));
try {
 await build({root,configFile:false,worker:{format:'es'},build:{outDir:out,emptyOutDir:true,lib:{entry:join(root,'src/lib/co/import/workerClient.ts'),formats:['es'],fileName:'client'},rollupOptions:{output:{format:'es'}}}});
 const folder=join(out,'assets'),entry=readdirSync(folder).find(p=>/^import.worker-/.test(p));assert.ok(entry);
 const wrapper=`const {parentPort}=require('node:worker_threads');globalThis.self=globalThis;globalThis.postMessage=d=>parentPort.postMessage(d);globalThis.fetch=()=>{throw Error('network forbidden')};globalThis.XMLHttpRequest=class{constructor(){throw Error('XHR forbidden')}};globalThis.Worker=class{constructor(){throw Error('nested worker forbidden')}};import(${JSON.stringify('file://'+join(folder,entry))}).then(()=>parentPort.on('message',data=>self.onmessage({data}))).then(()=>parentPort.postMessage({ready:true}));`;
 const cases=[['stored',zip(parts()),true],['deflated',zip(parts().map(p=>({...p,deflate:true}))),true],['macro',zip(parts().map((p,i)=>i?p:{...p,text:p.text.replace('spreadsheetml.sheet.main+xml','ms-excel.sheet.macroEnabled.main+xml')})),false],['crc',zip(parts().map((p,i)=>i?p:{...p,crc:0})),false]];
 for(const [name,bytes,valid] of cases){
  const worker=new Worker(wrapper,{eval:true}),sha256=createHash('sha256').update(bytes).digest('hex'),scope={actorId:'synthetic',customerId:'synthetic',reportMonth:'2026-08-01',epoch:1};
  try{
   const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('worker timeout')),30000);worker.on('error',e=>{clearTimeout(timer);reject(e)});worker.on('message',data=>{if(data.ready){worker.postMessage({requestId:name,scope,format:'xlsx',sha256,bytes});return;}clearTimeout(timer);resolve(data);});});
   assert.deepEqual(response.scope,scope);assert.equal(response.requestId,name);assert.equal(response.result.sha256,sha256);
   assert.equal(response.result.sourceRows.length,valid?1:0);if(!valid)assert.ok(response.result.warnings.some(w=>w.startsWith('manual_review:')));
   console.log(JSON.stringify({case:name,rows:response.result.sourceRows.length,originalHash:true,scopeRoundTrip:true,networkAPIs:'throwing',runtime:'Node worker_threads, not native browser'}));
  }finally{await worker.terminate();}
 }
 const files=readdirSync(folder).sort().map(name=>{const b=readFileSync(join(folder,name));return {name,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}});
 console.log('CO_XLSX_WORKER_INVENTORY '+JSON.stringify({runtime:process.version,files}));
} finally {rmSync(out,{recursive:true,force:true});}
