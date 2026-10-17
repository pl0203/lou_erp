import test from 'node:test';
import assert from 'node:assert/strict';
let mod;try{mod=await import('./session.mjs');}catch{}
const need=()=>assert.ok(mod,'Interactive psql session adapter is not implemented');
const fake=`let b='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{b+=c;for(;;){const i=b.indexOf('\\n');if(i<0)break;const line=b.slice(0,i);b=b.slice(i+1);if(line==='CRASH'){process.exit(3)}if(line==='WAIT')continue;if(line.startsWith('\\\\echo __FF_END_'))process.stdout.write(line.slice(6).replace(':SQLSTATE','00000')+'\\n');}});`;
test('session frames a real child process, bounds concurrent commands, and closes',async()=>{need();const s=new mod.PsqlSession({name:'test',command:process.execPath,args:['-e',fake],env:{PATH:process.env.PATH},timeoutMs:1000});try{const a=s.query('SELECT 1;');assert.throws(()=>s.query('SELECT 2;'),/pending/);assert.equal((await a).sqlstate,'00000');assert.equal((await s.query('SELECT 3;')).sqlstate,'00000');}finally{await s.close();}});
test('session reports child exit as a failed operation',async()=>{need();const s=new mod.PsqlSession({name:'test',command:process.execPath,args:['-e',fake],env:{PATH:process.env.PATH},timeoutMs:1000});try{await assert.rejects(s.query('CRASH'),/exited/);}finally{await s.close();}});
