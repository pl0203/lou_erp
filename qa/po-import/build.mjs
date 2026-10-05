// Portable candidate-only static build. The stable app does not import this entry.
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const qaDirectory = path.dirname(fileURLToPath(import.meta.url))
const repository = path.resolve(qaDirectory, '../..')
const output = path.join(repository, 'dist-po-import-qa')
const revision = process.env.VERCEL_GIT_COMMIT_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repository, encoding: 'utf8',
}).trim()

await build({
  root: qaDirectory,
  configFile: false,
  plugins: [react(), tailwindcss()],
  publicDir: path.join(repository, 'public'),
  define: { 'import.meta.env.VITE_QA_REVISION': JSON.stringify(revision) },
  build: {
    outDir: output,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: path.join(qaDirectory, 'candidate.html') },
  },
})

function filesUnder(directory) {
  return readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name)
    return statSync(file).isDirectory() ? filesUnder(file) : [file]
  })
}
// Split names keep this assertion from accidentally safelisting its own targets.
const requiredUtilities = [
  ['min', 'w', '0'], ['rounded', 'lg'], ['bg', 'amber', '50'],
  ['text', 'amber', '700'], ['object', 'contain'],
].map(parts => parts.join('-')).concat([['sm', ':', 'grid', '-', 'cols', '-', '2'], ['[', 'overflow', '-', 'wrap', ':', 'anywhere', ']']].map(parts => parts.join('')))
const candidateCSS = filesUnder(output).filter(file => file.endsWith('.css')).map(file => readFileSync(file, 'utf8')).join('\n')
const missingUtilities = requiredUtilities.filter(name => {
  const selector = `.${name.replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`)}`
  return !candidateCSS.includes(`${selector}{`) && !candidateCSS.includes(`${selector},`) && !candidateCSS.includes(`${selector}:`)
})
if (missingUtilities.length) throw new Error(`Candidate is missing production importer CSS utilities: ${missingUtilities.join(', ')}`)
const readerAssets = path.join(repository, 'public', 'po-reader')
if (!existsSync(path.join(readerAssets, 'manifest.json'))) {
  throw new Error('Generate the deterministic PO reader assets before building this candidate')
}
const sources = ['src/lib/poImport', 'src/components/poImport', 'qa/po-import'].flatMap(directory => filesUnder(path.join(repository, directory)))
const report = {
  revision,
  entry: '/candidate.html',
  sourceFiles: sources.map(file => ({
    path: path.relative(repository, file),
    sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  })),
  readerAssetFiles: filesUnder(readerAssets).length,
  readerAssetBytes: filesUnder(readerAssets).reduce((sum, file) => sum + statSync(file).size, 0),
  totalCandidateFiles: filesUnder(output).length,
  totalCandidateBytes: filesUnder(output).reduce((sum, file) => sum + statSync(file).size, 0),
  requiredUtilities,
  catalogs: 'synthetic-only',
  backendSender: false,
  privateInputs: 'selected through the browser file chooser, held in memory only',
}
const baseBytes = report.totalCandidateBytes
report.totalCandidateFiles += 1
let encoded = `${JSON.stringify(report, null, 2)}\n`
for (;;) {
  const bytes = baseBytes + Buffer.byteLength(encoded)
  if (bytes === report.totalCandidateBytes) break
  report.totalCandidateBytes = bytes
  encoded = `${JSON.stringify(report, null, 2)}\n`
}
writeFileSync(path.join(output, 'qa-build-manifest.json'), encoded)
console.log(JSON.stringify(report, null, 2))
