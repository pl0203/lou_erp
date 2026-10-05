// Candidate-only QA. No backend/auth/transaction sender. Local files stay in memory.
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './candidate.css';
import { paymentTermsMatch, validExpectedLabels } from './comparison';
import type { ExpectedLabels, ExpectedSource } from './comparison';
import type { ParsedPO, LocalDocument } from '../../src/lib/poImport/contracts';
const audit: {
    kind: string;
    time: string;
    url?: string;
    method?: string;
    body?: boolean;
    detail?: string;
}[] = [];
const add = (kind: string, data: Record<string, unknown> = {}) => audit.push({ kind, time: new Date().toISOString(), ...data });
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => { const url = input instanceof Request ? input.url : String(input); add('fetch', { url, method: init?.method || (input instanceof Request ? input.method : 'GET'), body: !!init?.body || (input instanceof Request && !!input.body) }); return realFetch(input, init); };
const realOpen = XMLHttpRequest.prototype.open, realSend = XMLHttpRequest.prototype.send;
const xhrMeta = new WeakMap<XMLHttpRequest, {
    url: string;
    method: string;
}>();
XMLHttpRequest.prototype.open = function (method, url, ...rest: any[]) { xhrMeta.set(this, { url: String(url), method }); return (realOpen as any).call(this, method, url, ...rest); };
XMLHttpRequest.prototype.send = function (body) { add('xhr', { ...xhrMeta.get(this), body: !!body }); return realSend.call(this, body); };
const realBeacon = navigator.sendBeacon?.bind(navigator);
if (realBeacon)
    navigator.sendBeacon = (url, data) => { add('beacon', { url: String(url), method: 'POST', body: !!data }); return realBeacon(url, data); };
const realCreate = URL.createObjectURL.bind(URL), realRevoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => { const url = realCreate(blob); add('object-url-create'); return url; };
URL.revokeObjectURL = (url) => { add('object-url-revoke'); realRevoke(url); };
// Observe native worker construction/termination without changing its script base URL.
// Worker-level network evidence is collected separately in browser DevTools.
const RealWorker = window.Worker;
let failNextWorker = false;
window.Worker = new Proxy(RealWorker, {
    construct(target, args) {
        const original = String(args[0]);
        let created = original;
        if (failNextWorker) {
            failNextWorker = false;
            created = location.origin + '/po-reader/qa-intentionally-missing-worker.js';
            add('qa-asset-failure-injected');
        }
        add('worker', { url: original });
        const worker = Reflect.construct(target, [created, args[1]]);
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => { add('worker-terminate'); terminate(); };
        return worker;
    }
});
new PerformanceObserver(list => { for (const e of list.getEntries() as PerformanceResourceTiming[])
    add('resource', { url: e.name, detail: `initiator=${e.initiatorType};durationMs=${Math.round(e.duration)};bytes=${e.transferSize}` }); }).observe({ type: 'resource', buffered: true });
const oldStorage = Storage.prototype.setItem;
Storage.prototype.setItem = function (k, v) { add('storage-write', { detail: `keyLength=${k.length};valueLength=${v.length}` }); return oldStorage.call(this, k, v); };
const realIDB = indexedDB.open.bind(indexedDB);
indexedDB.open = (name, version) => { add('indexed-db-open', { detail: `nameLength=${name.length}` }); return realIDB(name, version); };
const norm = (v: any) => String(v ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const scalar = (v: any) => v?.value ?? null;
const num = (v: any) => v === null || v === undefined || v === '' ? null : Number(v);
function compare(po: ParsedPO, source: ExpectedSource) {
    const fields: any[] = [];
    const equal = (field: string, actual: any, expected: any) => fields.push({ field, ok: norm(actual) === norm(expected), actual, expected });
    equal('buyer', scalar(po.buyer), source.buyer_name);
    equal('supplier', scalar(po.supplier), source.supplier_name);
    equal('poNumber', scalar(po.poNumber), source.po_number);
    equal('orderDate', scalar(po.orderDate), source.order_date);
    equal('expiry', scalar(po.expiry), source.expiry_date);
    if (source.delivery_date !== undefined)
        equal('delivery', scalar(po.delivery), source.delivery_date);
    if (source.payment_terms_days !== undefined && source.payment_terms_days !== null)
        fields.push({ field: 'paymentTerms', ok: paymentTermsMatch(po.paymentTerms, source.payment_terms_days), actual: po.paymentTerms, expected: source.payment_terms_days });
    if (source.currency !== undefined)
        equal('currency', scalar(po.currency), source.currency);
    const total = source.printed_grand_total ?? source.printed_order_net_value;
    if (total !== undefined && total !== null) fields.push({ field: 'printedTotal', ok: num(scalar(po.printedTotal)) === num(total), actual: po.printedTotal, expected: total });
    const rows = source.items.map((e, i: number) => { const a = po.rows[i]; const checks = a ? { sourceCode: norm(scalar(e.source_code_label === 'BARCODE' ? a.barcode : a.sku)) === norm(e.source_code), name: norm(scalar(a.name)) === norm(e.name), quantity: num(scalar(a.quantity)) === num(e.quantity), unitPrice: num(scalar(a.unitPrice)) === num(e.unit_price), uom: norm(scalar(a.uom)) === norm(e.uom), ...(e.barcode ? { barcode: norm(scalar(a.barcode)) === norm(e.barcode) } : {}) } : { missing: false }; return { row: i + 1, ok: Object.values(checks).every(Boolean), checks, actual: a, expected: e }; });
    return { expectedRows: source.items.length, actualRows: po.rows.length, headers: fields, rows, allRowsExact: po.rows.length === source.items.length && rows.every((r: any) => r.ok), headerMatches: fields.filter(f => f.ok).length, headerChecks: fields.length };
}
function App() {
    const [file, setFile] = useState<File | null>(null), [labels, setLabels] = useState<ExpectedLabels | null>(null), [status, setStatus] = useState('Ready'), [result, setResult] = useState<any>(null), [Component, setComponent] = useState<any>(null), [dirty, setDirty] = useState(false), [applied, setApplied] = useState<any>(null), [actor, setActor] = useState('qa:user:operator'), [disabled, setDisabled] = useState(false), [narrow, setNarrow] = useState(false), [mode, setMode] = useState('reader'), [catalogRev, setCatalogRev] = useState(0), [auditRev, setAuditRev] = useState(0), [pendingApply, setPendingApply] = useState<any>(null);
    const controller = React.useRef<AbortController | null>(null), local = React.useRef<LocalDocument | null>(null), gen = React.useRef(0);
    const catalogs = React.useMemo(() => ({ customers: [{ id: 'qa-customer-1', name: 'QA Synthetic Customer', pricing_tier: 'dalam_kota' }, { id: 'qa-customer-2', name: 'QA Synthetic Customer Two', pricing_tier: 'others' }], products: [{ id: 'qa-product-1', name: 'QA Synthetic Widget', sku: 'QA-001', size: null, harga_pokok: 10, luar_kota: 15, dalam_kota: 20 + catalogRev, depo_bangunan: 25 }] }), [catalogRev]);
    useEffect(() => { const i = setInterval(() => setAuditRev(v => v + 1), 1000); return () => clearInterval(i); }, []);
    async function run() { if (!file)
        return; const g = ++gen.current; controller.current?.abort(); local.current?.dispose(); const c = new AbortController(); controller.current = c; setResult(null); setStatus('Loading actual reader'); const start = performance.now(); try {
        const { readPODocument } = await import('../../src/lib/poImport/reader.ts');
        const { parsePODocument } = await import('../../src/lib/poImport/parse.ts');
        const doc = await readPODocument(file, { signal: c.signal, onProgress: (p: any) => { if (g === gen.current)
                setStatus(`${p.stage} ${p.page}/${p.pages}`); } });
        if (g !== gen.current) {
            doc.dispose();
            return;
        }
        local.current = doc;
        const po = parsePODocument(doc.pages);
        const source = labels?.sources.find(s => s.file === file.name);
        const r = { timingMs: Math.round(performance.now() - start), pages: doc.pages.map(p => ({ page: p.page, source: p.source, tokens: p.tokens.length, width: p.width, height: p.height })), parsed: po, comparison: source ? compare(po, source) : null };
        setResult(r);
        setStatus(source ? 'Completed actual reader and parser; expected labels compared' : 'Completed actual reader and parser; no matching expected labels selected');
    }
    catch (error: any) {
        if (g === gen.current) {
            setResult({ errorCode: error.code || null, errorName: 'LocalReadFailure', errorMessage: 'Local document reading failed. Check the stable error code.', timingMs: Math.round(performance.now() - start) });
            setStatus('Reader failed');
        }
    } }
    async function loadUi() { try {
        const m = await import('../../src/components/poImport/PODocumentImport.tsx');
        setComponent(() => m.default);
        setMode('ui');
        setStatus('Actual importer loaded');
    }
    catch (e: any) {
        setStatus('Importer module unavailable');
    } }
    function cancel() { ++gen.current; controller.current?.abort(); local.current?.dispose(); local.current = null; setStatus('Cancelled'); setResult(null); }
    const safe = result ? result.comparison ? { timingMs: result.timingMs, pages: result.pages, layout: result.parsed.layout, complete: result.parsed.complete, expectedRows: result.comparison.expectedRows, actualRows: result.comparison.actualRows, rowChecks: result.comparison.rows.map((r: any) => ({ row: r.row, ok: r.ok, checks: r.checks })), headers: result.comparison.headers.map((f: any) => ({ field: f.field, ok: f.ok })), issues: result.parsed.issues.map((i: any) => ({ code: i.code, field: i.field, blocking: i.blocking })) } : { ...result, parsed: result.parsed ? { layout: result.parsed.layout, complete: result.parsed.complete, rowCount: result.parsed.rows.length, issues: result.parsed.issues.map((i: any) => ({ code: i.code, blocking: i.blocking })) } : undefined } : null;
    return <div className="min-h-screen bg-gray-50 text-gray-900"><main style={{ maxWidth: narrow ? 375 : 1080, margin: 'auto', padding: 16 }}><h1 className="text-xl font-semibold">Local PO browser QA · {import.meta.env.VITE_QA_REVISION}</h1><p>Actual modules, synthetic catalogs, no backend sender</p><div className="flex flex-wrap gap-3 my-4"><button onClick={() => setMode('reader')}>Reader mode</button><button onClick={() => { failNextWorker = true; add('qa-next-worker-failure-armed'); }}>Fail next worker asset</button><button onClick={loadUi}>Load actual importer</button><button onClick={() => setNarrow(!narrow)}>375px container: {narrow ? 'on' : 'off'}</button><button onClick={() => setCatalogRev(v => v + 1)}>Change synthetic catalog</button><button onClick={() => setApplied({ lineItems: [], qaManualEdits: true })}>Set synthetic form edits</button><button onClick={() => setActor(v => v === 'qa:user:operator' ? 'qa:other:admin' : 'qa:user:operator')}>Change actor</button><button onClick={() => setDisabled(v => !v)}>Disabled: {String(disabled)}</button><button onClick={() => { audit.length = 0; setAuditRev(v => v + 1); }}>Clear audit</button></div>{mode === 'reader' ? <section><label className="block">Expected extraction labels (memory only)<input aria-label="Expected extraction labels (memory only)" type="file" accept="application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const loaded: unknown = JSON.parse(await f.text()); if (!validExpectedLabels(loaded)) { setLabels(null); setStatus('Expected labels have an invalid shape; document reading remains available'); return; } setLabels(loaded); setStatus('Expected labels loaded in memory'); } catch { setLabels(null); setStatus('Expected label file could not be read; document reading remains available'); } }}/></label><p>Labels loaded: {labels?.sources?.length || 0}</p><label className="block mt-3">Local document<input aria-label="Local document" type="file" accept=".pdf,.jpeg,.jpg,.png,.webp" onChange={e => setFile(e.target.files?.[0] || null)}/></label><div className="flex flex-wrap gap-4 my-3"><button onClick={run} disabled={!file}>Run actual extraction</button><button onClick={cancel}>Cancel extraction</button></div></section> : Component ? <Component {...catalogs} actorKey={actor} disabled={disabled} hasFormEdits={!!applied} onApply={(draft: any, accept?: () => any) => { if (applied) {
        setPendingApply({ accept });
        add('qa-deferred-apply');
        return;
    } const accepted = accept ? accept() : null; if (!accepted) {
        add('apply-rejected');
        return;
    } setApplied(accepted); add('apply-to-harness', { detail: `rows=${accepted.lineItems.length}` }); }} onDirtyChange={setDirty}/> : null}{pendingApply && <div aria-label="Harness replacement confirmation"><p>Harness confirmation pending</p><button onClick={() => { const accepted = pendingApply.accept ? pendingApply.accept() : null; if (accepted) {
        setApplied(accepted);
        add('apply-to-harness', { detail: `rows=${accepted.lineItems.length}` });
    }
    else
        add('apply-rejected'); setPendingApply(null); }}>Accept pending Apply</button><button onClick={() => setPendingApply(null)}>Cancel pending Apply</button></div>}<p role="status">{status}</p><p>Importer dirty: {String(dirty)}; applied rows: {applied?.lineItems.length || 0}; transaction submissions: 0</p><details open><summary>Sanitized extraction report</summary><pre aria-label="Extraction report" className="text-xs overflow-auto whitespace-pre-wrap">{JSON.stringify(safe, null, 2)}</pre></details><details><summary>Local audit ({audit.length})</summary><pre aria-label="Network audit" className="text-xs overflow-auto whitespace-pre-wrap">{JSON.stringify(audit, null, 2)}</pre></details><p className="text-xs">Browser: {navigator.userAgent}; viewport: {innerWidth}x{innerHeight}; container: {narrow ? 375 : 1080}px; audit refresh {auditRev}</p></main></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
