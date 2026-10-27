import {answer,boundedBytes,connection,cors,failure,platformStart,sameObject,uuidPattern,verifyObject} from '../_shared/co-evidence.ts';
import type {Config,Fetch} from '../_shared/co-evidence.ts';
export function createEvidenceDownloadHandler(config:Config,fetcher:Fetch=fetch){return async(request:Request):Promise<Response>=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return answer(405,'22023','POST required');
 const authorization=request.headers.get('authorization');if(!authorization||!/^Bearer \S+$/.test(authorization))return answer(401,'PT401','Authentication required');
 let id:string;try{const body=JSON.parse(new TextDecoder().decode(await boundedBytes(request,1024)));if(!body||Array.isArray(body)||Object.keys(body).join()!=='evidence_id'||typeof body.evidence_id!=='string'||!uuidPattern.test(body.evidence_id))throw new Error();id=body.evidence_id;}catch{return answer(400,'22023','Evidence ID required');}
 try{const api=connection(config,authorization,fetcher),ctx=await api.context(id,'download');if(ctx.state!=='finalized'||!ctx.object)throw new Error('Evidence unavailable');
  const {bytes}=await verifyObject(await api.object(ctx),ctx);
  const after=await api.context(id,'download');if(after.state!=='finalized'||!sameObject(ctx,after))throw new Error('Evidence changed');
  return new Response(bytes,{headers:{...cors,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${ctx.filename}"`,'X-Content-Type-Options':'nosniff','Content-Length':String(bytes.length)}});
 }catch(error){return failure(error);}
};}
platformStart(createEvidenceDownloadHandler);
