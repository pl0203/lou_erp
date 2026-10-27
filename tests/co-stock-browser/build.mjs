import {build} from 'vite';import tailwind from '@tailwindcss/vite';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
export const buildFixture=outDir=>build({root,configFile:false,envDir:false,publicDir:false,worker:{format:'es'},plugins:[tailwind(),{name:'local-synthetic-boundary',enforce:'pre',resolveId(source){if(/(?:^|\/)lib\/(supabase|AuthContext)$/.test(source)||/^\.\.?\/(supabase|AuthContext)$/.test(source))return root+'boundary.ts'}}],css:{postcss:{plugins:[]}},esbuild:{jsx:'automatic'},build:{outDir,emptyOutDir:true,minify:false}});
