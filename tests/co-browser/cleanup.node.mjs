import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeOwnedBrowser, stopOwnedBrowser } from './cleanup.mjs';
function child(){const value=new EventEmitter();value.pid=123;value.signals=[];value.kill=signal=>{value.signals.push(signal);return true};return value}
test('graceful shutdown waits for close rather than early exit before cleanup',async()=>{
 const browser=child(),closed=observeOwnedBrowser(browser);let complete=false;
 const stopping=stopOwnedBrowser(browser,closed,async()=>{browser.emit('exit',0,null);setTimeout(()=>browser.emit('close',0,null),10)},{timeoutMs:100}).then(()=>{complete=true});
 await new Promise(r=>setTimeout(r,1));assert.equal(complete,false);await stopping;assert.deepEqual(browser.signals,[]);
});
test('fallback waits for owned process close after SIGKILL',async()=>{
 const browser=child(),closed=observeOwnedBrowser(browser);browser.kill=signal=>{browser.signals.push(signal);if(signal==='SIGKILL')setTimeout(()=>browser.emit('close',null,'SIGKILL'),5);return true};
 await stopOwnedBrowser(browser,closed,async()=>{}, {timeoutMs:10});assert.deepEqual(browser.signals,['SIGTERM','SIGKILL']);
});
test('unproven process termination rejects rather than permitting profile removal',async()=>{
 const browser=child(),closed=observeOwnedBrowser(browser);
 await assert.rejects(stopOwnedBrowser(browser,closed,async()=>{throw Error('closed CDP')},{timeoutMs:5}),/Owned Chrome termination unproven/);assert.deepEqual(browser.signals,['SIGTERM','SIGKILL']);
});
test('already closed owned process is never signalled',async()=>{
 const browser=child(),closed=observeOwnedBrowser(browser);browser.emit('close',0,null);
 await stopOwnedBrowser(browser,closed,async()=>{throw Error('must not request close')},{timeoutMs:5});assert.deepEqual(browser.signals,[]);
});
