import { useEffect, useState } from 'react';
import type { SourceRef } from '../../lib/co/import/types';
import { guardWorkbook } from '../../lib/co/import/workbookGuard';
import { ASSETS } from '../../lib/poImport/limits';
/** Local raster only: no PDF iframe, actions, annotations, scripting, OCR or network document upload. */
export async function rasterSourcePage(file: File, pageNumber: number, signal: AbortSignal): Promise<Blob> {
    if (file.size > 10 * 1024 * 1024)
        throw new Error('Batas ukuran sumber terlampaui.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    signal.throwIfAborted();
    pdf.GlobalWorkerOptions.workerSrc = ASSETS.pdfWorker;
    const worker = new Worker(ASSETS.pdfWorker, { type: 'module' });
    const transport = pdf.PDFWorker.create({ port: worker, verbosity: 0 });
    const parameters = { data: bytes, worker: transport, verbosity: 0, isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false, cMapUrl: ASSETS.cmaps, cMapPacked: true, standardFontDataUrl: ASSETS.fonts, wasmUrl: ASSETS.wasm, iccUrl: '/po-reader/pdf/iccs/', maxImageSize: 20000000, canvasMaxAreaInBytes: 80000000, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, stopAtErrors: true, disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: true };
    const loading = pdf.getDocument(parameters);
    let cancelRender: (() => void) | undefined;
    let rejectFailure: (error: Error) => void = () => {};
    const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
    const wait = <T,>(promise: Promise<T>) => Promise.race([promise, failure]);
    const fail = () => rejectFailure(new Error('Pratinjau lokal dihentikan dengan aman.'));
    const policy = (event: MessageEvent) => { if (event.data?.type === 'po-reader-policy-error') fail(); };
    worker.addEventListener('message', policy);
    worker.addEventListener('error', fail);
    worker.addEventListener('messageerror', fail);
    const timeout = setTimeout(fail, 120000);
    const abort = () => { fail(); cancelRender?.(); void loading.destroy().catch(() => { }); worker.terminate(); };
    signal.addEventListener('abort', abort, { once: true });
    const canvas = document.createElement('canvas');
    try {
        signal.throwIfAborted();
        const doc = await wait(loading.promise);
        signal.throwIfAborted();
        if (!Number.isSafeInteger(pageNumber) || doc.numPages > 50 || pageNumber < 1 || pageNumber > doc.numPages)
            throw new Error('Halaman sumber tidak tersedia.');
        const meta = await wait(doc.getMetadata());
        if ('EncryptFilterName' in meta.info && meta.info.EncryptFilterName)
            throw new Error('PDF terenkripsi tidak didukung.');
        const page = await wait(doc.getPage(pageNumber));
        signal.throwIfAborted();
        const initial = page.getViewport({ scale: 1 });
        if (![initial.width, initial.height].every(v => Number.isFinite(v) && v > 0))
            throw new Error('Ukuran halaman tidak aman.');
        const viewport = page.getViewport({ scale: Math.min(2, 2000 / Math.max(initial.width, initial.height)) });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        if (canvas.width * canvas.height > 20000000)
            throw new Error('Batas gambar terlampaui.');
        const drawing = canvas.getContext('2d', { alpha: false });
        if (!drawing)
            throw new Error('Pratinjau lokal tidak tersedia.');
        const render = page.render({ canvas, canvasContext: drawing, viewport, annotationMode: 0 });
        cancelRender = () => render.cancel();
        await wait(render.promise);
        signal.throwIfAborted();
        const blob = await wait(new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Pratinjau gagal.')), 'image/png')));
        signal.throwIfAborted();
        page.cleanup();
        return blob;
    }
    finally {
        clearTimeout(timeout);
        worker.removeEventListener('message', policy);
        worker.removeEventListener('error', fail);
        worker.removeEventListener('messageerror', fail);
        signal.removeEventListener('abort', abort);
        cancelRender?.();
        canvas.width = 0;
        canvas.height = 0;
        void loading.destroy().catch(() => { });
        worker.terminate();
        try {
            bytes.fill(0);
        }
        catch { /* transferred */ }
    }
}
type CellText = {
    address: string;
    text: string;
    formula: boolean;
};
export async function sourceCells(file: File, ref: SourceRef | null, signal: AbortSignal): Promise<{
    sheet: string;
    cells: CellText[];
}> { if(file.size>10*1024*1024)throw new Error('Batas ukuran sumber terlampaui.'); const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted(); try {
    const guard = await guardWorkbook(bytes, signal);
    const source = ref?.sheet ? guard.sheets.find(s => s.name === ref.sheet) : guard.sheets[0];
    if (!source)
        throw new Error('Sheet tidak tersedia.');
    const module = await import('exceljs/dist/exceljs.min.js');
    signal.throwIfAborted();
    const ExcelJS = (module.default ?? module) as typeof import('exceljs');
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(guard.canonicalBytes as unknown as Parameters<typeof book.xlsx.load>[0]);
    signal.throwIfAborted();
    const sheet = book.getWorksheet(source.name)!;
    const selected = Number(ref?.row.replace(/^r/, ''));
    const cells: CellText[] = [];
    let budget = 0;
    for (const [address, raw] of guard.cells.get(source.path)!) {
        const row = Number(address.replace(/^[A-Z]+/, ''));
        if (selected && Math.abs(row - selected) > 2)
            continue;
        if (cells.length >= 250)
            break;
        const cell = sheet.getCell(address);
        const value = raw.formula ? cell.result : cell.value;
        let text = '';
        if (['n', ''].includes(raw.type) && raw.raw !== '') {
            // Guarded XML is the evidence; ExcelJS numbers have already rounded.
            text = raw.raw;
            if (/^0{1,32}$/.test(cell.numFmt || '') && /^\d+$/.test(raw.raw)) {
                const formatted = raw.raw.padStart(cell.numFmt.length, '0');
                if (formatted !== raw.raw) text = `${formatted} (nilai tersimpan: ${raw.raw})`;
            }
        } else if (typeof value === 'string' || typeof value === 'boolean')
            text = String(value);
        else if (value instanceof Date)
            text = value.toISOString();
        else if (value && typeof value === 'object' && 'richText' in value) {
            let length=0; for(const run of value.richText){length+=run.text.length;if(length>512)throw new Error('Batas teks sumber terlampaui.');}
            text = value.richText.map(r => r.text).join('');
        }
        else if (value && typeof value === 'object' && 'text' in value)
            text = String(value.text);
        if (text.length > 512 || ((budget += text.length) > 128 * 1024))
            throw new Error('Batas teks sumber terlampaui.');
        cells.push({ address, text, formula: raw.formula });
    }
    return { sheet: source.name, cells };
}
finally {
    bytes.fill(0);
} }
export default function COSourcePreview({ file, selectedRef }: {
    file: File;
    selectedRef: SourceRef | null;
}) { const [result, setResult] = useState<{
    file: File;
    key: string;
    url?: string;
    sheet?: string;
    cells?: CellText[];
    error?: string;
} | null>(null); const key = JSON.stringify(selectedRef); useEffect(() => { const controller = new AbortController(); let url: string | undefined; let live = true; setResult(null); const run = async () => { try {
    if (/\.pdf$/i.test(file.name)) {
        const blob = await rasterSourcePage(file, selectedRef?.page ?? 1, controller.signal);
        if (!live)
            return;
        url = URL.createObjectURL(blob);
        setResult({ file, key, url });
    }
    else {
        const value = await sourceCells(file, selectedRef, controller.signal);
        if (live)
            setResult({ file, key, ...value });
    }
}
catch {
    if (live)
        setResult({ file, key, error: 'Sumber tidak dapat ditampilkan dengan aman. Tidak ada OCR atau pengiriman ke layanan luar.' });
} }; void run(); return () => { live = false; controller.abort(); if (url)
    URL.revokeObjectURL(url); }; }, [file, key]); const current = result?.file === file && result.key === key ? result : null; return <section className="co-import__source" aria-label="Sumber laporan"><h3>Sumber · {file.name}</h3><p>{selectedRef?.sheet ?? `Halaman ${selectedRef?.page ?? 1}`} · {selectedRef?.row ?? 'Pilih referensi pada tabel'}</p>{!current && <p>Menyiapkan pratinjau lokal…</p>}{current?.error && <p role="alert">{current.error}</p>}{current?.url && <img src={current.url} alt={`Raster halaman ${selectedRef?.page ?? 1} dari file sumber`}/>} {current?.cells && <><p>Teks sel terpilih dari sheet {current.sheet}; bukan tampilan asli workbook. Maksimal 250 sel. Formula tidak dijalankan.</p><table><thead><tr><th>Sel fisik</th><th>Teks / nilai tersimpan</th></tr></thead><tbody>{current.cells.map(c => <tr key={c.address}><th>{c.address}</th><td>{c.text}{c.formula && <small>Nilai cache formula · perlu diperiksa</small>}</td></tr>)}</tbody></table></>}</section>; }
