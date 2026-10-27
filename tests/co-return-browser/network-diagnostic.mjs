import {createHash} from 'node:crypto';
// Sanitized diagnostics; Fetch admission is independently enforced by run.mjs.
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

// Classify one proven browser-owned, local SVG event, never an actual Fetch request.
// Provenance and exact upstream revision are documented in README.md.
export function isBuiltinCalendarImageDiagnostic(diagnostic){
 return diagnostic?.kind==='off-origin-network-attempt'&&diagnostic.scheme==='data:'&&
  diagnostic.resourceType==='Image'&&diagnostic.initiatorType==='other'&&
  diagnostic.dataMediaType==='image/svg+xml'&&diagnostic.dataUrlBytes===382&&
  diagnostic.dataUrlSha256==='04e449d20d0365d881a54ed24af7ed00fe79dd9f9e601248f4fd7793003924f2';
}
