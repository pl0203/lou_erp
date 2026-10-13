// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { createEvidenceUploadHandler, inspectEvidenceBytes } from '../../supabase/functions/co-evidence-upload/index';
const id = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const oid = '33333333-3333-4333-8333-333333333333';
const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const config = { url: 'https://project.example', anonKey: 'public', serviceKey: 'server-only' };
async function context(bytes = pdf) {
 const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
 return { version:'1', id, actor_id:actor, bucket:'co-evidence', path:`${id}.pdf`, filename:`evidence-${id}.pdf`, mime_type:'application/pdf', byte_size:bytes.length, sha256, state:'pending', object:null as any };
}
function request(bytes=pdf) { return new Request('https://edge.example', {method:'POST',headers:{authorization:'Bearer user', 'x-evidence-id':id, 'content-type':'application/octet-stream'},body:bytes}); }
test('recognizes only complete allowed signatures and enforces exact 10 MiB inclusive', async () => {
 expect(await inspectEvidenceBytes(pdf)).toMatchObject({mime_type:'application/pdf',byte_size:pdf.length});
 const full=new Uint8Array(10485760);full.fill(32);full.set(pdf.slice(0,9));full.set(new TextEncoder().encode('%%EOF\n'),full.length-6);
 expect((await inspectEvidenceBytes(full)).byte_size).toBe(10485760);
 for(const b of [new Uint8Array(),new Uint8Array(10485761),new TextEncoder().encode('<svg/>'),pdf.slice(0,20),new Uint8Array([137,80,78,71,13,10,26,10]),new Uint8Array([255,216,255,217])]) await expect(inspectEvidenceBytes(b)).rejects.toThrow();
});
test('authenticates before reading bytes or invoking privileged Storage',async()=>{
 const fetcher=vi.fn(async()=>Response.json({code:'42501'},{status:403}));
 const req=request();const read=vi.spyOn(req,'arrayBuffer');const result=await createEvidenceUploadHandler(config,fetcher)(req);
 expect(result.status).toBe(403);expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0][0])).toContain('/rpc/pilot_co_evidence_context_v1');expect(read).not.toHaveBeenCalled();
});
test('writes create-only, verifies read-back and submits server observations to service-only attestation',async()=>{
 const ctx=await context();let exists=false;const calls:any[]=[];
 const fetcher=vi.fn(async(url:any,init:any)=>{calls.push([String(url),init]);if(String(url).includes('/rpc/pilot_co_evidence_context_v1'))return Response.json({...ctx,object:exists?{id:oid,version:null}:null});if(String(url).includes('/rpc/pilot_co_evidence_attest_v1'))return Response.json({id,state:'verified'});if(init.method==='POST'){exists=true;return Response.json({Key:'ignored'});}return new Response(pdf);});
 expect((await createEvidenceUploadHandler(config,fetcher)(request())).status).toBe(200);
 const write=calls.find(([u,o])=>u.includes('/storage/')&&o.method==='POST');expect(write[1].headers['x-upsert']).toBe('false');expect(write[1].redirect).toBe('error');
 const attest=calls.find(([u])=>u.includes('attest'));expect(JSON.parse(attest[1].body)).toEqual({p_actor_id:actor,p_evidence_id:id,p_object_id:oid,p_object_version:null,p_byte_size:pdf.length,p_mime_type:'application/pdf',p_sha256:ctx.sha256});
});
test('lost write response verifies existing bytes without another upload',async()=>{
 const ctx=await context();let exists=false;let writes=0;
 const fetcher=vi.fn(async(url:any,init:any)=>{if(String(url).includes('context'))return Response.json({...ctx,object:exists?{id:oid,version:'v1'}:null});if(String(url).includes('attest'))return Response.json({id,state:'verified'});if(init.method==='POST'){writes++;exists=true;throw new Error('lost');}return new Response(pdf);});
 expect((await createEvidenceUploadHandler(config,fetcher)(request())).status).toBe(200);expect(writes).toBe(1);
 expect((await createEvidenceUploadHandler(config,fetcher)(request())).status).toBe(200);expect(writes).toBe(1);
});
test.each(['digest','identity','denied'])('replacement or %s during verification never attests',async(kind)=>{
 const ctx=await context();let reads=0;const calls:string[]=[];
 const fetcher=vi.fn(async(url:any)=>{calls.push(String(url));if(String(url).includes('context')){reads++;if(kind==='denied'&&reads>1)return Response.json({code:'42501'},{status:403});return Response.json({...ctx,object:{id:kind==='identity'&&reads>1?actor:oid,version:'v1'}});}return new Response(kind==='digest'?new TextEncoder().encode('%PDF-1.7 changed %%EOF\n'):pdf);});
 expect((await createEvidenceUploadHandler(config,fetcher)(request())).status).not.toBe(200);expect(calls.some(u=>u.includes('attest'))).toBe(false);
});
test('mismatched byte commitment and hostile canonical path never reach Storage',async()=>{
 for(const change of [{byte_size:1},{mime_type:'image/png'},{path:'../other'},{sha256:'b'.repeat(64)}]){
 const ctx=await context();const fetcher=vi.fn(async()=>Response.json({...ctx,...change}));expect((await createEvidenceUploadHandler(config,fetcher)(request())).status).not.toBe(200);expect(fetcher).toHaveBeenCalledTimes(1);
 }
});

test('valid PNG/JPEG signatures are distinct and CRC, terminator and MIME mismatches fail',async()=>{
 const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=','base64'));
 // Build a synthetic complete PNG with a verified chunk CRC, not an actual user image.
 const chunk=(type:string,data:number[])=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);b.set(data,8);let c=0xffffffff;for(const v of b.subarray(4,8+data.length)){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}b.writeUInt32BE((c^0xffffffff)>>>0,8+data.length);return b;};
 const validPng=Buffer.concat([png.subarray(0,8),chunk('IHDR',[0,0,0,1,0,0,0,1,8,2,0,0,0]),chunk('IDAT',[120,156,1]),chunk('IEND',[])]);
 const jpg=new Uint8Array([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,3,255,0,4,255,217]);
 expect((await inspectEvidenceBytes(validPng)).mime_type).toBe('image/png');expect((await inspectEvidenceBytes(jpg)).mime_type).toBe('image/jpeg');
 const bad=validPng.slice();bad[bad.length-1]^=1;
 for(const bytes of [bad,jpg.slice(0,-1),new Uint8Array([...jpg,0]),new TextEncoder().encode('<html>%PDF-1.7\n%%EOF\n</html>')])await expect(inspectEvidenceBytes(bytes)).rejects.toThrow();
});
test('fragmented stream is measured even with lying Content-Length and canceled beyond the bound',async()=>{
 const {boundedBytes}=await import('../../supabase/functions/_shared/co-evidence');
 const small=new Request('https://edge.example',{method:'POST',headers:{'content-length':'1'},body:new ReadableStream({start(c){c.enqueue(pdf.slice(0,4));c.enqueue(pdf.slice(4));c.close();}}),duplex:'half'} as any);
 expect(await boundedBytes(small)).toEqual(pdf);
 let cancelled=false;const large=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(10485760));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}}),{headers:{'content-length':'1'}});
 await expect(boundedBytes(large)).rejects.toThrow('limit');expect(cancelled).toBe(true);
});
test('authorization failure never pulls the request byte stream',async()=>{
 const stream=new ReadableStream<Uint8Array>({pull(){throw new Error('Must not read unauthorized bytes');}},{highWaterMark:0});
 const reader=vi.spyOn(stream,'getReader');const req=new Request('https://edge.example',{method:'POST',headers:{authorization:'Bearer user','x-evidence-id':id},body:stream,duplex:'half'} as any);
 const f=vi.fn(async()=>Response.json({code:'42501'},{status:403}));expect((await createEvidenceUploadHandler(config,f)(req)).status).toBe(403);expect(reader).not.toHaveBeenCalled();expect(f).toHaveBeenCalledTimes(1);
});
test('concurrent uploads reconcile one create-only object; conflict and lost attestation responses never overwrite',async()=>{
 const ctx=await context();let exists=false,created=0,attested=0;let release!:()=>void;const barrier=new Promise<void>(r=>{release=r});let initial=0;
 const f=vi.fn(async(u:any,o:any)=>{if(String(u).includes('context')){if(!exists&&initial++<2){if(initial===2)release();await barrier;return Response.json(ctx);}return Response.json({...ctx,object:{id:oid,version:null}});}if(String(u).includes('attest')){attested++;if(attested===1)throw new Error('Lost attestation');return Response.json({id,state:'verified'});}if(o.method==='POST'){if(exists)return Response.json({error:'exists'},{status:409});exists=true;created++;return Response.json({});}return new Response(pdf);});
 const responses=await Promise.all([createEvidenceUploadHandler(config,f)(request()),createEvidenceUploadHandler(config,f)(request())]);expect(responses.map(r=>r.status).sort()).toEqual([200,502]);expect(created).toBe(1);expect((await createEvidenceUploadHandler(config,f)(request())).status).toBe(200);expect(created).toBe(1);
});
