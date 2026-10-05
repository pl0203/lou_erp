import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Dependency diagnostics can include image/PDF content. Suppress them within the
// dedicated workers, before loading any vendor code, without touching app console.
const quiet = `for (const method of ['log','info','warn','error','debug','trace','dir','table','assert']) { console[method] = () => {} }\n`

// Pinned PDF.js 6.4.299 message_handler.js StreamKind.ERROR = 5. Its display
// consumer can finish a partial operator list before rejecting that error. Signal
// policy failure first, using only fixed codes, then forward the untouched packet.
const pdfPolicy = `const deliver = globalThis.postMessage.bind(globalThis);
globalThis.postMessage = (packet, transfer) => {
  const failedImage = packet?.action === 'obj' && packet.data?.[2] === 'Image' && packet.data?.[3] === null
    || packet?.action === 'commonobj' && packet.data?.[1] === 'Image' && packet.data?.[2] === null;
  if (packet?.stream === 5 || failedImage) {
    const code = packet?.stream === 5 && packet.reason?.message === 'Image exceeded maximum allowed size and was removed.' ? 'TOO_MANY_PIXELS' : 'INVALID_PDF';
    deliver({ type: 'po-reader-policy-error', code });
  }
  deliver(packet, transfer);
};\n`

/** Copy exact installed software/models, never business documents or source bytes. */
export async function copyAssets(sourceRoot, destination) {
  const entries = new Map()
  async function file(source, target) {
    let data
    try { data = await readFile(join(sourceRoot,source)) }
    catch { throw new Error(`Missing required PO reader asset: ${source}`) }
    entries.set(target,data)
  }
  async function tree(source, target) {
    let children
    try { children = await readdir(join(sourceRoot,source), { withFileTypes:true }) }
    catch { throw new Error(`Missing required PO reader asset directory: ${source}`) }
    if (!children.length) throw new Error(`Missing required PO reader assets in: ${source}`)
    for (const child of children.sort((a,b)=>a.name.localeCompare(b.name))) {
      if (child.isDirectory()) await tree(`${source}/${child.name}`,`${target}/${child.name}`)
      else if (child.isFile()) await file(`${source}/${child.name}`,`${target}/${child.name}`)
      else throw new Error(`Unsupported PO reader asset entry: ${source}/${child.name}`)
    }
  }
  let workerSource
  try { workerSource = await readFile(join(sourceRoot,'pdfjs-dist/legacy/build/pdf.worker.mjs'),'utf8') }
  catch { throw new Error('Missing required PO reader asset: PDF worker protocol source') }
  if (!/const StreamKind = \{[^}]*\bERROR: 5,/.test(workerSource)
    || !workerSource.includes('const msg = "Image exceeded maximum allowed size and was removed.";')) {
    throw new Error('Unsupported pinned PDF worker error protocol')
  }
  await file('pdfjs-dist/legacy/build/pdf.worker.min.mjs','pdf/pdf.worker.vendor.min.mjs')
  entries.set('pdf/pdf.worker.min.mjs',Buffer.from(`${quiet}${pdfPolicy}const vendor = await import('./pdf.worker.vendor.min.mjs');\nexport const WorkerMessageHandler = vendor.WorkerMessageHandler;\npostMessage({ type: 'po-reader-ready' });\n`))
  for (const directory of ['cmaps','standard_fonts','wasm','iccs']) await tree(`pdfjs-dist/${directory}`,`pdf/${directory}`)
  await file('pdfjs-dist/LICENSE','licenses/pdfjs-dist.txt')
  await file('tesseract.js/dist/worker.min.js','ocr/worker.vendor.min.js')
  entries.set('ocr/worker.min.js',Buffer.from(`${quiet}importScripts('./worker.vendor.min.js');\n`))
  await file('tesseract.js/LICENSE.md','licenses/tesseract.js.txt')
  await file('tesseract.js-core/LICENSE','licenses/tesseract.js-core.txt')
  // Tesseract 7 selects relaxed SIMD, SIMD, or non-SIMD, and LSTM/non-LSTM variants.
  for (const variant of ['','-simd','-relaxedsimd','-lstm','-simd-lstm','-relaxedsimd-lstm']) {
    for (const suffix of ['.js','.wasm.js','.wasm']) await file(`tesseract.js-core/tesseract-core${variant}${suffix}`,`ocr/core/tesseract-core${variant}${suffix}`)
  }
  await file('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz','ocr/lang/eng.traineddata.gz')
  // This official package ships its license declaration in package.json, no LICENSE file.
  await file('@tesseract.js-data/eng/package.json','licenses/eng-package.json')
  const languagePackage = JSON.parse(entries.get('licenses/eng-package.json').toString())
  if (languagePackage.license !== 'MIT') throw new Error('Unexpected English language asset license')
  await file('tesseract.js/LICENSE.md','licenses/eng-traineddata-Apache-2.0.txt')
  entries.set('licenses/eng-NOTICE.txt',Buffer.from(`@tesseract.js-data/eng ${languagePackage.version}\nLicense: ${languagePackage.license}\nSource: https://github.com/naptha/tessdata\nThe npm package wrapper declares MIT; its declaration is preserved in eng-package.json.\nThe distributed traineddata is covered by upstream tessdata Apache-2.0 (https://github.com/naptha/tessdata/blob/gh-pages/LICENSE). See eng-traineddata-Apache-2.0.txt.\n`))
  const paths = [...entries.keys()].sort(), sha256 = {}
  for (const path of paths) sha256[path] = createHash('sha256').update(entries.get(path)).digest('hex')
  const manifest = { paths, sha256 }
  // Missing inputs fail before changing any previous complete tree. Remove stale assets.
  await rm(destination,{recursive:true,force:true})
  for (const path of paths) { await mkdir(dirname(join(destination,path)),{recursive:true}); await writeFile(join(destination,path),entries.get(path)) }
  await writeFile(join(destination,'manifest.json'),`${JSON.stringify(manifest,null,2)}\n`)
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyAssets(resolve('node_modules'),resolve('public/po-reader'))
}
