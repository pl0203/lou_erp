import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const config=JSON.parse(readFileSync('vercel.json','utf8'));
test('candidate uses standalone synthetic entry without changing backend config',()=>{expect(config.buildCommand).toBe('node qa/ihr-leave/build.mjs');expect(config.outputDirectory).toBe('dist-ihr-leave-qa');expect(config.rewrites).toEqual([{source:'/(.*)',destination:'/candidate.html'}]);expect(config.env).toBeUndefined();expect(config.alias).toBeUndefined();expect(config.headers[0].headers[0].value).toContain("connect-src 'none'");});
test('candidate source does not contain absolute local paths or credentials',()=>{for(const name of ['main.tsx','auth.ts','supabase.ts','build.mjs']){const text=readFileSync('qa/ihr-leave/'+name,'utf8');expect(text).not.toMatch(/Bearer\s|eyJ[a-zA-Z0-9_-]{20,}|service_role|\/workspace\/scratch\//);}});

test('synthetic build never inherits deployment backend environment',async()=>{
 const {execFileSync}=await import('node:child_process')
 const result=execFileSync(process.execPath,['qa/ihr-leave/build.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',VITE_SUPABASE_URL:'https://synthetic-preview-env.supabase.co',VITE_SUPABASE_ANON_KEY:'synthetic-preview-key'},encoding:'utf8'})
 expect(JSON.parse(result.slice(result.lastIndexOf('\n{')+1)).syntheticOnly).toBe(true)
},30_000)
