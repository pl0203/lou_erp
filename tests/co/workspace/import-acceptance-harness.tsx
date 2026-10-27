// Synthetic transport + extractor boundary. These tests are not PostgreSQL or native PDF-worker evidence.
import { expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { store, mount, wire, id, customer, month, draftId, allocation, reportImpact } from '../report-ui-harness';
import { input } from '../import/reviewFixture';
import type { ImportBinding, ImportManifest } from '../../../src/lib/co/import/types';
import { useLocation } from 'react-router-dom';
import COCustomerStock from '../../../src/pages/athel/co/COCustomerStock';
import { freshness } from '../report-ui-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';
const extractor = vi.hoisted(() => ({ extract: vi.fn() }));
export { extractor };
vi.mock('../../../src/lib/co/import/workerClient', () => ({ extractReport: extractor.extract }));

export function mappingContext(s: any, base: any) {
  return async (n: string, a: any): Promise<any> => {
    if (n === 'pilot_co_import_selection_v1') return { data: { version: '1', selectionId: null, state: null, importId: null, draftId, draftVersion: s.version, customerVersion: s.cv, reportHeadId: null, originalRevisionId: null, reportVersion: null }, error: null };
    if (n === 'pilot_co_import_eligible_v1') {
      const r = await base('pilot_co_report_rows_v1', { p_page: a.p_page, p_page_size: a.p_page_size, p_view: 'draft' });
      return { ...r, data: { ...r.data, selection_id: null } };
    }
    if (n === 'pilot_co_stock_key_units_v1') return { data: { customerVersion: s.cv, rows: a.p_stock_key_ids.map((key: string) => ({ customerId: customer, stockKeyId: key, state: 'declared', declaration: { id: id(70), version: '1', unit: 'PCS', declaredBy: id(1), declaredAt: '2026-10-09T00:00:00Z', reason: 'Checked fixture unit' } })) }, error: null };
    return base(n, a);
  };
}
export async function loadSource(extracted = input().extracted) {
  const s = store();
  extracted.periodCandidates = [month];
  extractor.extract.mockReset().mockResolvedValue(extracted);
  wire.handler = mappingContext(s, wire.handler);
  mount(<COMonthlyReport />);
  fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'), { target: { files: [new File(['synthetic'], 'synthetic.pdf')] } });
  await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
  return s;
}
export async function expandMapping() {
  fireEvent.click(await screen.findByRole('button', { name: 'Pilih SKU' }));
  fireEvent.change(screen.getByLabelText('SKU Padiwan'), { target: { value: id(1001) } });
  return screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement;
}
export function AcceptanceRoutes() { return useLocation().pathname === '/athel/co/stock' ? <COCustomerStock /> : <COMonthlyReport />; }
const outerFingerprint = 'f'.repeat(64);
const ok = (data: any) => ({ data, error: null });
const page = (rows: any[], a: any) => ({ version: '1', as_of: '2026-10-09T00:00:00Z', page: a.p_page, page_size: a.p_page_size, total: String(rows.length), rows: rows.slice((a.p_page - 1) * a.p_page_size, a.p_page * a.p_page_size) });
/** Explicit synthetic server: echoes checked contracts; it cannot prove SQL FIFO/atomicity/ACL. */
export function integratedServer() {
  const s = store(), base = wire.handler;
  let binding: ImportBinding | null = null, manifest: ImportManifest | null = null, selection: any = null;
  let evidence: any = null, evidenceReceipt: any = null, commitReceipt: any = null;
  const evidenceHistory = new Map<string, any>(), imports = new Map<string, any>();
  const requests: { n: string; a: any }[] = [];
  const allocationHistory=new Map<string,any[]>();
  const values=()=>{const q=BigInt(s.rows[0].sold_quantity??'0'),first=q>60n?60n:q,second=q-first,returned=BigInt(s.returnedQuantity??'0'),remaining=100n-q-returned;return {q,first,second,returned,remaining,amount:(first*10000n+second*12000n).toString(),stockValue:((60n-first)*10000n+(40n-second-returned)*12000n).toString()}};
  const allocationRows = [allocation(1, '60', '10000'), allocation(2, '10', '12000')].map((r, i) => ({ ...r, id: id(150 + i), customer_id: customer, report_revision_id: id(5), batch_id: id(250 + i), delivery_head_id: id(350 + i), delivery_revision_id: id(450 + i) }));
  const context = mappingContext(s, base);
  const server = async (n: string, a: any): Promise<any> => {
    requests.push({ n, a });
    if (n === 'pilot_co_evidence_transaction_v1') {
      if (a.p_operation === 'register_evidence') {
        const evidenceId = id(60 + evidenceHistory.size);
        evidence = { id: evidenceId, version: '1', customer_id: customer, customer_version: s.cv, draft_id: draftId, draft_version: s.version, report_month: month, filename: `evidence-${evidenceId}.${a.p_payload.mime_type === 'application/pdf' ? 'pdf' : 'xlsx'}`, mime_type: a.p_payload.mime_type, byte_size: a.p_payload.byte_size, state: 'pending', finalized_draft_version: null };
      } else {
        evidence = { ...evidence, version: '2', state: 'finalized', finalized_draft_version: String(BigInt(s.version) + 1n) };
        s.version = evidence.finalized_draft_version;
        evidenceHistory.set(evidence.id, structuredClone(evidence));
      }
      evidenceReceipt = { id: evidence.id, operation: a.p_operation, version: evidence.version, customer_id: customer, customer_version: s.cv };
      return ok(evidenceReceipt);
    }
    if (n === 'pilot_reconcile_co_evidence_v1') return ok({ status: 'committed', operation: evidenceReceipt.operation, receipt: evidenceReceipt });
    if (n === 'pilot_co_evidence_v1') return ok(evidence);
    if (n === 'pilot_co_evidence_selection_v1') return ok({ version: '1', customer_id: customer, draft_id: a.p_draft_id, draft_version: a.p_expected_draft_version, revision_id: a.p_revision_id, evidence: evidence?.state === 'finalized' ? evidence : null });
    if (n === 'pilot_co_import_selection_v1') return ok({ version: '1', selectionId: selection?.selectionId ?? binding?.importId ?? null, state: selection?.state ?? (binding ? 'selected' : null), importId: selection ? null : binding?.importId ?? null, draftId, draftVersion: s.version, customerVersion: s.cv, reportHeadId: s.effective?.report_head_id ?? null, originalRevisionId: s.effective?.revision_id ?? null, reportVersion: s.effective?.report_version ?? null });
    if (n === 'pilot_co_import_eligible_v1') {
      const r = await context(n, a);
      return { ...r, data: { ...r.data, selection_id: selection?.selectionId ?? binding?.importId ?? null } };
    }
    if (n === 'pilot_co_import_review_v1') {
      s.version = String(BigInt(s.version) + 1n);
      s.metadata.consumed = false;
      selection = { version: '1', selectionId: id(90), state: 'review_open', draftId, draftVersion: s.version, customerVersion: s.cv };
      return ok(selection);
    }
    if (n === 'pilot_co_import_review_reconcile_v1') return ok({ status: 'committed', operation: 'review_import', review: selection });
    if (n === 'pilot_co_import_prepare_v1') {
      manifest = structuredClone(a.p_payload.manifest);
      for(const row of s.rows){const decisions=manifest!.input.mappings.filter(m=>m.included&&m.stockKeyId===row.stock_key_id);if(decisions.length)row.sold_quantity=decisions.reduce((n,m)=>n+BigInt(m.quantity!),0n).toString();else if(manifest!.input.omittedZeroStockKeyIds.includes(row.stock_key_id))row.sold_quantity='0'}
      s.version = String(BigInt(s.version) + 1n);
      binding = { importId: id(80 + imports.size), importVersion: '1' as any, customerVersion: s.cv, draftId, draftVersion: s.version, manifestDigest: manifest!.digest };
      selection = null;
      return ok(binding);
    }
    if (n === 'pilot_reconcile_co_import_prepare_v1') return ok({ status: 'committed', operation: 'prepare_import', binding });
    if (n === 'pilot_co_import_read_v1') return ok({ manifest, binding });
    if (n === 'pilot_co_import_preview_v1') return ok({ binding, previewFingerprint: outerFingerprint, requiredReopenOrders: [], issues: [], existingPreview: { version: '1', as_of: '2026-10-09T00:00:00Z', operation: s.effective ? 'correct_report' : 'post_report', customer_id: customer, customer_version: s.cv, draft_version: s.version, preview_fingerprint: 'e'.repeat(64), can_post: true, before: { sold_quantity: s.effective?.sold_quantity??'0', revenue: s.effective?.revenue??'0', remaining_quantity: (100n-BigInt(s.effective?.sold_quantity??'0')).toString(), complete: true }, after: { sold_quantity: values().q.toString(), revenue: values().amount, remaining_quantity: values().remaining.toString(), complete: true }, counts: { report: '1', stock: '1', revenue: '0', credit: '0', reopen: '0', issue: '0', missing_month: '0' } } });
    if (n === 'pilot_co_import_impacts_v1') {
      expect(a.p_binding).toEqual(binding);
      expect(a.p_preview_fingerprint).toBe(outerFingerprint);
      const rows = a.p_kind === 'report' ? [{...reportImpact(),before_sold_quantity:s.effective?.sold_quantity??'0',after_sold_quantity:values().q.toString(),before_revenue:s.effective?.revenue??'0',after_revenue:values().amount}] : a.p_kind === 'stock' ? [{ stock_key_id: id(1001), batch_id: id(250), before_quantity:(100n-BigInt(s.effective?.sold_quantity??'0')).toString(), after_quantity:values().remaining.toString() }] : [];
      return ok({ ...page(rows, a), binding, preview_fingerprint: outerFingerprint, acknowledged_reopen_orders: [], kind: a.p_kind });
    }
    if (n === 'pilot_co_import_commit_v1') {
      const revision = id(5 + imports.size), version = String(imports.size + 1), operation = s.effective ? 'correct_report' : 'post_report';
      s.cv = String(BigInt(s.cv) + 1n);
      s.effective = { ...s.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null, report_head_id: id(4), revision_id: revision, report_version: version, revenue: values().amount, eligible_set_fingerprint: null };
      s.metadata.consumed = true;
      imports.set(revision, { version: '1', as_of: '2026-10-09T00:00:00Z', customer_id: customer, report_month: month, revision_id: revision, report_head_id: id(4), effective_revision_id: revision, manifest: structuredClone(manifest), unit_declarations: { [id(1001)]: { id: id(70), version: '1', unit: 'PCS' } }, source_amount: manifest!.input.extracted.sourceRows[0].amount!.decimal, currency: 'IDR', source_filename: evidence.filename, created_at: '2026-10-09T00:00:00Z', created_by: id(1), author_name: 'Original operator', reason: manifest!.input.reason, report_version: version, previous_revision_id: imports.size ? id(5) : null });
      allocationHistory.set(revision,allocationRows.map((r,i)=>({...r,report_revision_id:revision,quantity:(i?values().second:values().first).toString(),amount:((i?values().second:values().first)*(i?12000n:10000n)).toString()})).filter(r=>r.quantity!=='0'));
      commitReceipt = { id: id(4), operation, version, customer_id: customer, customer_version: s.cv };
      return ok(commitReceipt);
    }
    if (n === 'pilot_co_import_reconcile_v1') return ok({ status: 'committed', operation: commitReceipt.operation, receipt: commitReceipt });
    if (n === 'pilot_co_customer_stock_v2') return ok({ ...page([{
      id:id(1001),stock_key_id:id(1001),customer_id:customer,customer_name:'Store A',customer_version:s.cv,generation_id:id(8000),normalized_sku:'sku-1',display_sku:'SKU-1',product_name:'Item 1',product_id:null,
      opening_quantity:'100',delivered_quantity:'0',sold_quantity:values().q.toString(),returned_quantity:values().returned.toString(),recorded_quantity:values().remaining.toString(),has_delivery_history:true,last_report_month:month,coverage_through_date:'2026-09-30',reporting_freshness:freshness,
      unit:'PCS',unit_basis:'declared_by_cutoff',unit_declaration:{id:id(70),version:'1',unit:'PCS',declared_at:'2026-08-01T00:00:00Z'},contract_stock_value:values().stockValue,contract_currency:'IDR',contract_unit_price:values().q<60n?null:values().remaining===0n?null:'12000',price_state:values().remaining===0n?'unknown':values().q<60n?'mixed':'single',valuation_basis:'retained_co_batch',
    }],a),version:'2',customer_id:a.p_customer_id,customer_version:s.cv,generation_id:id(8000),sku:a.p_sku,normalized_search:a.p_search.trim().toLowerCase(),stock_as_of:a.p_as_of,period_start:'2026-10-01',coverage_date:'2026-10-09',sort:a.p_sort,direction:a.p_direction,reporting_freshness:freshness });
    if (n === 'pilot_co_report_import_v1') return ok(imports.get(a.p_revision_id));
    if (n === 'pilot_co_report_allocations_v1') return ok({ ...page(allocationHistory.get(a.p_revision_id)??[], a), customer_id: customer, customer_version: s.cv, report_month: month, revision_id: a.p_revision_id, generation_id: null, is_effective: a.p_revision_id === s.effective?.revision_id, summary: { quantity:(allocationHistory.get(a.p_revision_id)??[]).reduce((q,r)=>q+BigInt(r.quantity),0n).toString(), amount:(allocationHistory.get(a.p_revision_id)??[]).reduce((q,r)=>q+BigInt(r.amount),0n).toString() } });
    return context(n, a);
  };
  wire.handler = server;
  wire.invoke.mockImplementation(async n => {
    if (n !== 'co-evidence-upload') throw Error(`Unexpected synthetic function ${n}`);
    evidence = { ...evidence, state: 'verified' };
    return ok({ id: evidence.id, state: 'verified' });
  });
  return { s, server, requests, evidenceHistory, imports };
}
export async function syntheticFile(format: 'pdf' | 'xlsx') {
  const bytes = format === 'pdf' ? new TextEncoder().encode('%PDF-1.7\n%%EOF\n') : (await import('../import/fixtures/xlsx-layout')).zip((await import('../import/fixtures/xlsx-layout')).parts());
  const file = new File([bytes], `synthetic.${format}`, { type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const extracted = input().extracted;
  extracted.sha256 = sha; extracted.format = format; extracted.periodCandidates = [month];
  Object.assign(extracted.sourceRows[0], { ref: { ...extracted.sourceRows[0].ref, fileSha256: sha }, quantity: { raw: '70', decimal: '70' }, amount: { raw: '2264500', decimal: '2264500' } });
  return { file, extracted };
}
export async function checkMapping(quantityText = '70') {
  const quantity = await expandMapping();
  fireEvent.change(quantity, { target: { value: quantityText } });
  fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
  fireEvent.click(screen.getByLabelText(/Semua barang dan bagian sumber/));
  fireEvent.change(screen.getByLabelText('Mata uang sumber'), { target: { value: 'IDR' } });
}
export async function beginIntegrated(f = integratedServer(), quantity = '70', element = <COMonthlyReport />) {
  const source = await syntheticFile('pdf');
  source.extracted.sourceRows[0].quantity={raw:quantity,decimal:quantity};
  const amount=(BigInt(quantity)*32350n).toString();
  source.extracted.sourceRows[0].amount={raw:amount,decimal:amount};
  extractor.extract.mockReset().mockResolvedValue(source.extracted);
  const view = mount(element);
  fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'), { target: { files: [source.file] } });
  await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
  await checkMapping(quantity);
  return { f, source, ...view };
}
export async function readyPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau pencatatan' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Catat penjualan' }) as HTMLButtonElement).disabled).toBe(false));
}
export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
