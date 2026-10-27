import type { ExtractedReport, ImportScope } from './types'

export const IMPORT_HELP='PDF/XLSX maksimal 10 MiB. XLSX: maksimal 50 MiB konten hasil dekompresi (bukan batas total memori), rasio 100:1 per entri dan total, 2.000 entri ZIP, 20 lembar, total 10.000 baris dan 100.000 sel termasuk area gabungan, 256 kolom. Teks sumber maksimal 128 Ki karakter terurai dan hasil maksimal 4 MiB (batas estimasi JSON konservatif). Batas pemrosesan 30 detik. Makro, tautan eksternal, enkripsi, lembar tersembunyi, dan format tidak didukung harus diperiksa dan dientri manual. Nilai formula tersimpan perlu konfirmasi; formula tidak dihitung. Jumlah dan Retur tetap terpisah.'
export type ImportRequest={requestId:string;scope:ImportScope;format:'pdf'|'xlsx';sha256:string;bytes:Uint8Array}
export type ImportResponse={requestId:string;scope:ImportScope;result?:ExtractedReport;error?:string}
let active:(()=>void)|null=null
const sameScope=(a:ImportScope,b:ImportScope)=>a&&b&&a.actorId===b.actorId&&a.customerId===b.customerId&&a.reportMonth===b.reportMonth&&a.epoch===b.epoch
const fallback=(format:'pdf'|'xlsx',sha256:string,code:string):ExtractedReport=>({format,sha256,parserVersion:'co-worker-1',sourceRows:[],sections:[],periodCandidates:[],customerCandidates:[],warnings:[`manual_review:${code}`]})
/** One active worker across all scopes. No file URLs or browser storage are allocated. */
export function extractReport(file:File,scope:ImportScope,signal:AbortSignal):Promise<ExtractedReport>{
 active?.();signal.throwIfAborted()
 const boundScope={...scope},requestId=crypto.randomUUID(),format=/\.pdf$/i.test(file.name)?'pdf':'xlsx'
 return new Promise((resolve,reject)=>{
  let worker:Worker|null=null,done=false,hash=''
  const finish=(result?:ExtractedReport,error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);worker?.terminate();if(active===abort)active=null;if(error)reject(error);else resolve(result!)}
  const abort=()=>finish(undefined,new DOMException('Import cancelled','AbortError'))
  const timer=setTimeout(()=>finish(fallback(format,hash,'processing_timeout')),30000)
  active=abort;signal.addEventListener('abort',abort,{once:true})
  void(async()=>{
   try{
    if(file.size>10*1024*1024)return finish(fallback(format,hash,'byte_limit'))
    if(!/\.(pdf|xlsx)$/i.test(file.name))return finish(fallback(format,hash,'unsupported_extension'))
    const bytes=new Uint8Array(await file.arrayBuffer());if(done)return
    const valid=format==='xlsx'?bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4:new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-'
    if(!valid)return finish(fallback(format,hash,'signature_mismatch'))
    hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(done)return
    worker=new Worker(new URL('./import.worker.ts',import.meta.url),{type:'module'})
    worker.onmessage=(event:MessageEvent<ImportResponse>)=>{const response=event.data;if(done||response?.requestId!==requestId||!sameScope(response.scope,boundScope))return;finish(response.result??fallback(format,hash,response.error??'worker_error'))}
    worker.onerror=()=>finish(fallback(format,hash,'worker_error'))
    const message:ImportRequest={requestId,scope:boundScope,format,sha256:hash,bytes};worker.postMessage(message,[bytes.buffer])
   }catch(e){if(!done)finish(fallback(format,hash,'worker_error'),signal.aborted?e:undefined)}
  })()
 })
}
