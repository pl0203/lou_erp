import { Blob as BufferBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../src/lib/poImport/limits';
import { validatePOFile } from '../src/lib/poImport/fileValidation';
import { readPODocument } from '../src/lib/poImport/reader';
const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), createWorker: vi.fn(), workerOptions: {} as Record<string, unknown>, autoReady: true, pdfWorkerCreate: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: mocks.getDocument, GlobalWorkerOptions: mocks.workerOptions, PDFWorker: class {
        static create() { mocks.pdfWorkerCreate(); return new this(); }
        destroy() { }
    }, Util: { transform: (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]] } }));
function fakeFile(name: string, bytes: Uint8Array, type = '', size = bytes.length): File {
    return { name, type, size, arrayBuffer: async () => bytes.slice().buffer, slice: (start = 0, end = bytes.length) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer }) } as File;
}
const ascii = (s: string) => new TextEncoder().encode(s);
function jpeg(w = 10, h = 10) { return new Uint8Array([255, 216, 255, 192, 0, 11, 8, h >>> 8, h & 255, w >>> 8, w & 255, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217]); }
const pdfFile = () => fakeFile('synthetic.pdf', ascii('%PDF-1.7\n%%EOF'), 'application/pdf');
function png(w = 10, h = 10, animated = false) {
    const chunks: number[] = [137, 80, 78, 71, 13, 10, 26, 10];
    const chunk = (name: string, data: number[]) => { chunks.push(0, 0, 0, data.length, ...Array.from(ascii(name)), ...data, 0, 0, 0, 0); };
    chunk('IHDR', [w >>> 24, w >>> 16 & 255, w >>> 8 & 255, w & 255, h >>> 24, h >>> 16 & 255, h >>> 8 & 255, h & 255, 8, 2, 0, 0, 0]);
    if (animated)
        chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]);
    chunk('IDAT', [0]);
    chunk('IEND', []);
    return new Uint8Array(chunks);
}
function webp(animated = false) {
    const bytes = new Uint8Array(30);
    bytes.set(ascii('RIFF'));
    new DataView(bytes.buffer).setUint32(4, 22, true);
    bytes.set(ascii('WEBPVP8X'), 8);
    new DataView(bytes.buffer).setUint32(16, 10, true);
    bytes[20] = animated ? 2 : 0;
    bytes[24] = 9;
    bytes[27] = 9;
    return bytes;
}
const item = (str = 'PO 123', transform = [12, 0, 0, 12, 20, 750], width = 60) => ({ str, transform, width, height: 12, fontName: 'f1' });
const renderCancel = vi.fn();
const pageCleanup = vi.fn();
const pdfDestroy = vi.fn();
const taskDestroy = vi.fn();
function page(items = [item()]) {
    const streamTextContent = vi.fn(() => new ReadableStream({ start(controller) {
        controller.enqueue({ items, styles: { f1: { ascent: 0.8, descent: -0.2, vertical: false } }, lang: null }); controller.close();
    } }));
    // Match the pinned library rather than bypassing its stream behavior in tests.
    const getTextContent = vi.fn(async () => {
        const result = { items: [] as any[], styles: {} };
        for await (const chunk of streamTextContent() as any) {
            result.items.push(...chunk.items); Object.assign(result.styles, chunk.styles);
        }
        return result as any;
    });
    return { getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] }),
        getTextContent, streamTextContent, render: vi.fn(() => ({ promise: Promise.resolve(), cancel: renderCancel })), cleanup: pageCleanup };
}
function installPDF(pages = [page()]) { const doc = { numPages: pages.length, getPage: vi.fn(async (n: number) => pages[n - 1]), destroy: pdfDestroy, getMetadata: vi.fn(async () => ({ info: { EncryptFilterName: null } })) }; mocks.getDocument.mockReturnValue({ promise: Promise.resolve(doc), destroy: taskDestroy }); return doc; }
let worker: {
    recognize: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    setParameters: ReturnType<typeof vi.fn>;
};
let canvasWidths: number[];
let nativeWorkers: {
    path: string;
    messages: any[];
    terminate: ReturnType<typeof vi.fn>;
}[];
const ocrData = { data: { text: 'PO 123', blocks: [{ paragraphs: [{ lines: [{ words: [{ text: 'PO', confidence: 98, bbox: { x0: 10, y0: 20, x1: 30, y1: 40 } }, { text: '123', confidence: 97, bbox: { x0: 35, y0: 20, x1: 70, y1: 40 } }] }] }] }] } };
const options = (signal = new AbortController().signal) => ({ signal, onProgress: vi.fn() });
beforeEach(() => {
    vi.useRealTimers();
    mocks.getDocument.mockReset();
    mocks.createWorker.mockReset();
    taskDestroy.mockReset();
    pdfDestroy.mockReset();
    pageCleanup.mockReset();
    renderCancel.mockReset();
    canvasWidths = [];
    nativeWorkers = [];
    mocks.autoReady = true;
    mocks.pdfWorkerCreate.mockReset();
    worker = { recognize: vi.fn(async () => ocrData), terminate: vi.fn(async () => { }), setParameters: vi.fn(async () => { }) };
    mocks.createWorker.mockResolvedValue(worker);
    vi.stubGlobal('Blob', BufferBlob);
    vi.stubGlobal('Worker', class {
        path: string;
        messages: any[] = [];
        onmessage: ((event: {
            data: unknown;
        }) => void) | null = null;
        onerror: ((event: {
            preventDefault(): void;
        }) => void) | null = null;
        terminate = vi.fn(() => { worker.terminate(); });
        private listeners = new Map<string, Set<(event: any) => void>>();
        constructor(path: string) { this.path = path; nativeWorkers.push(this); queueMicrotask(() => { if (mocks.autoReady && this.path.includes('/pdf/'))
            this.emit('message', { data: { type: 'po-reader-ready' } }); }); }
        addEventListener(name: string, fn: (e: any) => void) { if (!this.listeners.has(name))
            this.listeners.set(name, new Set()); this.listeners.get(name)!.add(fn); }
        removeEventListener(name: string, fn: (e: any) => void) { this.listeners.get(name)?.delete(fn); }
        emit(name: string, event: any) { for (const fn of [...(this.listeners.get(name) ?? [])])
            fn(event); }
        postMessage(packet: any) {
            this.messages.push(packet);
            if (!this.path.includes('/ocr/'))
                return;
            const respond = (data: unknown) => { this.onmessage?.({ data: { ...packet, status: 'resolve', data } }); };
            const reject = () => { this.onmessage?.({ data: { ...packet, status: 'reject', data: 'private synthetic text' } }); };
            if (packet.action === 'load')
                Promise.resolve(mocks.createWorker()).then(() => respond({ loaded: true }), reject);
            else if (packet.action === 'recognize')
                Promise.resolve(worker.recognize(packet.payload.image, packet.payload.options, packet.payload.output)).then(r => respond(r.data), reject);
            else
                queueMicrotask(() => respond({}));
        }
    });
    vi.stubGlobal('WebAssembly', { ...WebAssembly });
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn(), fillRect: vi.fn(), set fillStyle(_value: string) { } }) as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback: BlobCallback) { canvasWidths.push(this.width); callback(new Blob(['synthetic preview'], { type: 'image/png' })); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('bounded local file validation', () => {
    it('freezes every agreed limit', () => expect(LIMITS).toEqual({ bytes: 10000000, pages: 5, rows: 100, pixels: 20000000, renderEdge: 2400, timeoutMs: 120000 }));
    it('rejects HEIC before decoding', async () => { const heicBytes = ascii('....ftypheic'); await expect(validatePOFile(fakeFile('x.heic', heicBytes))).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' }); });
    it('accepts exactly the raw-byte boundary and rejects one byte over', async () => { await expect(validatePOFile(fakeFile('x.pdf', ascii('%PDF-1.7\n%%EOF'), 'application/pdf', 10000000))).resolves.toEqual({ kind: 'pdf' }); await expect(validatePOFile(fakeFile('x.pdf', ascii('%PDF-1.7'), 'application/pdf', 10000001))).rejects.toMatchObject({ code: 'TOO_LARGE' }); });
    it('rejects MIME spoofing and signature spoofing', async () => { await expect(validatePOFile(fakeFile('x.png', png(), 'application/pdf'))).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' }); await expect(validatePOFile(fakeFile('x.pdf', png(), 'application/pdf'))).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' }); });
    it('rejects animated PNG and WebP before decoding', async () => { await expect(validatePOFile(fakeFile('x.png', png(10, 10, true), 'image/png'))).rejects.toMatchObject({ code: 'ANIMATED_IMAGE' }); await expect(validatePOFile(fakeFile('x.webp', webp(true), 'image/webp'))).rejects.toMatchObject({ code: 'ANIMATED_IMAGE' }); expect(createImageBitmap).not.toHaveBeenCalled(); });
    it('checks JPEG dimensions before any native decoding', async () => { await expect(validatePOFile(fakeFile('x.jpg', jpeg(), 'image/jpeg'))).resolves.toEqual({ kind: 'image' }); await expect(validatePOFile(fakeFile('x.jpg', jpeg(5000, 4001), 'image/jpeg'))).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' }); expect(createImageBitmap).not.toHaveBeenCalled(); });
    it('rejects dimensions over 20 megapixels before decoding', async () => { await expect(validatePOFile(fakeFile('x.png', png(5000, 4001), 'image/png'))).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' }); expect(createImageBitmap).not.toHaveBeenCalled(); });
    it('rejects corrupt containers and unsafe metadata', async () => { await expect(validatePOFile(fakeFile('x.png', png().slice(0, -4), 'image/png'))).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' }); await expect(validatePOFile(fakeFile('x\u0000.png', png(), 'image/png'))).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' }); });
    it('rejects inherited property names as unsupported extensions', async () => { await expect(validatePOFile(fakeFile('x.constructor', jpeg()))).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' }); });
    it('accepts supported static image signatures', async () => { await expect(validatePOFile(fakeFile('x.png', png(), 'image/png'))).resolves.toEqual({ kind: 'image' }); await expect(validatePOFile(fakeFile('x.webp', webp(), 'image/webp'))).resolves.toEqual({ kind: 'image' }); });
});
describe('local document reader', () => {
    it('reads every text chunk when streams have no async iterator', async () => {
        const fake = page(), streams: ReadableStream[] = [];
        const chunks = [
            { items: [item('PO 123')], styles: { f1: { ascent: 0.7, descent: -0.3, vertical: false } }, lang: 'id' },
            { items: [item('SECOND ROW', [12, 0, 0, 12, 20, 700])], styles: { f2: { ascent: 0.9, descent: -0.1, vertical: false } }, lang: null },
        ];
        fake.streamTextContent.mockImplementation(() => {
            const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
            Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
            streams.push(stream); return stream;
        });
        installPDF([fake]);
        const result = await readPODocument(pdfFile(), options());
        expect(result.pages[0].tokens.map(token => token.text)).toEqual(['PO 123', 'SECOND ROW']);
        expect(result.pages[0].tokens[0].y).toBeCloseTo(124.8);
        expect(streams).toHaveLength(1); expect(streams[0].locked).toBe(false);
        expect(fake.getTextContent).not.toHaveBeenCalled();
        result.dispose();
    });
    it('discards partial text and releases the stream lock after a text-stream error', async () => {
        const fake = page(); let reads = 0;
        const stream = new ReadableStream({ pull(controller) {
            if (reads++ === 0) controller.enqueue({ items: [item('PARTIAL')], styles: {} });
            else controller.error(new Error('private synthetic text'));
        } });
        fake.streamTextContent.mockReturnValue(stream);
        installPDF([fake]);
        await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'READ_FAILED', message: expect.not.stringContaining('private') });
        expect(stream.locked).toBe(false); expect(fake.render).not.toHaveBeenCalled();
        expect(taskDestroy).toHaveBeenCalled();
    });
    it('cancels a pending text read and releases its stream lock without partial output', async () => {
        const fake = page(), cancelled = vi.fn(), controller = new AbortController();
        const stream = new ReadableStream({ start(source) { source.enqueue({ items: [item('PARTIAL')], styles: {} }); }, cancel: cancelled });
        fake.streamTextContent.mockReturnValue(stream);
        installPDF([fake]);
        const work = readPODocument(pdfFile(), options(controller.signal));
        const rejection = expect(work).rejects.toMatchObject({ code: 'ABORTED' });
        await vi.waitFor(() => expect(stream.locked).toBe(true));
        controller.abort(); await rejection;
        expect(cancelled).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
        expect(fake.render).not.toHaveBeenCalled(); expect(nativeWorkers[0].terminate).toHaveBeenCalledTimes(1);
    });
    it('times out a pending text read and releases its stream lock', async () => {
        vi.useFakeTimers();
        const fake = page(), cancelled = vi.fn();
        const stream = new ReadableStream({ cancel: cancelled });
        fake.streamTextContent.mockReturnValue(stream); installPDF([fake]);
        const work = readPODocument(pdfFile(), options());
        const rejection = expect(work).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(0); expect(stream.locked).toBe(true);
        await vi.advanceTimersByTimeAsync(120_000); await rejection;
        expect(cancelled).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
        expect(fake.render).not.toHaveBeenCalled();
    });
    it('retains worker policy failure precedence during a pending text read', async () => {
        const fake = page(), cancelled = vi.fn();
        const stream = new ReadableStream({ cancel: cancelled });
        fake.streamTextContent.mockReturnValue(stream); installPDF([fake]);
        const work = readPODocument(pdfFile(), options());
        const rejection = expect(work).rejects.toMatchObject({ code: 'INVALID_PDF' });
        await vi.waitFor(() => expect(stream.locked).toBe(true));
        (nativeWorkers[0] as any).emit('message', { data: { type: 'po-reader-policy-error', code: 'INVALID_PDF' } });
        await rejection;
        expect(cancelled).toHaveBeenCalledTimes(1); expect(stream.locked).toBe(false);
        expect(fake.render).not.toHaveBeenCalled();
    });
    it('waits for vendor worker readiness before configuring PDF.js', async () => { mocks.autoReady = false; installPDF(); const work = readPODocument(pdfFile(), options()); await vi.waitFor(() => expect(nativeWorkers).toHaveLength(1)); expect(mocks.pdfWorkerCreate).not.toHaveBeenCalled(); expect(mocks.getDocument).not.toHaveBeenCalled(); (nativeWorkers[0] as any).emit('message', { data: { type: 'po-reader-ready' } }); const result = await work; expect(mocks.pdfWorkerCreate).toHaveBeenCalledTimes(1); result.dispose(); });
    it('cancels before PDF readiness without initializing a fake worker', async () => { mocks.autoReady = false; installPDF(); const c = new AbortController(); const work = readPODocument(pdfFile(), options(c.signal)); await vi.waitFor(() => expect(nativeWorkers).toHaveLength(1)); c.abort(); await expect(work).rejects.toMatchObject({ code: 'ABORTED' }); expect(mocks.pdfWorkerCreate).not.toHaveBeenCalled(); expect(nativeWorkers[0].terminate).toHaveBeenCalled(); });
    it('times out a missing bootstrap readiness signal without configuring PDF.js', async () => {
        vi.useFakeTimers();
        mocks.autoReady = false;
        installPDF();
        const work = readPODocument(pdfFile(), options());
        const rejection = expect(work).rejects.toMatchObject({ code: 'TIMEOUT' });
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.getDocument).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(120_000);
        await rejection;
        expect(mocks.pdfWorkerCreate).not.toHaveBeenCalled();
        expect(nativeWorkers[0].terminate).toHaveBeenCalledTimes(1);
    });
    it('sanitizes cold-worker startup errors before PDF configuration', async () => { mocks.autoReady = false; installPDF(); const work = readPODocument(pdfFile(), options()); await vi.waitFor(() => expect(nativeWorkers).toHaveLength(1)); (nativeWorkers[0] as any).emit('error', { preventDefault: vi.fn(), message: 'private synthetic text' }); await expect(work).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE', message: expect.not.stringContaining('private') }); expect(mocks.getDocument).not.toHaveBeenCalled(); });
    it('rejects a six-page PDF without reading a page', async () => { const doc = installPDF(Array.from({ length: 6 }, () => page())); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'TOO_MANY_PAGES' }); expect(doc.getPage).not.toHaveBeenCalled(); expect(taskDestroy).toHaveBeenCalled(); });
    it('uses selectable PDF text with top-left geometry without OCR', async () => { installPDF(); const result = await readPODocument(pdfFile(), options()); expect(result.pages[0]).toMatchObject({ source: 'pdf-text', width: 1800, height: 2400 }); expect(result.pages[0].tokens[0]).toMatchObject({ text: 'PO 123', x: 60, width: 180, confidence: null }); expect(result.pages[0].tokens[0].y).toBeCloseTo(121.2); const ocrCallsForSelectablePdf = worker.recognize.mock.calls.length; expect(ocrCallsForSelectablePdf).toBe(0); expect(mocks.createWorker).not.toHaveBeenCalled(); result.dispose(); expect(result.pages).toEqual([]); expect(result.previews).toEqual([]); });
    it('normalizes reversed PDF coordinates into nonnegative rectangles', async () => { installPDF([page([item('PO 123', [-12, 0, 0, -12, 200, 750], -60)])]); const result = await readPODocument(pdfFile(), options()); const t = result.pages[0].tokens[0]; expect(t.width).toBeGreaterThan(0); expect(t.height).toBeGreaterThan(0); expect(t.x).toBeGreaterThanOrEqual(0); expect(t.y).toBeGreaterThanOrEqual(0); result.dispose(); });
    it('reads mixed pages sequentially and requests OCR geometry explicitly', async () => { installPDF([page(), page([]), page([])]); let active = 0, maxConcurrentOcrCalls = 0; worker.recognize.mockImplementation(async () => { active++; maxConcurrentOcrCalls = Math.max(maxConcurrentOcrCalls, active); await Promise.resolve(); active--; return ocrData; }); const result = await readPODocument(pdfFile(), options()); expect(result.pages.map(p => p.source)).toEqual(['pdf-text', 'ocr', 'ocr']); expect(maxConcurrentOcrCalls).toBe(1); expect(worker.recognize.mock.calls[0][2]).toMatchObject({ blocks: true }); expect(result.pages[1].tokens[0]).toMatchObject({ text: 'PO', x: 10, y: 20, width: 20, height: 20, confidence: 98 }); expect(nativeWorkers.find(w => w.path.includes('/ocr/'))?.terminate).toHaveBeenCalledTimes(1); result.dispose(); });
    it('configures local byte-only PDF and same-origin OCR assets without caches', async () => { installPDF([page([])]); const result = await readPODocument(pdfFile(), options()); const config = mocks.getDocument.mock.calls[0][0]; expect(config.data).toBeInstanceOf(Uint8Array); expect(config.url).toBeUndefined(); expect(config.isEvalSupported).toBe(false); for (const key of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl'])
        expect(config[key]).toMatch(/^\/po-reader\//); expect(mocks.workerOptions.workerSrc).toMatch(/^\/po-reader\//); const native = nativeWorkers.find(w => w.path.includes('/ocr/'))!; expect(native.path).toMatch(/^\/po-reader\//); expect(native.messages.find(p => p.action === 'load').payload.options).toMatchObject({ logging: false, corePath: expect.stringMatching(/^\/po-reader\//) }); expect(native.messages.find(p => p.action === 'loadLanguage').payload.options).toMatchObject({ cacheMethod: 'none', langPath: expect.stringMatching(/^\/po-reader\//) }); result.dispose(); });
    it.each([['PasswordException', 'PDF_ENCRYPTED'], ['InvalidPDFException', 'INVALID_PDF']])('sanitizes %s PDF failures', async (name, code) => { mocks.getDocument.mockReturnValue({ promise: Promise.reject(Object.assign(new Error('private synthetic filename / text'), { name })), destroy: taskDestroy }); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code, message: expect.not.stringContaining('private') }); });
    it('rejects a worker policy signal before a partial PDF page can succeed', async () => { const fake = page(); fake.render.mockImplementation(() => { (nativeWorkers[0] as any).emit('message', { data: { type: 'po-reader-policy-error', code: 'TOO_MANY_PIXELS' } }); return { promise: Promise.resolve(), cancel: renderCancel }; }); installPDF([fake]); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' }); expect(taskDestroy).toHaveBeenCalled(); expect(nativeWorkers[0].terminate).toHaveBeenCalled(); });
    it('preserves cancellation precedence over a concurrent PDF policy failure', async () => { const c = new AbortController(), fake = page(); fake.render.mockImplementation(() => { c.abort(); (nativeWorkers[0] as any).emit('message', { data: { type: 'po-reader-policy-error', code: 'TOO_MANY_PIXELS' } }); return { promise: Promise.resolve(), cancel: renderCancel }; }); installPDF([fake]); await expect(readPODocument(pdfFile(), options(c.signal))).rejects.toMatchObject({ code: 'ABORTED' }); });
    it('rejects oversized embedded PDF images without returning partial text', async () => { const first = page(), second = page(); second.render.mockReturnValue({ promise: Promise.reject(new Error('Image exceeded maximum allowed size and was removed.')), cancel: renderCancel }); installPDF([first, second]); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'TOO_MANY_PIXELS' }); expect(mocks.getDocument.mock.calls[0][0].stopAtErrors).toBe(true); expect(taskDestroy).toHaveBeenCalled(); expect(nativeWorkers[0].terminate).toHaveBeenCalled(); });
    it('rejects encryption even when an empty password would open the PDF', async () => { const doc = installPDF(); doc.getMetadata.mockResolvedValue({ info: { EncryptFilterName: 'Standard' } }); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'PDF_ENCRYPTED' }); expect(doc.getPage).not.toHaveBeenCalled(); });
    it('rejects blank documents rather than returning empty pages', async () => { installPDF([page([])]); worker.recognize.mockResolvedValue({ data: { text: '', blocks: [] } }); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'BLANK_DOCUMENT' }); });
    it('aborts before startup without creating workers', async () => { const c = new AbortController(); c.abort(); await expect(readPODocument(pdfFile(), options(c.signal))).rejects.toMatchObject({ code: 'ABORTED' }); expect(mocks.getDocument).not.toHaveBeenCalled(); });
    it('aborts PDF startup and destroys loading work', async () => { mocks.getDocument.mockReturnValue({ promise: new Promise(() => { }), destroy: taskDestroy }); const c = new AbortController(); const work = readPODocument(pdfFile(), options(c.signal)); await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalled()); c.abort(); await expect(work).rejects.toMatchObject({ code: 'ABORTED' }); expect(taskDestroy).toHaveBeenCalled(); });
    it('aborts OCR startup and terminates workers even if startup resolves late', async () => { installPDF([page([])]); let resolve!: (w: typeof worker) => void; mocks.createWorker.mockReturnValue(new Promise(r => { resolve = r; })); const c = new AbortController(); const work = readPODocument(pdfFile(), options(c.signal)); await vi.waitFor(() => expect(mocks.createWorker).toHaveBeenCalled()); c.abort(); await expect(work).rejects.toMatchObject({ code: 'ABORTED' }); expect(nativeWorkers.find(w => w.path.includes('/ocr/'))?.terminate).toHaveBeenCalled(); resolve(worker); await Promise.resolve(); expect(worker.recognize).not.toHaveBeenCalled(); });
    it('aborts active OCR and permits a fresh job', async () => { installPDF([page([])]); worker.recognize.mockReturnValue(new Promise(() => { })); const c = new AbortController(); const work = readPODocument(pdfFile(), options(c.signal)); await vi.waitFor(() => expect(worker.recognize).toHaveBeenCalled()); c.abort(); await expect(work).rejects.toMatchObject({ code: 'ABORTED' }); expect(worker.terminate).toHaveBeenCalled(); installPDF(); const next = await readPODocument(pdfFile(), options()); next.dispose(); });
    it('times out initialization at 120 seconds', async () => { vi.useFakeTimers(); mocks.getDocument.mockReturnValue({ promise: new Promise(() => { }), destroy: taskDestroy }); const work = readPODocument(pdfFile(), options()); const rejection = expect(work).rejects.toMatchObject({ code: 'TIMEOUT' }); await vi.advanceTimersByTimeAsync(120000); await rejection; expect(taskDestroy).toHaveBeenCalled(); });
    it('allows only one active reader job', async () => { mocks.getDocument.mockReturnValue({ promise: new Promise(() => { }), destroy: taskDestroy }); const c = new AbortController(); const first = readPODocument(pdfFile(), options(c.signal)); await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalled()); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'BUSY' }); c.abort(); await expect(first).rejects.toMatchObject({ code: 'ABORTED' }); });
    it('fails safely when Worker or WASM is unavailable', async () => { installPDF([page([])]); vi.stubGlobal('WebAssembly', undefined); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE' }); vi.stubGlobal('Worker', undefined); installPDF(); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'WORKER_UNAVAILABLE' }); });
    it('bounds image rendering and releases decoded pixels', async () => { const close = vi.fn(); vi.mocked(createImageBitmap).mockResolvedValue({ width: 5000, height: 4000, close } as unknown as ImageBitmap); const result = await readPODocument(fakeFile('x.png', png(5000, 4000), 'image/png'), options()); expect(result.pages[0]).toMatchObject({ width: 2400, height: 1920, source: 'ocr' }); expect(canvasWidths).toEqual([2400]); expect(close).toHaveBeenCalled(); result.dispose(); });
    it('uses the verified deterministic page segmentation mode', async () => { installPDF([page([])]); const result = await readPODocument(pdfFile(), options()); const native = nativeWorkers.find(w => w.path.includes('/ocr/'))!; expect(native.messages.find(p => p.action === 'setParameters').payload.params.tessedit_pageseg_mode).toBe('6'); result.dispose(); });
    it('sanitizes OCR startup failures and never leaks dependency error payloads', async () => { installPDF([page([])]); mocks.createWorker.mockRejectedValue(new Error('private synthetic filename and text')); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'OCR_UNAVAILABLE', message: expect.not.stringContaining('private') }); expect(nativeWorkers.find(w => w.path.includes('/ocr/'))?.terminate).toHaveBeenCalled(); });
    it('times out a hung OCR initialization and releases its native worker', async () => { vi.useFakeTimers(); installPDF([page([])]); mocks.createWorker.mockReturnValue(new Promise(() => { })); const work = readPODocument(pdfFile(), options()); const rejection = expect(work).rejects.toMatchObject({ code: 'TIMEOUT' }); await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(120000); await rejection; expect(nativeWorkers.find(w => w.path.includes('/ocr/'))?.terminate).toHaveBeenCalled(); });
    it('closes a bitmap that finishes decoding after cancellation', async () => { let resolve!: (b: ImageBitmap) => void; vi.mocked(createImageBitmap).mockReturnValue(new Promise(r => { resolve = r; })); const c = new AbortController(); const work = readPODocument(fakeFile('x.png', png(), 'image/png'), options(c.signal)); await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalled()); c.abort(); await expect(work).rejects.toMatchObject({ code: 'ABORTED' }); const close = vi.fn(); resolve({ width: 10, height: 10, close } as unknown as ImageBitmap); await vi.waitFor(() => expect(close).toHaveBeenCalled()); expect(mocks.createWorker).not.toHaveBeenCalled(); });
    it('does not accept text-only OCR without requested word geometry', async () => { installPDF([page([])]); worker.recognize.mockResolvedValue({ data: { text: 'PO 123', blocks: [] } }); await expect(readPODocument(pdfFile(), options())).rejects.toMatchObject({ code: 'BLANK_DOCUMENT' }); });
    it('sanitizes native decoding failures and still permits a retry', async () => { vi.mocked(createImageBitmap).mockRejectedValue(new Error('private synthetic text')); await expect(readPODocument(fakeFile('x.png', png(), 'image/png'), options())).rejects.toMatchObject({ code: 'READ_FAILED', message: expect.not.stringContaining('private') }); installPDF(); const next = await readPODocument(pdfFile(), options()); next.dispose(); });
    it('never logs or stores document-bearing data', async () => { installPDF(); const storageWritesContainingDocumentData: unknown[] = []; vi.spyOn(Storage.prototype, 'setItem').mockImplementation((...args) => { storageWritesContainingDocumentData.push(args); }); const indexedDB = vi.fn(); vi.stubGlobal('indexedDB', { open: indexedDB }); const log = vi.spyOn(console, 'log').mockImplementation(() => { }); const warn = vi.spyOn(console, 'warn').mockImplementation(() => { }); const error = vi.spyOn(console, 'error').mockImplementation(() => { }); const result = await readPODocument(pdfFile(), options()); expect(storageWritesContainingDocumentData).toEqual([]); expect(indexedDB).not.toHaveBeenCalled(); expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); result.dispose(); });
});
