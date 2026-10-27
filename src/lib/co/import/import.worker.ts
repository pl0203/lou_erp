import { assertResultBudget } from './resultBudget';
import type { ImportRequest, ImportResponse } from './workerClient';
// Module worker has no account/storage APIs. Parent owns cancellation via terminate().
self.onmessage = async (event: MessageEvent<ImportRequest>) => {
    const { requestId, scope, format, bytes, sha256 } = event.data;
    const response: ImportResponse = { requestId, scope };
    try {
        const signal = new AbortController().signal;
        if (format === 'xlsx') {
            const { extractXlsx } = await import('./xlsx');
            response.result = await extractXlsx(bytes, sha256, signal);
        }
        else {
            // Reuse the bundled PDF worker handler in this worker: no nested PDF worker or CDN.
            const handler = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
            (globalThis as typeof globalThis & {
                pdfjsWorker: typeof handler;
            }).pdfjsWorker = handler;
            const { extractPdf } = await import('./pdf');
            response.result = await extractPdf(bytes, sha256, signal);
        }
    }
    catch {
        response.error = 'worker_error';
    }
    // Reject before structured-clone/postMessage can materialize an oversized payload.
    try {
        assertResultBudget(response.result);
    }
    catch {
        delete response.result;
        response.error = 'result_budget';
    }
    self.postMessage(response);
};
