import React from 'react';
import {act,fireEvent,screen,waitFor} from '@testing-library/react';
import {beforeAll,expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {store,mount,wire,customer,id} from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import * as catalog from '../../src/lib/co/catalog';
import {extractXlsx} from '../../src/lib/co/import/xlsx';
import {manifestDigest} from '../../src/lib/co/import/manifest';
const month='2026-10-01',path=`/athel/co/reports/${customer}/${month}`;
let extracted:any;
beforeAll(async()=>{extracted=await extractXlsx(new Uint8Array(readFileSync('tests/co/fixtures/accepted-monthly-20261029.xlsx')),'30f1236ea3c9a83314154423ea4e98146a1a579d790888d4c977a97352581b6a',new AbortController().signal)});
function fixture(posted=false){const s=store(1,month);s.rows[0].sold_quantity='7';if(posted)s.effective={...s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',eligible_set_fingerprint:null,revenue:'70000'};const base=s.handle;s.handle=async(n:string,a:any)=>{if(n!=='pilot_co_report_allocations_v1')return base(n,a);if(s.fail){const failure=await s.fail(n,a);if(failure)return failure;}if(a.p_customer_id!==customer||a.p_month!==month||a.p_revision_id!==id(5)||a.p_expected_customer_version!=='1')throw new Error('Synthetic allocation scope mismatch');return {data:{version:'1',as_of:'2026-10-29T00:00:00Z',customer_id:customer,customer_version:'1',report_month:month,revision_id:id(5),generation_id:null,is_effective:true,summary:{quantity:'0',amount:'0.00'},page:a.p_page,page_size:a.p_page_size,total:'0',rows:[]},error:null}};wire.handler=s.handle;return s;}
test.each(['08006','42501'])('monthly header pending then %s does not expose private rows, zero or writes',async code=>{
 const s=fixture();s.metadata.notes='PRIVATE LOADING NOTE';let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_report_v1'){await pending;return {data:null,error:{code,message:'Monthly source unavailable'}}}return null};
 mount(<COMonthlyReport/>,path,true);await screen.findByText('Memuat laporan…');
 expect(screen.queryByText('PRIVATE LOADING NOTE')).toBeNull();expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();
 await act(async()=>release());await screen.findByText('Monthly source unavailable');
 expect(screen.queryByText('Memuat laporan…')).toBeNull();expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByText('PRIVATE LOADING NOTE')).toBeNull();expect(s.commands).toHaveLength(0);
});
test.each(['absent','error'])('monthly customer-name pending then %s cannot invent an identity or open an upload',async outcome=>{
 const s=fixture();s.draft=false;let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 vi.spyOn(catalog,'fetchCOCustomers').mockImplementation(async()=>{await pending;if(outcome==='error')throw new Error('Permitted catalogue unavailable');return []});
 mount(<COMonthlyReport/>,path);await screen.findByText('Memuat identitas toko…');
 expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByText('Store A')).toBeNull();
 await act(async()=>release());await screen.findByText(outcome==='error'?'Permitted catalogue unavailable':'Nama toko belum tersedia pada katalog yang diizinkan.');
 expect(screen.queryByText('Memuat identitas toko…')).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(s.commands).toHaveLength(0);
});
async function installOriginal(s:any){
 const input={scope:{actorId:id(1),customerId:customer,reportMonth:month,epoch:0},extracted:structuredClone(extracted),mappings:extracted.sourceRows.map((r:any)=>({rowId:r.id,stockKeyId:id(1001),ledgerUnit:'test unit',quantity:'1',conversion:null,included:true,exclusionReason:null,confirmed:true})),returns:extracted.sourceRows.map((r:any)=>({rowId:r.id,state:'none',links:[],stockImpact:'clear',note:'Source explicitly reports zero returns'})),includedSectionIds:extracted.sections.map((s:any)=>s.id),completenessConfirmed:true,omittedZeroStockKeyIds:[],currency:'IDR',reason:null};
 const manifest:any={schemaVersion:1,evidenceId:id(90),input,digest:'0'.repeat(64)};manifest.digest=await manifestDigest(manifest);
 const base=wire.handler;wire.handler=async(name:string,args:any)=>{const response=await base(name,args);if(name==='pilot_co_report_import_v1'&&!response.error)return {data:{...response.data,manifest,source_amount:'10000.00',currency:'IDR',source_filename:'TEST_ONLY_MONTHLY_CO_20261029.xlsx',unit_declarations:{[id(1001)]:{id:id(77),version:'1',unit:'test unit'}}},error:null};return response};return manifest;
}
test.each(['source','quantities'])('Edit waits for immutable %s and never silently seeds a mismatching original',async waiting=>{
 const s=fixture(true);await installOriginal(s);let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string,a:any)=>{if(waiting==='source'&&n==='pilot_co_report_import_v1'||waiting==='quantities'&&n==='pilot_co_report_rows_v1'&&a.p_view==='revision')await pending;return null};
 mount(<COMonthlyReport/>,path);fireEvent.click(await screen.findByRole('button',{name:'Edit',exact:true}));
 await screen.findByText('Memuat nilai awal Edit…');expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(s.commands).toHaveLength(0);
 await act(async()=>release());await screen.findByText('Keputusan sumber tidak sama dengan jumlah laporan tercatat; gunakan sumber baru.');
 expect(screen.queryByText('Memuat nilai awal Edit…')).toBeNull();expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();
 expect(screen.getByRole('button',{name:'Gunakan sumber baru untuk Edit'})).toBeTruthy();expect(s.commands).toHaveLength(0);
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_import_v1').every(([,a])=>a.p_revision_id===id(5)&&a.p_customer_id===customer)).toBe(true);
});
test('explicit legacy saved-input route distinguishes pending/error from a successful blank or zero draft',async()=>{
 const s=fixture();s.metadata.notes='Authorized saved input';let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string,a:any)=>{if(n==='pilot_co_report_rows_v1'&&a.p_view==='draft'){await pending;return {data:null,error:{code:'08006',message:'Saved draft rows unavailable'}}}return null};
 mount(<COMonthlyReport/>,`${path}?recovery=legacy`);await screen.findByText('Memuat isian tersimpan…');
 expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByText('Belum diisi',{exact:true})).toBeNull();expect(s.commands).toHaveLength(0);
 await act(async()=>release());await screen.findByText('Saved draft rows unavailable');
 expect(screen.queryByText('Memuat isian tersimpan…')).toBeNull();expect(screen.queryByRole('table')).toBeNull();expect(s.commands).toHaveLength(0);
 expect(wire.rpc.mock.calls.filter(([n])=>n==='pilot_co_report_rows_v1').every(([,a])=>a.p_view==='draft'&&a.p_expected_draft_version==='1'&&a.p_expected_customer_version==='1')).toBe(true);
});
test('recorded history pending/error is distinct from successful empty revision history',async()=>{
 const s=fixture(true);let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_report_history_v1'){await pending;return {data:null,error:{code:'08006',message:'Original history unavailable'}}}return null};
 mount(<COMonthlyReport/>,path);fireEvent.click(await screen.findByText('Riwayat perubahan',{exact:true}));
 await screen.findByText('Memuat riwayat perubahan…');expect(screen.queryByText('Buka bukti dan perubahan baris')).toBeNull();
 await act(async()=>release());await screen.findByText('Original history unavailable');
 expect(screen.queryByText('Memuat riwayat perubahan…')).toBeNull();expect(screen.queryByText('Buka bukti dan perubahan baris')).toBeNull();expect(s.commands).toHaveLength(0);
});
test('departed monthly actor cannot expose a late header or start upload work',async()=>{
 const s=fixture();s.draft=false;let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_report_v1')await pending;return null};
 const {router}=mount(<COMonthlyReport/>,path);await screen.findByText('Memuat laporan…');
 wire.actor=false;await act(async()=>{await router.navigate(`${path}?actor=gone`)});await act(async()=>release());
 expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByText(/Store A ·/)).toBeNull();expect(screen.queryByRole('table')).toBeNull();expect(s.commands).toHaveLength(0);
});
test.each(['08006','42501'])('retained monthly header %s never leaves a new Edit enabled',async code=>{
 const s=fixture(true);const {client}=mount(<COMonthlyReport/>,path);
 const edit=await screen.findByRole('button',{name:'Edit',exact:true});await screen.findByRole('table');expect((edit as HTMLButtonElement).disabled).toBe(false);
 s.fail=(n:string)=>n==='pilot_co_report_v1'?{data:null,error:{code,message:'Header refresh unavailable'}}:null;
 await act(async()=>{await client.invalidateQueries()});await screen.findAllByText('Header refresh unavailable');
 if(code==='42501'){expect(screen.queryByRole('button',{name:'Edit',exact:true})).toBeNull();expect(screen.queryByRole('table')).toBeNull();}
 else{expect((screen.getByRole('button',{name:'Edit',exact:true}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('table')).toBeTruthy();}
 expect(s.commands).toHaveLength(0);
});
test('immutable Edit source transport error is not a successful empty seed or permission to replace source',async()=>{
 const s=fixture(true);let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
 s.fail=async(n:string)=>{if(n==='pilot_co_report_import_v1'){await pending;return {data:null,error:{code:'08006',message:'Original source temporarily unavailable'}}}return null};
 mount(<COMonthlyReport/>,path);fireEvent.click(await screen.findByRole('button',{name:'Edit',exact:true}));await screen.findByText('Memuat nilai awal Edit…');
 await act(async()=>release());await screen.findAllByText('Original source temporarily unavailable');expect(screen.queryByText('Memuat nilai awal Edit…')).toBeNull();
 expect(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();expect(screen.queryByRole('button',{name:'Gunakan sumber baru untuk Edit'})).toBeNull();expect(s.commands).toHaveLength(0);
});
