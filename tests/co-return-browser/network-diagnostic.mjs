import {createHash} from 'node:crypto';
// Diagnostics only. This helper never decides whether a request is permitted.
export function blockedNetworkDiagnostic(kind,rawUrl,type,initiator){
 const resourceType=['Document','Stylesheet','Image','Media','Font','Script','TextTrack','XHR','Fetch','Prefetch','EventSource','WebSocket','Manifest','SignedExchange','Ping','CSPViolationReport','Preflight','Other'].includes(type)?type:'Other';
 let scheme='[invalid]',origin='[invalid]',path='[redacted]';
 try{const url=new URL(rawUrl);scheme=/^[a-z][a-z0-9+.-]{0,24}:$/.test(url.protocol)?url.protocol:'[other]';origin=['http:','https:','ws:','wss:'].includes(url.protocol)?url.origin:'[opaque]';if(url.pathname==='/'||url.pathname==='/favicon.ico')path=url.pathname;else if(url.protocol==='about:'&&url.pathname==='blank')path='blank';}catch{}
 const result={kind,scheme,origin,path,resourceType};
 if(initiator!==undefined)result.initiatorType=['parser','script','preload','SignedExchange','preflight','other'].includes(initiator)?initiator:'Other';
 if(scheme==='data:'){
  result.dataMediaType=/^data:(image\/(?:svg\+xml|png|gif|webp|jpeg))(?:[;,])/i.exec(rawUrl)?.[1]?.toLowerCase()??'[other]';
  result.dataUrlBytes=Buffer.byteLength(rawUrl,'utf8');
  result.dataUrlSha256=createHash('sha256').update(rawUrl).digest('hex');
 }
 return result;
}
