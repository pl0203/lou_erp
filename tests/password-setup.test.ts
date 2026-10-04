import {afterEach,expect,test,vi} from 'vitest'
import {GoTrueClient} from '@supabase/auth-js'
import {preparePasswordSetup} from '../src/lib/passwordSetup'
const original=window.location.href
const clients:GoTrueClient[]=[]
afterEach(()=>{clients.forEach(c=>c.stopAutoRefresh());window.history.replaceState({},'',original)})
function sdk(fragment:string,fail=false){
 window.history.replaceState({},'',`/reset-password${fragment}`)
 const callbackUrl=window.location.href
 const user={id:'invited-user',email:'invitee@example.test',aud:'authenticated',created_at:'2026-01-01T00:00:00Z'}
 const old={access_token:'synthetic-old-session',refresh_token:'synthetic-old-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{...user,id:'old-executive'}}
 const key='audit-'+clients.length
 const values:Record<string,string>={[key]:JSON.stringify(old)}
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify(fail?{message:'Invalid callback token'}:user),{status:fail?401:200,headers:{'content-type':'application/json'}}))
 const auth=new GoTrueClient({url:'https://synthetic.example.test/auth/v1',storageKey:key,storage:{getItem:k=>values[k]??null,setItem:(k,v)=>{values[k]=v},removeItem:k=>{delete values[k]}},autoRefreshToken:false,persistSession:true,detectSessionInUrl:true,fetch:fetcher})
 clients.push(auth);return {auth,callbackUrl,fetcher}
}
for(const type of ['invite','recovery'])test(`valid ${type} callback retains verified identity after SDK removes URL hash`,async()=>{
 const {auth,callbackUrl}=sdk(`#access_token=synthetic-new-session&refresh_token=synthetic-new-refresh&expires_in=3600&token_type=bearer&type=${type}`)
 expect(await preparePasswordSetup(auth,callbackUrl)).toEqual({identity:{userId:'invited-user',email:'invitee@example.test'},error:null})
 expect(window.location.hash).toBe('')
})
for(const fragment of ['', '#error=access_denied&error_code=otp_expired&error_description=Expired','#type=invite','#access_token=synthetic-new-session&type=invite','#access_token=synthetic-new-session&refresh_token=synthetic-new-refresh&type=signup'])test(`rejects invalid callback context ${fragment} despite a stored executive session`,async()=>{
 const {auth,callbackUrl}=sdk(fragment)
 const result=await preparePasswordSetup(auth,callbackUrl)
 expect(result.identity).toBeNull();expect(result.error).toBeTruthy()
})
test('rejects SDK token verification failure instead of binding to stored account',async()=>{
 const {auth,callbackUrl}=sdk('#access_token=synthetic-new-session&refresh_token=synthetic-new-refresh&expires_in=3600&token_type=bearer&type=invite',true)
 expect((await preparePasswordSetup(auth,callbackUrl)).identity).toBeNull()
})
test('rejects changed session between callback initialization and capture',async()=>{
 const auth={initialize:async()=>({error:null}),getSession:async()=>({data:{session:{access_token:'different',user:{id:'old-executive'}}},error:null})}
 const result=await preparePasswordSetup(auth as any,'https://erp.example.test/reset-password#access_token=expected&refresh_token=refresh&expires_in=3600&token_type=bearer&type=invite')
 expect(result.identity).toBeNull()
})
test('password request stays bound to verified account A if the shared session changes to B after the preflight read',async()=>{
 const {updateBoundPassword}=await import('../src/lib/passwordSetup')
 const jwt=(id:string)=>[btoa(JSON.stringify({alg:'HS256',typ:'JWT'})),btoa(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})),btoa('synthetic-signature')].map(part=>part.replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')).join('.')
 const tokenA=jwt('account-a'),tokenB=jwt('account-b')
 const userA={id:'account-a',email:'a@example.test',aud:'authenticated',created_at:'2026-01-01T00:00:00Z'}
 let current={access_token:tokenA,refresh_token:'synthetic-refresh-a',user:userA}
 const shared={getSession:async()=>{const snapshot=current;current={access_token:tokenB,refresh_token:'synthetic-refresh-b',user:{...userA,id:'account-b'}};return {data:{session:snapshot},error:null}}}
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(userA),{status:200,headers:{'content-type':'application/json'}}))
 const createScoped=()=>{
   const auth=new GoTrueClient({url:'https://synthetic.example.test/auth/v1',storageKey:'bound-password-audit',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,fetch:fetcher});clients.push(auth);return auth
 }
 expect(await updateBoundPassword(shared as any,createScoped,'account-a','Synthetic8!')).toEqual({error:null,sessionChanged:false})
 const writes=fetcher.mock.calls.filter((call:any)=>call[1]?.method==='PUT') as any[]
 expect(current.user.id).toBe('account-b');expect(writes).toHaveLength(1)
 expect(writes[0][1].headers.Authorization).toBe(`Bearer ${tokenA}`)
})
for(const type of ['invite','recovery'])test(`installed SDK completes valid ${type} callback and account-bound password update`,async()=>{
 const token=[btoa(JSON.stringify({alg:'HS256',typ:'JWT'})),btoa(JSON.stringify({sub:'invited-user',exp:Math.floor(Date.now()/1000)+3600})),btoa('synthetic-signature')].map(part=>part.replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')).join('.')
 const {auth,callbackUrl}=sdk(`#access_token=${token}&refresh_token=synthetic-refresh&expires_in=3600&token_type=bearer&type=${type}`)
 const verified=await preparePasswordSetup(auth,callbackUrl)
 expect(verified.identity?.userId).toBe('invited-user')
 const {updateBoundPassword}=await import('../src/lib/passwordSetup')
 const user={id:'invited-user',email:'invitee@example.test',aud:'authenticated',created_at:'2026-01-01T00:00:00Z'}
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(user),{status:200,headers:{'content-type':'application/json'}}))
 const scoped=()=>{const c=new GoTrueClient({url:'https://synthetic.example.test/auth/v1',storageKey:`complete-${type}`,persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,fetch:fetcher});clients.push(c);return c}
 expect(await updateBoundPassword(auth,scoped,verified.identity!.userId,'Synthetic8!')).toEqual({error:null,sessionChanged:false})
 const writes=fetcher.mock.calls.filter((call:any)=>call[1]?.method==='PUT') as any[]
 expect(writes).toHaveLength(1);expect(writes[0][1].headers.Authorization).toBe(`Bearer ${token}`)
})
