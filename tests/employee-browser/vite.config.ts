import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import {fileURLToPath} from 'node:url'
const fixture=fileURLToPath(new URL('./fixture.tsx',import.meta.url))
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),envDir:false,publicDir:'../../public',define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://employee-synthetic.invalid')},css:{postcss:{plugins:[]}},esbuild:{tsconfigRaw:{compilerOptions:{jsx:'react-jsx',useDefineForClassFields:true}}},plugins:[{name:'synthetic-auth-rpc-only',enforce:'pre',resolveId(source){if(/(?:^|\/)(?:AuthContext|supabase)(?:\.[jt]sx?)?$/.test(source))return fixture}},react({babel:{babelrc:false,configFile:false}}),tailwindcss()]})
