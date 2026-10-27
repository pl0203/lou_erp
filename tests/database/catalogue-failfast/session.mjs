import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ResultFramer } from './core.mjs';
export class PsqlSession {
 constructor({name,env,command='psql',args=['-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],timeoutMs=15000}) {
  assert.match(name,/^[a-zA-Z0-9_]+$/);this.name=name;this.timeoutMs=timeoutMs;this.seq=0;this.pending=null;this.closed=false;this.stderrBytes=0;
  this.child=spawn(command,args,{env,shell:false,stdio:['pipe','pipe','pipe']});
  this.exitPromise=new Promise(resolve=>this.child.once('close',(code,signal)=>{this.closed=true;const e=new Error('Session exited');if(this.pending)this.finish(null,e);resolve();}));
  this.child.on('error',()=>{if(this.pending)this.finish(null,new Error('Session failed'));});
  this.child.stdin.on('error',()=>{if(this.pending)this.finish(null,new Error('Session input failed'));});
  this.child.stdout.setEncoding('utf8');this.child.stderr.setEncoding('utf8');
  this.child.stdout.on('data',chunk=>{try{assert.ok(this.pending,'Unexpected output outside a command');const result=this.pending.framer.feed(chunk);if(result)this.finish(result);}catch(e){this.finish(null,new Error('Session output refused'));this.child.kill('SIGKILL');}});
  this.child.stderr.on('data',chunk=>{this.stderrBytes+=Buffer.byteLength(chunk);if(this.stderrBytes>4*1024*1024){this.finish(null,new Error('stderr bound exceeded'));this.child.kill('SIGKILL');}});
 }
 finish(result,error){const p=this.pending;if(!p)return;clearTimeout(p.timer);this.pending=null;error?p.reject(error):p.resolve({...result,elapsedMs:performance.now()-p.start});}
 query(sql){assert.equal(this.closed,false,'Session closed');assert.equal(this.pending,null,'A command is already pending');const token=`${this.name}_${++this.seq}`;return new Promise((resolve,reject)=>{this.pending={resolve,reject,framer:new ResultFramer(token),start:performance.now(),timer:setTimeout(()=>{this.finish(null,new Error(`${this.name} command exceeded ${this.timeoutMs}ms`));this.child.kill('SIGKILL');},this.timeoutMs)};this.child.stdin.write(`${sql}\n\\echo __FF_END_${token}__ :SQLSTATE\n`);});}
 async close(){if(this.closed)return;this.child.stdin.end();const timer=setTimeout(()=>this.child.kill('SIGKILL'),1000);try{await this.exitPromise;}finally{clearTimeout(timer);}}
}
