import { answer,boundedBytes,connection,cors,failure,inspectEvidenceBytes,platformStart,sameObject,uuidPattern,verifyObject } from '../_shared/co-evidence.ts';
import type { Config,Fetch } from '../_shared/co-evidence.ts';
export { inspectEvidenceBytes } from '../_shared/co-evidence.ts';
/** Canonical ID only. No signed capability, caller object path, overwrite or public read. */
export function createEvidenceUploadHandler(config:Config,fetcher:Fetch=fetch){return async(request:Request):Promise<Response>=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return answer(405,'22023','POST required');
 const authorization=request.headers.get('authorization'),id=request.headers.get('x-evidence-id');
 if(!authorization||!/^Bearer \S+$/.test(authorization))return answer(401,'PT401','Authentication required');
 if(!id||!uuidPattern.test(id))return answer(400,'22023','Evidence ID required');
 try{
  const api=connection(config,authorization,fetcher);let ctx=await api.context(id,'upload');
  // The authority check intentionally precedes reading any file bytes.
  const bytes=await boundedBytes(request),facts=await inspectEvidenceBytes(bytes);
  if(facts.mime_type!==ctx.mime_type||facts.byte_size!==ctx.byte_size||facts.sha256!==ctx.sha256)return answer(400,'22023','File does not match registration');
  if(!ctx.object){
   // A failed/lost write is ambiguous. Inspect the same canonical object before any retry.
   try{const written=await api.object(ctx,bytes);if(!written.ok&&![400,409].includes(written.status))throw new Error('Upload uncertain');}catch{}
   ctx=await api.context(id,'upload');
  }
  if(!ctx.object)throw new Error('Upload not confirmed');
  const verified=await verifyObject(await api.object(ctx),ctx);
  const after=await api.context(id,'upload');if(!sameObject(ctx,after))throw new Error('Evidence identity changed');
  const result=await api.rpc('pilot_co_evidence_attest_v1',{p_actor_id:ctx.actor_id,p_evidence_id:id,p_object_id:ctx.object.id,p_object_version:ctx.object.version,p_byte_size:verified.facts.byte_size,p_mime_type:verified.facts.mime_type,p_sha256:verified.facts.sha256},true);
  if(result?.id!==id||!['verified','finalized'].includes(result.state))throw new Error('Attestation not confirmed');
  return Response.json({id,state:result.state},{headers:cors});
 }catch(error){return failure(error);}
};}
platformStart(createEvidenceUploadHandler);
