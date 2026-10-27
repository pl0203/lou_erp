import { integratedServer, syntheticFile, extractor, checkMapping, readyPreview, AcceptanceRoutes } from './import-acceptance-harness';
import { stockFixture } from '../stock-ui-harness';
import { test, expect } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { mount, wire, id, customer } from '../report-ui-harness';

test.each(['already-recorded','newly-recorded'] as const)('%s unsold return is separately owned and explicitly reconciled; monthly sales70/source2264500 are never netted',async mode=>{
 const returns=stockFixture(1),oldBatch=returns.batches[0],baseStock=returns.stockRows()[0];
 returns.batches=[{...oldBatch,id:id(250),co_id:id(4001),co_number:'CO-1',co_line_id:id(5001),delivery_head_id:id(350),delivery_revision_id:id(450),available_quantity:'60',unit_price:'10000',sj_number:'SJ-1'},{...oldBatch,id:id(251),co_id:id(4002),co_number:'CO-2',co_line_id:id(5002),delivery_head_id:id(351),delivery_revision_id:id(451),available_quantity:'40',unit_price:'12000',sj_number:'SJ-2'}];
 returns.stockRows=()=>[{...baseStock,opening_quantity:'100',recorded_quantity:returns.effective?'95':'100',returned_quantity:returns.effective?'5':'0'}];
 const returnServer=wire.handler,f=integratedServer(),returnRequests:any[]=[];
 if(mode==='already-recorded'){
  const draft=returns.makeDraft([{batch_id:id(251),quantity:5}]);returns.cv='2';returns.effective={header:{...draft.header,id:id(211),target_kind:'revision',draft_version:null,head_id:id(21),head_version:'1',revision_id:id(211),revision_no:'1',return_date:'2026-09-10',reference:'RETURN-5',reason:null,bound_customer_version:null,consumed:false,is_void:false},lines:draft.lines.map((l:any)=>({...l,revision_id:id(211),draft_id:null}))};returns.history=[structuredClone(returns.effective)];returns.batches[1].available_quantity='35';f.s.cv='2';f.s.returnedQuantity='5';
 }
 wire.handler=async(n,a)=>{
  if(n==='pilot_co_import_return_candidates_v1')return {data:{customerId:customer,stockKeyId:id(1001),customerVersion:f.s.cv,page:a.p_page,pageSize:a.p_page_size,total:returns.effective?'1':'0',rows:returns.effective?[{headId:id(21),revisionId:id(211),version:'1',date:'2026-09-10',reference:'RETURN-5',displaySku:'SKU-1',productName:'Item 1',quantity:'5',unit:'PCS'}]:[]},error:null};
  if(['pilot_co_customer_stock_v1','pilot_co_customer_batches_v1','pilot_co_return_v1','pilot_co_preview_v1','pilot_co_preview_impacts_v1','pilot_co_preview_labeled_impacts_v1','pilot_reconcile_co_v1'].includes(n)||n==='pilot_co_transaction_v1'&&a.p_operation!=='save_report_draft'){
   returnRequests.push({n,a});const r=await returnServer(n,a);if(n==='pilot_co_transaction_v1'&&a.p_operation==='post_return'&&!r.error){f.s.cv=returns.cv;f.s.returnedQuantity='5'}return r;
  }
  return f.server(n,a);
 };
 const source=await syntheticFile('pdf');source.extracted.sourceRows[0].returned={raw:'5',decimal:'5'};extractor.extract.mockReset().mockResolvedValue(source.extracted);const {client}=mount(<AcceptanceRoutes/>);
 fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'),{target:{files:[source.file]}});await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');await checkMapping();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Cocokkan retur (1)'}));
 if(mode==='newly-recorded'){
  fireEvent.click(screen.getByRole('button',{name:'Catat retur terpisah'}));const quantity=await screen.findByLabelText('Jumlah retur SJ-2 Item 1');await waitFor(()=>expect(quantity.matches(':disabled')).toBe(false));
  expect((screen.getByLabelText('Tanggal retur') as HTMLInputElement).value).toBe('');
  fireEvent.change(quantity,{target:{value:'5'}});fireEvent.change(screen.getByLabelText('Referensi retur'),{target:{value:'RETURN-5'}});const save=screen.getByRole('button',{name:'Simpan Draft retur'});await waitFor(()=>expect(save.matches(':disabled')).toBe(false));fireEvent.click(save);
  await act(async()=>{await Promise.resolve()});expect(returns.commands).toHaveLength(0);await screen.findByText('Isi tanggal retur yang valid.');expect(returnRequests.filter(r=>r.n==='pilot_co_transaction_v1')).toHaveLength(0);expect(screen.getByRole('button',{name:'Tinjau / post retur'}).matches(':disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Tanggal retur'),{target:{value:'2026-09-10'}});fireEvent.click(screen.getByRole('button',{name:'Simpan Draft retur'}));
  const review=await screen.findByRole('button',{name:'Tinjau / post retur'});await waitFor(()=>expect(review.matches(':disabled')).toBe(false));
  expect(returns.commands.map((c:any)=>c.op)).toEqual(['save_return_draft']);expect(returns.commands[0].payload.return_date).toBe('2026-09-10');expect((screen.getByLabelText('Tanggal retur') as HTMLInputElement).value).toBe('2026-09-10');
  await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]==='return-preparation'}));await waitFor(()=>expect(review.matches(':disabled')).toBe(false));expect((screen.getByLabelText('Tanggal retur') as HTMLInputElement).value).toBe('2026-09-10');fireEvent.click(review);fireEvent.change(await screen.findByLabelText('Alasan perubahan'),{target:{value:'Unsold physical stock sent back'}});fireEvent.click(screen.getByRole('button',{name:'Tinjau semua dampak'}));const apply=await screen.findByRole('button',{name:'Terapkan perubahan'});await waitFor(()=>expect(apply.matches(':disabled')).toBe(false));fireEvent.click(apply);await waitFor(()=>expect(returns.commands.map((c:any)=>c.op)).toEqual(['save_return_draft','post_return']));await waitFor(()=>expect(screen.queryByLabelText('Tanggal retur')).toBeNull());
  expect(returns.commands.map((c:any)=>c.op)).toEqual(['save_return_draft','post_return']);expect(returns.batches[1].available_quantity).toBe('35');expect(returns.effective.header.return_date).toBe('2026-09-10');
  const refresh=await screen.findByRole('button',{name:'Periksa ulang dampak'});await waitFor(()=>expect(refresh.matches(':disabled')).toBe(false));fireEvent.click(refresh);
 }
 await screen.findByRole('option',{name:/RETURN-5/});const candidate=screen.getByLabelText('Retur tercatat untuk SKU ini');fireEvent.change(candidate,{target:{value:id(211)}});await screen.findByText(/Bukti kanonis: 2026-09-10/);
 fireEvent.change(screen.getByLabelText('Jumlah yang dicocokkan'),{target:{value:'5'}});fireEvent.change(screen.getByLabelText('Dasar pencocokan'),{target:{value:'Checked actual unsold warehouse return'}});fireEvent.click(screen.getByLabelText('Tanggal, barang dan jumlah retur fisik sesuai bukti terpilih'));fireEvent.click(screen.getByRole('button',{name:'Konfirmasi tautan retur'}));
 await screen.findByText('Total dicocokkan: 5 PCS');expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('70');await readyPreview();
 const manifest=f.requests.find(r=>r.n==='pilot_co_import_prepare_v1')!.a.p_payload.manifest;expect(manifest.input.mappings[0].quantity).toBe('70');expect(manifest.input.extracted.sourceRows[0].amount.decimal).toBe('2264500');expect(manifest.input.returns[0].links[0]).toMatchObject({returnRevisionId:id(211),quantity:'5',confirmation:{physicalReturnDate:'2026-09-10',confirmed:true}});
 const priorWrites=returns.commands.length;fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});expect(returns.commands).toHaveLength(priorWrites);expect(priorWrites).toBe(mode==='already-recorded'?0:2);expect(f.s.effective.sold_quantity).toBe('70');
 const returnPosts=returnRequests.filter(r=>r.n==='pilot_co_transaction_v1'&&r.a.p_operation==='post_return');expect(returnPosts).toHaveLength(mode==='already-recorded'?0:1);if(returnPosts.length)expect(returnPosts[0].a.p_request_id).not.toBe(f.requests.find(r=>r.n==='pilot_co_import_commit_v1')!.a.p_request_id);
 fireEvent.click(screen.getByRole('link',{name:'Lihat stok toko'}));const stock=await screen.findByRole('table',{name:'Stok pelanggan tercatat'});const cells=within(stock.querySelector('tbody tr') as HTMLElement).getAllByRole('cell').map(c=>c.textContent);expect(cells).toContain('70');expect(cells).toContain('5');expect(cells).toContain('25');
},15000);

// Transport contract only: the real committed-witness predicate is exercised by
// authored SQL fixtures, not implemented in this synthetic server.
test('server-proven prior coverage remains unresolved through confirmation and exact recorded evidence; no return command',async()=>{
 const f=integratedServer();let pending=false;const proof={basis:'prior_committed_exact_coverage',rowId:'r1',priorImportId:id(79),priorReportRevisionId:id(4),priorManifestDigest:'a'.repeat(64),priorValidationDigest:'b'.repeat(64)};
 wire.handler=async(n,a)=>{if(n==='pilot_co_import_prepare_v1')pending=a.p_payload.manifest.input.returns[0]?.state==='unresolved';const r=await f.server(n,a);if(n==='pilot_co_import_preview_v1'&&pending)r.data.issues=[{code:'return_unresolved_prior_coverage_proven',rowId:'r1',message:'Pilihan manusia belum dicocokkan; cakupan retur terdahulu dibuktikan server.',blocking:false}];if(n==='pilot_co_report_import_v1'&&r.data)r.data.return_proofs=[proof];return r};
 const source=await syntheticFile('pdf');source.extracted.sourceRows[0].returned={raw:'5',decimal:'5'};extractor.extract.mockReset().mockResolvedValue(source.extracted);mount(<AcceptanceRoutes/>);
 fireEvent.change(await screen.findByLabelText('Pilih PDF atau XLSX'),{target:{files:[source.file]}});await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');await checkMapping();
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Cocokkan retur (1)'}));fireEvent.click(await screen.findByRole('button',{name:'Periksa cakupan retur terdahulu'}));await readyPreview();
 expect(screen.getAllByText(/Pilihan manusia belum dicocokkan; cakupan retur terdahulu dibuktikan server/).length).toBeGreaterThan(0);
 const manifest=f.requests.find(r=>r.n==='pilot_co_import_prepare_v1')!.a.p_payload.manifest;expect(manifest.input.returns[0]).toMatchObject({state:'unresolved',stockImpact:'uncertain',links:[]});
 fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});expect(await screen.findByText(/Pilihan manusia belum dicocokkan; cakupan retur terdahulu dibuktikan server/)).toBeTruthy();expect(f.requests.filter(r=>r.n==='pilot_co_transaction_v1'&&/return/.test(r.a.p_operation))).toHaveLength(0);
},15000);
