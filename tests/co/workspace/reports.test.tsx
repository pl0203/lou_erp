import { expect, test } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { store, mount, wire, id, customer, month } from '../report-ui-harness';
import * as rpc from '../../../src/lib/co/rpc';
import COMonthlyReports from '../../../src/pages/athel/co/COMonthlyReports';
import { input } from '../import/reviewFixture';
const args = {p_customer_id:customer,p_month:month,p_status:'all',p_page:1,p_page_size:20};
const listRow = (change = {}) => ({id:id(4),customer_id:customer,customer_name:'Store A',report_month:month,status:'posted',revision_id:id(5),report_head_id:id(4),legacy_pending:true,source_filename:'private.pdf',updated_at:'2026-10-09T00:00:00Z',...change});
const list = (rows = [listRow()], change = {}) => ({version:'2',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,status:'all',page:1,page_size:20,total:String(rows.length),rows,...change});
const manifest = () => ({schemaVersion:1,evidenceId:id(8),digest:'a'.repeat(64),input:input({scope:{actorId:id(1),customerId:customer,reportMonth:month,epoch:0},mappings:[]})});
const source = () => ({version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:id(5),report_head_id:id(4),effective_revision_id:id(5),manifest:manifest(),unit_declarations:{},source_amount:'64700',currency:'IDR',source_filename:'private.pdf',created_at:'2026-10-09T00:00:00Z',created_by:id(1),author_name:'Operator',reason:null,report_version:'1',previous_revision_id:null});
function reply(data:unknown) {store();wire.handler=async()=>({data,error:null})}
test('v2 monthly read has one effective row with accessible legacy work flag',async()=>{reply(list());expect(typeof rpc.fetchCOReportsPageV2).toBe('function');const result=await rpc.fetchCOReportsPageV2(args);expect(result.rows).toEqual([listRow()]);expect(wire.rpc.mock.calls.at(-1)?.[0]).toBe('pilot_co_reports_page_v2')});
test('legacy-only month is explicitly historical pending, not zero or posted',async()=>{reply(list([listRow({status:'historical_pending',revision_id:null,report_head_id:null,source_filename:null})]));const result=await rpc.fetchCOReportsPageV2(args);expect(result.rows[0].status).toBe('historical_pending')});
test.each([
 ['duplicate month',()=>list([listRow(),listRow({id:id(9)})])],
 ['wrong customer',()=>list([listRow({customer_id:id(99)})])],
 ['wrong month',()=>list([listRow({report_month:'2026-08-01'})])],
 ['unsafe quantity',()=>list(undefined,{total:1})],
 ['incomplete page',()=>list(undefined,{total:'2'})],
 ['wrong status binding',()=>list(undefined,{status:'posted'})],
 ['posted without revision',()=>list([listRow({revision_id:null})])],
 ['pending without recovery',()=>list([listRow({status:'historical_pending',revision_id:null,report_head_id:null,legacy_pending:false})])],
 ['unexpected source URL',()=>list([listRow({source_url:'https://private.invalid'})])],
])('strict v2 decoder rejects %s',async(_,data)=>{reply(data());await expect(rpc.fetchCOReportsPageV2(args)).rejects.toThrow()});
test('immutable source reader binds requested revision rather than replacing with effective',async()=>{reply(source());expect(typeof rpc.fetchCOReportImport).toBe('function');const r=await rpc.fetchCOReportImport(customer,month,id(5));expect(r.manifest?.evidenceId).toBe(id(8));reply({...source(),revision_id:id(6)});await expect(rpc.fetchCOReportImport(customer,month,id(5))).rejects.toThrow()});
test('source reader rejects mismatched manifest scope and mixed legacy source fields',async()=>{const data=source();data.manifest.input.scope.customerId=id(99);reply(data);await expect(rpc.fetchCOReportImport(customer,month,id(5))).rejects.toThrow();reply({...source(),manifest:null});await expect(rpc.fetchCOReportImport(customer,month,id(5))).rejects.toThrow()});
test('list uses v2 posted server filter and one recorded row without draft recovery actions', async () => {
 const s=store(),base=s.handle;
 wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:list(undefined,{report_month:a.p_month,status:a.p_status}),error:null}:base(n,a);
 mount(<COMonthlyReports/>,`/athel/co/reports?customer=${customer}`);
 await screen.findByRole('link',{name:'Buka laporan'});
 expect(screen.getByRole('columnheader',{name:'Toko'})).toBeTruthy();
 expect(screen.getAllByRole('link',{name:'Buka laporan'})).toHaveLength(1);
 expect(screen.queryByRole('link',{name:'Periksa pekerjaan lama'})).toBeNull();
 expect(screen.queryByLabelText('Status laporan')).toBeNull();
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_reports_page_v2').every(([,a])=>a.p_status==='posted')).toBe(true);
});

test('recorded route shows immutable source separately from retained FIFO value, and Edit preloads current report',async()=>{const {default:COMonthlyReport}=await import('../../../src/pages/athel/co/COMonthlyReport');const s=store();s.rows[0].sold_quantity='2';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'200'};s.draft=false;const base=s.handle;wire.handler=async(n,a)=>n==='pilot_co_report_import_v1'?{data:{...source(),manifest:null,unit_declarations:{},source_amount:null,currency:null},error:null}:n==='pilot_co_report_allocations_v1'?{data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0'},page:1,page_size:100,total:'0',rows:[]},error:null}:base(n,a);mount(<COMonthlyReport/>);expect(await screen.findByRole('columnheader',{name:'Harga satuan laporan'})).toBeTruthy();expect(screen.getByRole('columnheader',{name:'Harga CO'})).toBeTruthy();expect(screen.getAllByText('Tidak tersedia').length).toBeGreaterThan(0);fireEvent.click(screen.getByRole('button',{name:'Edit'}));expect(await screen.findByText('Laporan tercatat saat ini')).toBeTruthy();expect(await screen.findByText('Nilai awal dari laporan tercatat (ledger historis); sumber asli tidak tersedia')).toBeTruthy();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByRole('button',{name:/Simpan draf/i})).toBeNull()});

test('recorded source prices remain distinct, mixed-price drilldown retains returns and exact FIFO amounts',async()=>{const {render,within}=await import('@testing-library/react');const {RecordedReportRows}=await import('../../../src/components/co/CORecordedReportTable');const {row}=await import('../import/reviewFixture');const {parseQuantity,parseMoney,parseVersion}=await import('../../../src/lib/co/validation');const data=source();data.manifest.input=input({scope:{actorId:id(1),customerId:customer,reportMonth:month,epoch:0},extracted:{...input().extracted,sourceRows:[row({quantity:{raw:'2',decimal:'2'},returned:{raw:'1',decimal:'1'},unitPrice:{raw:'10',decimal:'10'},amount:{raw:'20',decimal:'20'}}),row({id:'r2',quantity:{raw:'3',decimal:'3'},unitPrice:{raw:'20',decimal:'20'},amount:{raw:'60',decimal:'60'},ref:{...row().ref,row:'2'}})]},mappings:['r1','r2'].map((rowId,i)=>({rowId,stockKeyId:id(1001),ledgerUnit:'PCS',quantity:parseQuantity(i?'3':'2'),conversion:null,included:true,exclusionReason:null,confirmed:true}))});data.unit_declarations={[id(1001)]:{id:id(88),version:parseVersion('1'),unit:'PCS'}};const s=store();const allocation=(quantity:string,price:string,n:number)=>({id:id(n),stock_key_id:id(1001),quantity:parseQuantity(quantity),unit_price:parseMoney(price),amount:parseMoney(String(BigInt(quantity)*BigInt(price)))});render(<RecordedReportRows rows={[{...s.rows[0],sold_quantity:parseQuantity('5')}]} source={data} allocations={[allocation('4','100',90),allocation('1','200',91)]}/>);expect(screen.getAllByText('Beragam')).toHaveLength(2);expect(screen.getByText('Rp 600')).toBeTruthy();expect(screen.getByText('80 IDR')).toBeTruthy();expect(screen.getByText(/Retur sumber 1/)).toBeTruthy();expect(screen.queryByText('Pendapatan')).toBeNull()});
test('v2 read refuses stale owner and preserves abort signal without issuing requests',async()=>{reply(list());await expect(rpc.fetchCOReportsPageV2(args,{isCurrent:()=>false})).rejects.toThrow();expect(wire.rpc).not.toHaveBeenCalled();const controller=new AbortController();controller.abort();await expect(rpc.fetchCOReportsPageV2(args,{signal:controller.signal})).rejects.toThrow();expect(wire.rpc).not.toHaveBeenCalled()});

test('recorded source authority denial tears down private table and cache, without auto-retry',async()=>{const {default:COMonthlyReport}=await import('../../../src/pages/athel/co/COMonthlyReport');const {act}=await import('@testing-library/react');const s=store();s.rows[0].sold_quantity='0';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'0'};let denied=false,reads=0;const base=s.handle;wire.handler=async(n,a)=>{if(n==='pilot_co_report_import_v1'){reads++;return denied?{data:null,error:{code:'42501',message:'Source access denied'}}:{data:{...source(),manifest:null,source_amount:null,currency:null},error:null}}if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};return base(n,a)};const {client}=mount(<COMonthlyReport/>);await screen.findByRole('columnheader',{name:'Harga satuan laporan'});denied=true;await act(()=>client.invalidateQueries({predicate:q=>q.queryKey[4]==='report-import'}));await screen.findByText('Source access denied');expect(screen.queryByRole('table')).toBeNull();expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);const count=reads;await act(async()=>{await Promise.resolve()});expect(reads).toBe(count);expect(s.commands).toHaveLength(0)});

test('historical direct URL downloads only its original private evidence and retains row deltas',async()=>{const {default:COMonthlyReport}=await import('../../../src/pages/athel/co/COMonthlyReport');const {vi}=await import('vitest');const s=store();s.rows[0].sold_quantity='0';s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'2',eligible_set_fingerprint:null,revenue:'0'};const old=id(6),evidence=id(61),filename=`evidence-${evidence}.pdf`,base=s.handle;wire.handler=async(n,a)=>{if(n==='pilot_co_report_import_v1')return {data:{...source(),revision_id:old,effective_revision_id:id(5),manifest:null,source_amount:null,currency:null,source_filename:filename},error:null};if(n==='pilot_co_report_revision_delta_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,report_month:month,revision_id:old,previous_revision_id:null,page:a.p_page,page_size:a.p_page_size,total:'1',rows:[{stock_key_id:id(1001),display_sku:'SKU-1',product_name:'Item 1',before_quantity:null,after_quantity:'0'}]},error:null};if(n==='pilot_co_report_allocations_v1')return {data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:old,generation_id:null,is_effective:false,summary:{quantity:'0',amount:'0'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null};if(n==='pilot_co_evidence_selection_v1')return {data:{version:'1',customer_id:customer,draft_id:null,draft_version:null,revision_id:old,evidence:{id:evidence,version:'2',customer_id:customer,customer_version:'1',draft_id:id(3),draft_version:'1',report_month:month,filename,mime_type:'application/pdf',byte_size:3,state:'finalized',finalized_draft_version:'2'}},error:null};const result=await base(n,a);if(n==='pilot_co_report_rows_v1')result.data.revision_id=old;return result};wire.invoke.mockResolvedValue({data:new Blob(['old']),error:null});const create=vi.fn(()=> 'blob:private-old'),revoke=vi.fn();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create,revokeObjectURL:revoke}));const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});mount(<COMonthlyReport/>,`/athel/co/reports/${customer}/${month}?revision=${old}`);fireEvent.click(await screen.findByRole('button',{name:`Unduh ${filename}`}));await waitFor(()=>expect(revoke).toHaveBeenCalledWith('blob:private-old'));expect(wire.invoke).toHaveBeenCalledWith('co-evidence-download',expect.objectContaining({body:{evidence_id:evidence}}));expect(await screen.findByText('SKU-1 · Item 1: Tidak ada baris → 0')).toBeTruthy();expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_import_v1').every(([,a])=>a.p_revision_id===old)).toBe(true);expect(screen.queryByRole('button',{name:'Edit'})).toBeNull();click.mockRestore()});

test('expanded recorded FIFO/PIC disclosure suppresses cross-unit quantity totals but retains money and individual allocations',async()=>{const {default:COMonthlyReport}=await import('../../../src/pages/athel/co/COMonthlyReport');const {row:reportRow,allocation}=await import('../report-ui-harness');const {row:sourceRow}=await import('../import/reviewFixture');const s=store();s.rows=[reportRow(1,'2'),reportRow(2,'3')];s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'800'};const evidence:any=source();evidence.manifest.input=input({scope:{actorId:id(1),customerId:customer,reportMonth:month,epoch:0},extracted:{...input().extracted,sourceRows:[sourceRow(),sourceRow({id:'r2',unit:'BOX',quantity:{raw:'3',decimal:'3'},amount:{raw:'30',decimal:'30'}})]},mappings:[{...input().mappings[0],stockKeyId:id(1001)},{...input().mappings[0],rowId:'r2',stockKeyId:id(1002),ledgerUnit:'BOX',quantity:'3'}]});evidence.unit_declarations={[id(1001)]:{id:id(70),version:'1',unit:'PCS'},[id(1002)]:{id:id(71),version:'1',unit:'BOX'}};const allocations=[allocation(1,'2','100'),allocation(2,'3','200')].map((a,n)=>({...a,id:id(90+n),stock_key_id:id(1001+n),report_revision_id:id(5),batch_id:id(80+n),delivery_head_id:id(60+n),delivery_revision_id:id(50+n),customer_id:customer}));const base=s.handle;wire.handler=async(n,a)=>n==='pilot_co_report_import_v1'?{data:evidence,error:null}:n==='pilot_co_report_allocations_v1'?{data:{version:'1',as_of:'2026-10-09T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'5',amount:'800'},page:a.p_page,page_size:a.p_page_size,total:'2',rows:allocations},error:null}:base(n,a);mount(<COMonthlyReport/>);await screen.findByRole('columnheader',{name:'Harga CO'});fireEvent.click(screen.getByText('Bukti alokasi FIFO dan PIC asli'));await screen.findByText('Nilai alokasi seluruh laporan: Rp 800');expect(screen.queryByText(/Total seluruh laporan: 5/)).toBeNull();expect(screen.getByText('2 × Rp 100 = Rp 200')).toBeTruthy();expect(screen.getByText('3 × Rp 200 = Rp 600')).toBeTruthy()});
test('F6 posted-only page survives direct refresh and Back/Forward with safe detail context',async()=>{
 const {act}=await import('@testing-library/react');const s=store(),base=s.handle;
 wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:list(a.p_page===2?[listRow({legacy_pending:false})]:Array.from({length:20},(_,i)=>listRow({id:id(100+i),customer_id:id(200+i),report_head_id:id(100+i),legacy_pending:false})),{customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,total:'21'}),error:null}:base(n,a);
 const initial='/athel/co/reports?month=2026-09&status=historical_pending&page=2';const {router}=mount(<COMonthlyReports/>,initial);
 await screen.findByRole('link',{name:'Buka laporan'});
 expect(wire.rpc.mock.calls.some(([n,a])=>n==='pilot_co_reports_page_v2'&&a.p_page===2&&a.p_status==='posted')).toBe(true);
 expect(screen.getByRole('link',{name:'Buka laporan'}).getAttribute('href')).toContain('returnTo=');
 fireEvent.change(screen.getByLabelText('Bulan laporan'),{target:{value:'2026-08'}});
 await waitFor(()=>expect(router.state.location.search).not.toContain('page=2'));
 expect(router.state.location.search).not.toContain('status=');
 await act(()=>router.navigate(-1));expect(router.state.location.search).toContain('page=2');
 await act(()=>router.navigate(1));expect((screen.getByLabelText('Bulan laporan') as HTMLInputElement).value).toBe('2026-08');
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_reports_page_v2').every(([,a])=>a.p_status==='posted')).toBe(true);
});

test('exact recorded revision projects server proof strictly while retaining unresolved human decision',async()=>{
 const {decodeCOReportImport}=await import('../../../src/lib/co/workspaceReads');const {RecordedReportRows}=await import('../../../src/components/co/CORecordedReportTable');const {render}=await import('@testing-library/react');
 const data:any=source();data.manifest.input.mappings=[{...input().mappings[0],stockKeyId:id(1001)}];data.unit_declarations={[id(1001)]:{id:id(70),version:'1',unit:'PCS'}};data.manifest.input.extracted.sourceRows[0].returned={raw:'1',decimal:'1'};data.manifest.input.returns=[{rowId:'r1',state:'unresolved',links:[],stockImpact:'uncertain',note:'Human choice unresolved'}];
 const proof={basis:'prior_committed_exact_coverage',rowId:'r1',priorImportId:id(80),priorReportRevisionId:id(6),priorManifestDigest:'c'.repeat(64),priorValidationDigest:'d'.repeat(64)};data.return_proofs=[proof];
 const parsed=decodeCOReportImport(data,customer,month,id(5));expect(parsed.return_proofs).toEqual([proof]);expect(parsed.manifest!.input.returns[0].state).toBe('unresolved');
 render(<RecordedReportRows rows={[store().rows[0]]} source={parsed} allocations={[]}/>);expect(screen.getByText(/Pilihan manusia belum dicocokkan; cakupan retur terdahulu dibuktikan server/)).toBeTruthy();
 for(const bad of [null,[],[proof,proof],[{...proof,rowId:'unknown'}],[{...proof,extra:true}],[{...proof,priorValidationDigest:'bad'}],[{...proof,basis:'stock_is_sufficient'}]])expect(()=>decodeCOReportImport({...data,return_proofs:bad},customer,month,id(5))).toThrow();
 const linked=structuredClone(data);linked.manifest.input.returns[0].state='linked';expect(()=>decodeCOReportImport(linked,customer,month,id(5))).toThrow();
 const ordinary=source();expect(decodeCOReportImport(ordinary,customer,month,id(5))).not.toHaveProperty('return_proofs');
});

test('monthly list has concise Actions buttons and one upload instruction above filters', async () => {
    const s=store(), base=s.handle;
    wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:list(undefined,{customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status}),error:null}:base(n,a);
    mount(<COMonthlyReports/>, '/athel/co/reports');
    await screen.findByRole('link', {name:'Buka laporan'});
    expect(screen.getByRole('columnheader', {name:'Actions'})).toBeTruthy();
    const open=screen.getByRole('link', {name:'Buka laporan'});
    expect(open.textContent).toBe('Buka');
    expect(open.className).toContain('ui-action--secondary');
    expect(screen.queryByRole('link', {name:'Periksa pekerjaan lama'})).toBeNull();
    expect(open.parentElement?.className).toContain('flex-nowrap');
    const hints=screen.getAllByText('Pilih toko dan periode untuk mengunggah laporan.');
    expect(hints).toHaveLength(1);
    expect(hints[0].compareDocumentPosition(screen.getByLabelText('Toko laporan')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Cari toko dan pilih bulan laporan. Tidak perlu memilih nomor CO.')).toBeNull();
    expect(screen.queryByText(/Cakupan daftar:/)).toBeNull();
});

test.each(['all','historical_pending','posted'])('normal list always requests posted server-side even for old status=%s links', async status => {
    const s=store(),base=s.handle;
    wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:list([],{customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,total:'0'}),error:null}:base(n,a);
    mount(<COMonthlyReports/>, `/athel/co/reports?status=${status}`);
    await screen.findByText('Belum ada laporan sesuai filter.');
    expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_reports_page_v2').every(([,a])=>a.p_status==='posted')).toBe(true);
    expect(screen.queryByLabelText('Status laporan')).toBeNull();
    expect(screen.queryByRole('link',{name:'Periksa pekerjaan lama'})).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test.each([null,'0','7'])('unrecorded upload exposes saved-input inspection only for actual entered quantity %s', async qty => {
    const {default:Detail}=await import('../../../src/pages/athel/co/COMonthlyReport');
    const s=store();s.rows[0].sold_quantity=qty;
    mount(<Detail/>);
    await screen.findByLabelText('Pilih PDF atau XLSX');
    const link=screen.queryByRole('link',{name:'Periksa isian tersimpan'});
    if(qty===null)expect(link).toBeNull();
    else expect(link?.getAttribute('href')).toContain('recovery=legacy');
    expect(s.commands).toHaveLength(0);
});
test('unrecorded upload exposes saved source notes without falsely claiming a recorded report', async () => {
    const {default:Detail}=await import('../../../src/pages/athel/co/COMonthlyReport');
    const s=store();s.metadata.notes='Operator entered context';
    mount(<Detail/>);
    await screen.findByRole('link',{name:'Periksa isian tersimpan'});
    expect(screen.queryByRole('button',{name:'Edit'})).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test('F6 detail return context accepts only exact in-app list filters, not external destinations',async()=>{const {safeReportReturnTo}=await import('../../../src/pages/athel/co/COMonthlyReport');const valid=`/athel/co/reports?customer=${customer}&month=2026-09&status=posted&page=2`;expect(safeReportReturnTo(valid,customer)).toBe(valid);for(const invalid of ['https://evil.invalid','//evil.invalid','/athel/co/reports/other?page=2','/athel/co/reports?redirect=https://evil.invalid','/athel/co/reports?page=2#outside'])expect(safeReportReturnTo(invalid,customer)).toBe(`/athel/co/reports?customer=${customer}`)});

test('F6 composed list → detail → breadcrumb restores exact customer/month/status/page',async()=>{const {useLocation}=await import('react-router-dom');const {default:Detail}=await import('../../../src/pages/athel/co/COMonthlyReport');function Entry(){return useLocation().pathname==='/athel/co/reports'?<COMonthlyReports/>:<Detail/>}const s=store(),base=s.handle;wire.handler=async(n,a)=>n==='pilot_co_reports_page_v2'?{data:list([listRow({legacy_pending:false})],{customer_id:a.p_customer_id,report_month:a.p_month,status:a.p_status,page:a.p_page,total:'21'}),error:null}:base(n,a);const path=`/athel/co/reports?customer=${customer}&month=2026-09&status=posted&page=2`;const {router}=mount(<Entry/>,path);fireEvent.click(await screen.findByRole('link',{name:'Buka laporan'}));const back=await screen.findByRole('link',{name:'← Laporan bulanan'});expect(back.getAttribute('href')).toBe(path);fireEvent.click(back);await screen.findByRole('link',{name:'Buka laporan'});expect(router.state.location.pathname+router.state.location.search).toBe(path);expect(screen.queryByLabelText('Status laporan')).toBeNull()});

test.each(['consumed','source-bound','blank-notes'])('upload does not expose ordinary saved-input recovery for %s preparation', async state => {
    const {default:Detail}=await import('../../../src/pages/athel/co/COMonthlyReport');
    const s=store();
    if(state==='blank-notes') s.metadata.notes='   ';
    else s.rows[0].sold_quantity='7';
    if(state==='consumed') s.metadata.consumed=true;
    if(state==='source-bound') {
        s.metadata.source_context_link={operation:'post_sj',target_id:null,draft_id:id(90),original_revision_id:null,expected_source_version:null,expected_co_version:'1',expected_customer_version:'1',expected_draft_version:'1'};
        s.metadata.source_context_fingerprint='c'.repeat(64);
    }
    mount(<Detail/>);
    await screen.findByRole('heading',{name:'Store A · September 2026'});
    expect(screen.queryByRole('link',{name:'Periksa isian tersimpan'})).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test('recorded report retains contextual access to unconsumed saved correction values without a local request token', async () => {
    const {default:Detail}=await import('../../../src/pages/athel/co/COMonthlyReport');
    const s=store();s.rows[0].sold_quantity='7';s.metadata.notes='Unfinished correction notes';
    s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null};
    mount(<Detail/>);
    const link=await screen.findByRole('link',{name:'Periksa isian tersimpan'});
    expect(link.getAttribute('href')).toContain('recovery=legacy');
    expect(screen.getByRole('button',{name:'Edit'})).toBeTruthy();
    expect(screen.queryByText('Ada hasil perintah yang perlu diperiksa')).toBeNull();
    expect(s.metadata.notes).toBe('Unfinished correction notes');
    expect(s.commands).toHaveLength(0);
});
