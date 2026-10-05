// Candidate-only static build. Stable application configuration is unchanged.
import {build} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const qa=path.dirname(fileURLToPath(import.meta.url)),repository=path.resolve(qa,'../..'),output=path.join(repository,'dist-ihr-leave-qa');
const revision=process.env.VERCEL_GIT_COMMIT_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim();
await build({root:qa,configFile:false,plugins:[react(),tailwindcss()],publicDir:false,resolve:{alias:[{find:/.*\/AuthContext$/,replacement:path.join(qa,'auth.ts')},{find:/.*\/supabase$/,replacement:path.join(qa,'supabase.ts')}]},define:{'import.meta.env.VITE_QA_REVISION':JSON.stringify(revision)},build:{outDir:output,emptyOutDir:true,sourcemap:false,rollupOptions:{input:{candidate:path.join(qa,'candidate.html'),narrow:path.join(qa,'narrow.html')}}}});
function filesUnder(d){return readdirSync(d).sort().flatMap(n=>{const f=path.join(d,n);return statSync(f).isDirectory()?filesUnder(f):[f]})}
const files=filesUnder(output),text=files.map(f=>readFileSync(f,'utf8')).join('\n');
if(text.includes('/workspace/')||text.includes('/home/agent/')||text.includes('supabase.co')||text.includes('VITE_SUPABASE')||files.some(f=>f.endsWith('.map')))throw new Error('Candidate contains a prohibited local path, backend reference or source map');
const manifest={revision,entry:'/ihr/leave',narrowEntry:'/narrow.html',syntheticOnly:true,backendSender:false,mutationRPC:'denied',publicAssetsCopied:false,files:files.map(f=>({path:path.relative(output,f),bytes:statSync(f).size,sha256:createHash('sha256').update(readFileSync(f)).digest('hex')}))};
writeFileSync(path.join(output,'qa-build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest,null,2));
