// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { copyAssets } from '../scripts/copy-po-reader-assets.mjs';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'po-assets-')); roots.push(root); const src = join(root, 'node_modules'), dest = join(root, 'public'); const paths = ['pdfjs-dist/legacy/build/pdf.worker.mjs', 'pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdfjs-dist/cmaps/Identity-H.bcmap', 'pdfjs-dist/standard_fonts/FoxitSans.pfb', 'pdfjs-dist/wasm/openjpeg.wasm', 'pdfjs-dist/LICENSE', 'pdfjs-dist/iccs/LICENSE', 'pdfjs-dist/iccs/synthetic.icc', 'tesseract.js/dist/worker.min.js', 'tesseract.js/LICENSE.md', 'tesseract.js-core/LICENSE', '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', '@tesseract.js-data/eng/package.json']; for (const suffix of ['', '-simd', '-relaxedsimd', '-lstm', '-simd-lstm', '-relaxedsimd-lstm'])
    paths.push(`tesseract.js-core/tesseract-core${suffix}.wasm.js`, `tesseract.js-core/tesseract-core${suffix}.wasm`, `tesseract.js-core/tesseract-core${suffix}.js`); for (const p of paths) {
    await mkdir(join(src, p, '..'), { recursive: true });
    await writeFile(join(src, p), p.endsWith('/pdf.worker.mjs') ? 'const StreamKind = { ERROR: 5, }; const msg = "Image exceeded maximum allowed size and was removed.";' : p.endsWith('package.json') ? JSON.stringify({ name: '@tesseract.js-data/eng', version: '1.0.0', license: 'MIT', repository: { url: 'https://github.com/naptha/tessdata.git' } }) : `synthetic-${p}`);
} return { src, dest }; }
describe('self-hosted PO software assets', () => {
    it('copies complete required packages and deterministic SHA-256 manifests', async () => { const { src, dest } = await fixture(); const a = await copyAssets(src, dest), b = await copyAssets(src, dest); expect(a).toEqual(b); expect(a.paths).toEqual([...a.paths].sort()); expect(a.paths).toContain('pdf/pdf.worker.min.mjs'); expect(a.paths).toContain('ocr/worker.min.js'); expect(a.paths).toContain('ocr/lang/eng.traineddata.gz'); expect(a.paths.filter(p => p.endsWith('.wasm'))).toHaveLength(7); for (const p of a.paths)
        expect(a.sha256[p]).toBe(createHash('sha256').update(await readFile(join(dest, p))).digest('hex')); expect(JSON.parse(await readFile(join(dest, 'manifest.json'), 'utf8'))).toEqual(a); });
    it('bootstraps quiet dedicated workers before loading vendor code', async () => { const { src, dest } = await fixture(); await copyAssets(src, dest); for (const p of ['pdf/pdf.worker.min.mjs', 'ocr/worker.min.js']) {
        const source = await readFile(join(dest, p), 'utf8');
        expect(source.indexOf('console[method]')).toBeLessThan(source.indexOf('vendor.min'));
        expect(source).not.toMatch(/https?:/);
        if (p.startsWith('pdf/'))
            expect(source.indexOf("postMessage({ type: 'po-reader-ready' })")).toBeGreaterThan(source.indexOf("await import('./pdf.worker.vendor.min.mjs')"));
    } ; expect(await readFile(join(dest, 'licenses/eng-NOTICE.txt'), 'utf8')).toContain('Apache-2.0'); });
    it('signals exact stream failures and failed-image packets before forwarding, without touching valid packets', async () => {
        const { src, dest } = await fixture();
        await copyAssets(src, dest);
        const source = await readFile(join(dest, 'pdf/pdf.worker.min.mjs'), 'utf8'), sent: any[] = [];
        const sandbox = { console: {}, postMessage: (packet: any) => sent.push(packet) };
        runInNewContext(source.split('const vendor = await import')[0], sandbox);
        const failure = { stream: 5, reason: { message: 'Image exceeded maximum allowed size and was removed.' } };
        sandbox.postMessage(failure);
        expect(sent.splice(0)).toEqual([{ type: 'po-reader-policy-error', code: 'TOO_MANY_PIXELS' }, failure]);
        for (const packet of [{ stream: 5, reason: { message: 'private synthetic parse error' } }, { action: 'obj', data: ['image-id', 0, 'Image', null] }, { action: 'commonobj', data: ['image-id', 'Image', null] }]) {
            sandbox.postMessage(packet);
            expect(sent.splice(0)).toEqual([{ type: 'po-reader-policy-error', code: 'INVALID_PDF' }, packet]);
        }
        for (const packet of [{ stream: 4, data: {} }, { stream: 7, success: true }, { action: 'obj', data: ['image-id', 0, 'Image', { width: 10 }] }, { action: 'commonobj', data: ['font-id', 'Font', null] }, { reason: { message: 'Image exceeded maximum allowed size and was removed.' } }]) {
            sandbox.postMessage(packet);
            expect(sent.splice(0)).toEqual([packet]);
        }
    });
    it('fails closed if a required dependency asset is missing', async () => { const { src, dest } = await fixture(); await rm(join(src, 'pdfjs-dist/wasm'), { recursive: true }); await expect(copyAssets(src, dest)).rejects.toThrow(/missing.*asset/i); });
    it('pins supported Node engines consistently in package and lockfile', async () => {
        const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
        const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
        expect(pkg.engines).toEqual({node: '>=22.13.0 <23 || >=24.0.0 <25'});
        expect(lock.packages[''].engines).toEqual(pkg.engines);
    });
    it('keeps the backend guard and prepares assets before dev/build', async () => { const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')); expect(pkg.scripts.build).toContain('verify-preview-backend.mjs'); expect(pkg.scripts.predev).toContain('copy-po-reader-assets.mjs'); expect(pkg.scripts.prebuild).toContain('copy-po-reader-assets.mjs'); expect(await readFile(new URL('../.gitignore', import.meta.url), 'utf8')).toContain('public/po-reader/'); });
});
it('guards the actual pinned engine oversize error before a partial render can resolve', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    expect(pdfjs.version).toBe('6.4.299');
    const commands = 'q 100 0 0 100 0 0 cm /Im0 Do Q';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
        '<< /Type /XObject /Subtype /Image /Width 5000 /Height 4001 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 1 >>\nstream\nx\nendstream',
    ];
    let source = '%PDF-1.4\n', offsets = [0];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(source.length);
        source += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = source.length;
    source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const root = await mkdtemp(join(tmpdir(), 'po-real-pdf-assets-'));
    roots.push(root);
    await copyAssets(new URL('../node_modules/', import.meta.url).pathname, root);
    const bootstrap = await readFile(join(root, 'pdf/pdf.worker.min.mjs'), 'utf8');
    const pdfWorker = pdfjs.PDFWorker.create({ verbosity: 0 });
    await pdfWorker.promise;
    const port = pdfWorker.port, originalPost = port.postMessage.bind(port), packets: any[] = [];
    let policyReject!: (e: unknown) => void;
    const policyFailure = new Promise<never>((_, reject) => { policyReject = reject; });
    const sandbox = { console: {}, postMessage: (packet: any, transfer: any) => { packets.push(packet); if (packet.type === 'po-reader-policy-error')
            policyReject({ code: packet.code }); originalPost(packet, transfer); } };
    runInNewContext(bootstrap.split('const vendor = await import')[0], sandbox);
    port.postMessage = sandbox.postMessage;
    const task = pdfjs.getDocument({ worker: pdfWorker, data: new TextEncoder().encode(source), stopAtErrors: true, maxImageSize: 20000000, verbosity: 0, disableFontFace: true, useSystemFonts: false });
    try {
        const doc = await task.promise, page = await doc.getPage(1);
        const { createCanvas } = await import('@napi-rs/canvas'), canvas = createCanvas(200, 200);
        const render = page.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport: page.getViewport({ scale: 1 }) });
        await expect(Promise.race([render.promise, policyFailure])).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' });
        const policyIndex = packets.findIndex(p => p.type === 'po-reader-policy-error');
        const errorIndex = packets.findIndex(p => p.stream === 5 && p.reason?.message === 'Image exceeded maximum allowed size and was removed.');
        expect(policyIndex).toBeGreaterThanOrEqual(0);
        expect(policyIndex).toBeLessThan(errorIndex);
        expect(packets[policyIndex]).toEqual({ type: 'po-reader-policy-error', code: 'TOO_MANY_PIXELS' });
    }
    finally {
        await task.destroy();
        pdfWorker.destroy();
    }
});
