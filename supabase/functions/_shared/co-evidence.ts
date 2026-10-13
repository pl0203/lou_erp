/** Bounded, download-only untrusted documents. This is not malware/active-content screening. */
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MIME_EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' } as const;
export type EvidenceMime = keyof typeof MIME_EXT;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function inspectEvidenceBytes(bytes: Uint8Array<ArrayBuffer>) {
 if (!bytes.length || bytes.length > MAX_EVIDENCE_BYTES) throw new Error('File harus 1 byte sampai 10 MiB.');
 const ascii = (start:number,end:number) => new TextDecoder('ascii').decode(bytes.subarray(start,end));
 let mime_type:EvidenceMime;
 if (/^%PDF-(1\.[0-7]|2\.0)(?:\r|\n)/.test(ascii(0,10)) && /%%EOF[\x00\t\r\n ]*$/.test(ascii(Math.max(0,bytes.length-1024),bytes.length))) mime_type='application/pdf';
 else if ([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) {
  let offset=8, ihdr=false, data=false, end=false;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  while(offset+12<=bytes.length) {
   const length=view.getUint32(offset), type=ascii(offset+4,offset+8);
   if(length>bytes.length-offset-12 || !/^[A-Za-z]{4}$/.test(type)) throw new Error('PNG tidak lengkap.');
   let crc=0xffffffff;
   for(let i=offset+4;i<offset+8+length;i++){crc^=bytes[i];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
   if(((crc^0xffffffff)>>>0)!==view.getUint32(offset+8+length))throw new Error('PNG checksum tidak valid.');
   if(!ihdr){if(type!=='IHDR'||length!==13||!view.getUint32(offset+8)||!view.getUint32(offset+12))throw new Error('PNG header tidak valid.');ihdr=true;}
   else if(type==='IHDR')throw new Error('PNG header ganda.');
   if(type==='IDAT'&&length>0)data=true;
   offset+=length+12;
   if(type==='IEND'){if(length!==0||!data||offset!==bytes.length)throw new Error('PNG tidak lengkap.');end=true;break;}
  }
  if(!end)throw new Error('PNG tidak lengkap.');mime_type='image/png';
 } else if(bytes[0]===255&&bytes[1]===216) {
  let offset=2, frame=false, scan=false, end=false;
  while(offset<bytes.length){
   if(bytes[offset++]!==255)throw new Error('JPEG marker tidak valid.');
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];
   if(marker===217){end=scan&&frame&&offset===bytes.length;break;}
   if(marker===0||marker===216||marker===undefined)throw new Error('JPEG marker tidak valid.');
   if(marker>=208&&marker<=215)continue;
   if(offset+2>bytes.length)break;
   const length=(bytes[offset]<<8)|bytes[offset+1];if(length<2||offset+length>bytes.length)break;
   if([192,193,194].includes(marker)){if(length<8||!((bytes[offset+3]<<8)|bytes[offset+4])||!((bytes[offset+5]<<8)|bytes[offset+6]))throw new Error('JPEG frame tidak valid.');frame=true;}
   offset+=length;
   if(marker===218){scan=true;while(offset<bytes.length){if(bytes[offset]===255&&bytes[offset+1]!==0&&bytes[offset+1]!==255&&!(bytes[offset+1]>=208&&bytes[offset+1]<=215))break;if(bytes[offset]===255)offset++;offset++;}}
  }
  if(!end)throw new Error('JPEG tidak lengkap.');mime_type='image/jpeg';
 } else throw new Error('Hanya PDF, PNG, atau JPEG lengkap yang didukung.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 return {mime_type,byte_size:bytes.length,sha256};
}
export async function boundedBytes(source:Request|Response,limit=MAX_EVIDENCE_BYTES):Promise<Uint8Array<ArrayBuffer>>{
 const length=source.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw new Error('Invalid byte length');
 if(!source.body)throw new Error('Missing bytes');
 const reader=source.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Byte limit exceeded');}chunks.push(value);}}finally{reader.releaseLock();}
 if(!size)throw new Error('Missing bytes');const result=new Uint8Array(size);let offset=0;for(const part of chunks){result.set(part,offset);offset+=part.length;}return result;
}
export type Config={url:string;anonKey:string;serviceKey:string};
export type Fetch=(url:string|URL|Request,init?:RequestInit)=>Promise<Response>;
export const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type, x-evidence-id','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Content-Disposition','Cache-Control':'no-store'};
export const answer=(status:number,code:string,message:string)=>Response.json({code,message},{status,headers:cors});
export class BoundaryError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export type Context={version:'1';id:string;actor_id:string;bucket:'co-evidence';path:string;filename:string;mime_type:EvidenceMime;byte_size:number;sha256:string;state:'pending'|'verified'|'finalized';object:null|{id:string;version:string|null}};
export function parseContext(value:unknown,id:string):Context{
 const c=value as Context;
 if(!c||c.version!=='1'||c.id!==id||!uuidPattern.test(c.actor_id)||c.bucket!=='co-evidence'||!Object.hasOwn(MIME_EXT,c.mime_type)||c.path!==`${id}.${MIME_EXT[c.mime_type]}`||c.filename!==`evidence-${id}.${MIME_EXT[c.mime_type]}`||!Number.isInteger(c.byte_size)||c.byte_size<1||c.byte_size>MAX_EVIDENCE_BYTES||!/^[a-f0-9]{64}$/.test(c.sha256)||!['pending','verified','finalized'].includes(c.state)||c.object!==null&&(!c.object||!uuidPattern.test(c.object.id)||c.object.version!==null&&(typeof c.object.version!=='string'||c.object.version.length>512)))throw new BoundaryError(502,'CO_EVIDENCE_INVALID','Invalid evidence authorization');
 return c;
}
export function connection(config:Config,authorization:string,fetcher:Fetch){
 const url=new URL(config.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!config.anonKey||!config.serviceKey)throw new Error('Evidence service unavailable');
 const origin=url.origin;
 async function rpc(name:string,body:unknown,service=false){
  const r=await fetcher(`${origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{Authorization:service?`Bearer ${config.serviceKey}`:authorization,apikey:service?config.serviceKey:config.anonKey,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok){let code='CO_EVIDENCE_UNAVAILABLE';try{const b=await r.json();if(typeof b.code==='string'&&/^[A-Z0-9_]{5,40}$/.test(b.code))code=b.code;}catch{}
   throw new BoundaryError(r.status===401?401:r.status===403?403:r.status===409?409:502,code,'Evidence authority or binding unavailable');}
  return await r.json();
 }
 const context=async(id:string,purpose:'upload'|'download')=>parseContext(await rpc('pilot_co_evidence_context_v1',{p_evidence_id:id,p_purpose:purpose}),id);
 const object=(c:Context,write?:Uint8Array<ArrayBuffer>)=>fetcher(`${origin}/storage/v1/object/${write?'':'authenticated/'}co-evidence/${c.path}`,{method:write?'POST':'GET',headers:{Authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,...(write?{'Content-Type':c.mime_type,'x-upsert':'false'}:{})},...(write?{body:write}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 return {rpc,context,object};
}
export function sameObject(a:Context,b:Context){return a.id===b.id&&a.actor_id===b.actor_id&&a.path===b.path&&a.sha256===b.sha256&&a.byte_size===b.byte_size&&a.mime_type===b.mime_type&&!!a.object&&a.object.id===b.object?.id&&a.object.version===b.object?.version;}
export async function verifyObject(response:Response,c:Context){if(!response.ok)throw new Error('Stored evidence unavailable');const bytes=await boundedBytes(response);const facts=await inspectEvidenceBytes(bytes);if(facts.sha256!==c.sha256||facts.mime_type!==c.mime_type||facts.byte_size!==c.byte_size)throw new Error('Stored evidence changed');return {bytes,facts};}
export const failure=(error:unknown)=>error instanceof BoundaryError?answer(error.status,error.code,error.message):answer(502,'CO_EVIDENCE_UNAVAILABLE','Evidence verification unavailable; reconcile before retry');
export function platformStart(handler:(config:Config)=>(request:Request)=>Promise<Response>){const platform=(globalThis as unknown as {Deno?:{env:{get(n:string):string|undefined};serve(h:(r:Request)=>Promise<Response>):void}}).Deno;if(platform)platform.serve(handler({url:platform.env.get('SUPABASE_URL')??'',anonKey:platform.env.get('SUPABASE_ANON_KEY')??'',serviceKey:platform.env.get('SUPABASE_SERVICE_ROLE_KEY')??''}));}
