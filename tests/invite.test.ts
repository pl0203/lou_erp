import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test } from 'vitest'
const source = readFileSync('supabase/functions/invite-user/index.ts', 'utf8').replace(/^import .*\n/gm, '')
const js = ts.transpile(source, {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})
for (const profile of [{role:'executive',is_active:false}, {role:'executive'}, {role:'sales_person',is_active:true}, null, {role:'executive',is_active:true,testError:true}, {role:'executive',is_active:true,invalidRole:true}, {role:'executive',is_active:true,allow:true}]) {
 test(`${profile?.allow ? "permits" : "denies"} caller ${JSON.stringify(profile)}`, async () => {
  let invited=0
  let handler: any
  const client={auth:{getUser:async()=>({data:{user:{id:'a'}},error:null}),admin:{inviteUserByEmail:async()=>{invited++;return {data:{user:{id:'new'}},error:null}}}},from:()=>{const q:any={select:()=>q,eq:()=>q,single:async()=>({data:profile,error:profile?.testError ? new Error('read failure') : null}),insert:async()=>({error:null})};return q}}
  new Function('serve','createClient','Deno',js)((h:any)=>{handler=h},()=>client,{env:{get:()=> 'test'}})
  const response = await handler(new Request('https://example.test/invite',{method:'POST',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify({email:'test@example.test',full_name:'Test',role:profile?.invalidRole?'superadmin':'sales_person'})}))
  expect(invited).toBe(profile?.allow ? 1 : 0)
  if (profile?.allow) expect(response.status).toBe(200)
  else expect(response.status).toBeGreaterThanOrEqual(400)
 })
}
