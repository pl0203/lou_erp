// Diagnostics only. This helper never decides whether a request is permitted.
export function blockedNetworkDiagnostic(kind,rawUrl,type){
 const resourceType=['Document','Stylesheet','Image','Media','Font','Script','TextTrack','XHR','Fetch','Prefetch','EventSource','WebSocket','Manifest','SignedExchange','Ping','CSPViolationReport','Preflight','Other'].includes(type)?type:'Other';
 let scheme='[invalid]',origin='[invalid]',path='[redacted]';
 try{const url=new URL(rawUrl);scheme=/^[a-z][a-z0-9+.-]{0,24}:$/.test(url.protocol)?url.protocol:'[other]';origin=['http:','https:','ws:','wss:'].includes(url.protocol)?url.origin:'[opaque]';if(url.pathname==='/'||url.pathname==='/favicon.ico')path=url.pathname;else if(url.protocol==='about:'&&url.pathname==='blank')path='blank';}catch{}
 return {kind,scheme,origin,path,resourceType};
}
