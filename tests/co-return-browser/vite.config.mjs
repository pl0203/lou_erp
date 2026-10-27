import {fileURLToPath} from 'node:url';
import tailwind from '@tailwindcss/vite';
const root=fileURLToPath(new URL('.',import.meta.url));
export default {root,configFile:false,envDir:false,publicDir:false,plugins:[tailwind(),{name:'synthetic-return-transport',enforce:'pre',resolveId(source){if(/(?:^|\/)lib\/supabase$/.test(source)||/^\.\.?\/supabase$/.test(source))return root+'boundary.ts';}}],define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://synthetic.invalid')},css:{postcss:{plugins:[]}},esbuild:{jsx:'automatic'},build:{outDir:root+'dist',emptyOutDir:true,minify:false}};
