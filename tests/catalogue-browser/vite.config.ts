import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
const fixture = fileURLToPath(new URL('./fixture.tsx', import.meta.url))
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: false,
  css: { postcss: { plugins: [] } },
  esbuild: { tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', useDefineForClassFields: true } } },
  plugins: [{ name: 'synthetic-boundaries-only', enforce: 'pre', resolveId(source) {
    if (/(?:^|\/)(?:AuthContext|supabase|AthelNav)(?:\.[jt]sx?)?$/.test(source)) return fixture
  } }, react({ babel: { babelrc: false, configFile: false } }), tailwindcss()],
  server: { host: '127.0.0.1', port: 4173, strictPort: true, open: false },
})
