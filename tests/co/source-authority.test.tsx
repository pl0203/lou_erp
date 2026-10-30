import { productionImportFixture } from './import-production-ports-harness';
import React, { useState } from 'react';
import { expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { customer, draftId, fingerprint, id, month, mount, store, wire } from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COAllocationDetails from '../../src/components/co/COAllocationDetails';
import COSourceBoundary from '../../src/components/co/COSourceBoundary';
import { fetchCOReport, previewCOOperation } from '../../src/lib/co/rpc';
import { reportBinding } from '../../src/components/co/COReportWorkspace';
import { coKeys } from '../../src/lib/co/queryKeys';

async function click(name: string) {
 const button=await screen.findByRole('button',{name,exact:true});
 await waitFor(()=>expect(button.matches(':disabled')).toBe(false));fireEvent.click(button);
}
const privateCache=(client:ReturnType<typeof mount>['client'])=>client.getQueriesData({queryKey:coKeys.identity({actorId:id(1),role:'co_admin'})}).filter(([,data])=>data!==undefined);
async function visibleUpload(){
 const f=await productionImportFixture();f.state.incomplete=false;const mounted=f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'PRIVATE MONTHLY NOTE'}});
 expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');
 expect(screen.getByDisplayValue('PRIVATE MONTHLY NOTE')).toBeTruthy();
 expect(screen.getAllByText('TEST ONLY MONTHLY QA').length).toBeGreaterThan(0);
 return {f,...mounted};
}
function expectSourceGone(){
 expect(screen.queryByDisplayValue('PRIVATE MONTHLY NOTE')).toBeNull();
 expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();
 expect(screen.queryAllByText('TEST ONLY MONTHLY QA')).toHaveLength(0);
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
}
test.each(['42501','08006'])('current upload child impact %s clears only confirmed denied source and cannot bypass root retry',async code=>{
 const {f,client}=await visibleUpload();const base=wire.handler;
 let fail=true,holdRoot=false,release!:()=>void,rootEntered=false;
 const rootGate=new Promise<void>(r=>release=r);
 wire.handler=async(n:string,a:any)=>{
  if(n==='pilot_co_report_v1'&&holdRoot){rootEntered=true;await rootGate;}
  // Let the real transport fixture validate every immutable impact binding first.
  const result=await base(n,a);
  return n==='pilot_co_import_impacts_v1'&&a.p_kind==='stock'&&fail?{data:null,error:{code,message:'Import child denied or unavailable'}}:result;
 };
 await click('Tinjau pencatatan');await screen.findByRole('button',{name:'Catat penjualan'});
 await click('Stok (0)');
 if(code==='42501')await waitFor(expectSourceGone);else await screen.findAllByText('Import child denied or unavailable');
 const calls=()=>wire.rpc.mock.calls.filter(([n]:any)=>n==='pilot_co_import_impacts_v1');
 const stock=calls().find(([,a]:any)=>a.p_kind==='stock')![1];
 expect(stock).toMatchObject({p_binding:{importId:id(88),importVersion:'1',customerVersion:'1',draftId,draftVersion:'4'},p_preview_fingerprint:fingerprint,p_acknowledged_reopen_orders:[]});
 const writes=f.writes.length;
 if(code==='42501'){
  expectSourceGone();
  expect.soft(screen.queryByRole('heading',{name:/Store A/})).toBeNull();
  expect.soft(screen.queryByLabelText('Pilih PDF atau XLSX')).toBeNull();
  expect(f.writes).toHaveLength(writes);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);
  expect(privateCache(client)).toEqual([]);
  const count=calls().length;await act(async()=>{await client.invalidateQueries({queryKey:['co']});});expect(calls()).toHaveLength(count);
  holdRoot=true;await click('Coba lagi');await waitFor(()=>expect(rootEntered).toBe(true));
  expectSourceGone();expect(calls()).toHaveLength(count);expect(screen.queryByRole('button',{name:'Coba lagi'})).toBeNull();
  fail=false;await act(async()=>release());await screen.findByLabelText('Pilih PDF atau XLSX');
  expect(screen.queryByDisplayValue('PRIVATE MONTHLY NOTE')).toBeNull();expect(calls()).toHaveLength(count);
 }else{
  expect(screen.getByDisplayValue('PRIVATE MONTHLY NOTE')).toBeTruthy();
  expect((screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)') as HTMLInputElement).value).toBe('1');
  expect(screen.getByRole('button',{name:'Catat penjualan'}).matches(':disabled')).toBe(true);
  fail=false;await click('Coba lagi');await waitFor(()=>expect(screen.getByRole('button',{name:'Catat penjualan'}).matches(':disabled')).toBe(false));
  expect(calls().at(-1)![1]).toEqual(stock);
 }
 expect(f.writes).toHaveLength(writes);expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);expect(f.s.effective).toBeNull();
});
test('historical revision row denial clears the whole monthly source', async () => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.metadata.notes = 'PRIVATE HISTORY OWNER';
    s.fail = (n: string, a: any) => n === 'pilot_co_report_rows_v1' && a.p_view === 'revision'
        ? { data: null, error: { code: '42501', message: 'Historical revision denied' } } : null;
    mount(<COMonthlyReport />, `/athel/co/reports/${customer}/${month}?revision=${id(9)}`);
    await screen.findByText('Historical revision denied');
    expect(screen.queryByDisplayValue('PRIVATE HISTORY OWNER')).toBeNull();
    expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
});

test('authoritative profile revocation after visible upload source prevents evidence preparation and clears private data',async()=>{
 const {f,client}=await visibleUpload();const before=f.writes.length;
 f.s.fail=(n:string)=>n==='pilot_my_profile'?{data:[],error:null}:null;
 await click('Tinjau pencatatan');await screen.findByRole('alert');await waitFor(expectSourceGone);
 expect(privateCache(client)).toEqual([]);expect(f.writes).toHaveLength(before);expect(f.state.prepareCount).toBe(0);expect(f.s.effective).toBeNull();
});

// Explicit surviving component contract, not a claim that upload uses the retired
// initial manual draft/preview-allocation route. Real reader and boundary, no RPC spy replacement.
test.each(['42501','08006'])('preview allocation component unit preserves endpoint authority contract for %s',async code=>{
 const s=store();s.rows[0].sold_quantity='0';
 let holdRoot=false,rootEntered=false,release!:()=>void;const rootGate=new Promise<void>(r=>release=r);
 const payload=reportBinding(s.header());const header=await previewCOOperation('post_report',payload);
 const snapshot={operation:'post_report' as const,payload,header:header as any};
 function Owner(){const [open,setOpen]=useState(false);return <COSourceBoundary source="allocation-unit" check={o=>fetchCOReport(customer,month,null,o)}><input aria-label="Terjual Item 1" defaultValue="0"/><input aria-label="Private unit note" defaultValue="PRIVATE ALLOCATION NOTE"/><button onClick={()=>setOpen(true)}>Alokasi Item 1</button>{open&&<COAllocationDetails customerId={customer} month={month} customerVersion="1" snapshot={snapshot} stockKeyId={id(1001)}/>}</COSourceBoundary>}
 const {client}=mount(<Owner/>);expect(screen.getByDisplayValue('PRIVATE ALLOCATION NOTE')).toBeTruthy();
 s.fail=async(n:string)=>{if(n==='pilot_co_report_v1'&&holdRoot){rootEntered=true;await rootGate;}return n==='pilot_co_preview_allocations_v1'?{data:null,error:{code,message:'Allocation read failed'}}:null;};
 await click('Alokasi Item 1');await screen.findAllByText('Allocation read failed');
 const reads=()=>wire.rpc.mock.calls.filter(([n]:any)=>n==='pilot_co_preview_allocations_v1');
 for(const [,args] of reads())expect(args).toMatchObject({p_operation:'post_report',p_payload:payload,p_preview_fingerprint:fingerprint,p_report_month:month,p_stock_key_id:id(1001)});
 expect(reads().length).toBeGreaterThan(0);
 if(code==='42501'){
  expect(screen.queryByDisplayValue('PRIVATE ALLOCATION NOTE')).toBeNull();expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();expect(privateCache(client)).toEqual([]);
  const count=reads().length;await act(async()=>{await client.invalidateQueries({queryKey:['co']});});expect(reads()).toHaveLength(count);
  holdRoot=true;await click('Coba lagi');await waitFor(()=>expect(rootEntered).toBe(true));
  expect(screen.queryByDisplayValue('PRIVATE ALLOCATION NOTE')).toBeNull();expect(reads()).toHaveLength(count);expect(screen.queryByRole('button',{name:'Coba lagi'})).toBeNull();
  s.fail=null;await act(async()=>release());await screen.findByDisplayValue('PRIVATE ALLOCATION NOTE');
  await screen.findByText('Pendapatan SKU: Rp 0 · 0 teralokasi');
  for(const [,args] of reads())expect(args).toMatchObject({p_payload:payload,p_preview_fingerprint:fingerprint});
 }else{
  expect(screen.getByDisplayValue('PRIVATE ALLOCATION NOTE')).toBeTruthy();expect(screen.getByLabelText('Terjual Item 1')).toBeTruthy();
  expect(screen.getAllByRole('button',{name:'Coba lagi'}).length).toBeGreaterThan(0);
 }
 expect(s.commands).toHaveLength(0);
});

// The transport intentionally ignores abortSignal, so this proves stale completion
// isolation rather than assuming network cancellation prevents the late response.
test('late upload impact denial cannot revoke a replacement source owner',async()=>{
 const {f,router,client}=await visibleUpload();const base=wire.handler;let entered=false,release!:()=>void;const gate=new Promise<void>(r=>release=r);
 wire.handler=async(n:string,a:any)=>{const result=await base(n,a);if(n==='pilot_co_import_impacts_v1'&&a.p_kind==='stock'){entered=true;await gate;return {data:null,error:{code:'42501',message:'Late departed denial'}};}return result;};
 await click('Tinjau pencatatan');await screen.findByRole('button',{name:'Catat penjualan'});await click('Stok (0)');await waitFor(()=>expect(entered).toBe(true));
 const writes=f.writes.length;
 await act(async()=>{await router.navigate('/outside');});
 // Unsaved navigation requires the real owner confirmation, never force-unmount.
 if(screen.queryByRole('button',{name:'Buang perubahan'}))await click('Buang perubahan');
 await screen.findByText('Destination');
 await act(async()=>{await router.navigate(`/athel/co/reports/${customer}/2026-10-01`);});await screen.findByLabelText('Pilih PDF atau XLSX');
 await act(async()=>release());
 expect(screen.getByLabelText('Pilih PDF atau XLSX')).toBeTruthy();expect(screen.getByRole('heading',{name:/Store A/})).toBeTruthy();expect(screen.queryByText('Late departed denial')).toBeNull();expect(privateCache(client).length).toBeGreaterThan(0);expect(f.writes).toHaveLength(writes);expect(f.s.effective).toBeNull();
});
