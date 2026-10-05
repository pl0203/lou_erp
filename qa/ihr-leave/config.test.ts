import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const config=JSON.parse(readFileSync('vercel.json','utf8'));
test('candidate uses standalone synthetic entry without changing backend config',()=>{expect(config.buildCommand).toBe('node qa/ihr-leave/build.mjs');expect(config.outputDirectory).toBe('dist-ihr-leave-qa');expect(config.rewrites).toEqual([{source:'/(.*)',destination:'/candidate.html'}]);expect(config.env).toBeUndefined();expect(config.alias).toBeUndefined();expect(config.headers[0].headers[0].value).toContain("connect-src 'none'");});
test('candidate source does not contain absolute local paths or credentials',()=>{for(const name of ['main.tsx','auth.ts','supabase.ts','build.mjs']){const text=readFileSync('qa/ihr-leave/'+name,'utf8');expect(text).not.toMatch(/Bearer\s|eyJ[a-zA-Z0-9_-]{20,}|service_role|\/workspace\/scratch\//);}});
