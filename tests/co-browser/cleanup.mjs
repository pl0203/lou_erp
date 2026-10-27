// Observe immediately after spawn: exit alone does not prove inherited pipes closed.
export function observeOwnedBrowser(browser) {
 const observation={closed:false,promise:null};
 observation.promise=new Promise(resolve=>browser.once('close',()=>{observation.closed=true;resolve()}));
 return observation;
}
async function within(promise,milliseconds){
 let timer;try{return await Promise.race([promise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),milliseconds)})])}finally{clearTimeout(timer)}
}
export async function stopOwnedBrowser(browser,observation,requestClose,{timeoutMs=5000}={}) {
 if(observation.closed)return;
 // The browser protocol requests orderly profile flush and child shutdown first.
 // A closing socket may reject the command even when Chrome exits successfully.
 const requested=Promise.resolve().then(requestClose).catch(()=>{});
 await within(Promise.all([requested,observation.promise]),timeoutMs);
 if(observation.closed)return;
 browser.kill('SIGTERM');
 if(await within(observation.promise,timeoutMs))return;
 browser.kill('SIGKILL');
 if(!await within(observation.promise,timeoutMs))throw Error('Owned Chrome termination unproven; temporary profile retained');
}
