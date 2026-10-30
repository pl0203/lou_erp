// Component/controller tests with explicit external ports. NOT full RPC or browser acceptance.
import React, { useSyncExternalStore } from 'react';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { transferableAbortController } from 'node:util';
import { extractXlsx } from '../../src/lib/co/import/xlsx';
import { validateReview } from '../../src/lib/co/import/review';
import type { ExtractedReport } from '../../src/lib/co/import/types';
import { createImportReviewController, type ImportReviewPorts } from '../../src/components/co/useCOImportReview';
import COReportUpload from '../../src/components/co/COReportUpload';
const wiring=vi.hoisted(()=>({controller:null as any}));
vi.mock('../../src/lib/AuthContext',()=>({useBeforeSignOut:()=>{},useAuth:()=>({})}));
vi.mock('../../src/lib/supabase',()=>({supabase:{}}));
vi.mock('../../src/components/co/useCOImportReview',async original=>{
 const module=await original<any>();return {...module,useCOImportReview:()=>{
  const c=wiring.controller,state=useSyncExternalStore(c.subscribe,c.getSnapshot,c.getSnapshot);
  return {...c,state,dirty:!!state.file||!!state.input,unknown:state.phase==='unknown'};
 }};
});
// Impact-read readiness is an external capability here; server paging/identity checks are NOT tested.
vi.mock('../../src/components/co/COChangePreview',()=>({default:({onReadyChange}:any)=>{
 React.useEffect(()=>onReadyChange(true),[onReadyChange]);return <p>Test port: checked server impact pages</p>;
}}));
const scope={actorId:'00000000-0000-0000-0000-000000000001',customerId:'c080573d-ebcc-4dda-964e-40c605cd2290',reportMonth:'2026-10-01',epoch:0};
const stockKey='dd7c3049-8e6c-4cb3-949a-6a5f81519cc5',sha='30f1236ea3c9a83314154423ea4e98146a1a579d790888d4c977a97352581b6a';
let extracted:ExtractedReport, bytes:Buffer, live:boolean, ports:ImportReviewPorts, router:ReturnType<typeof createMemoryRouter>;
const binding={importId:'00000000-0000-0000-0000-000000000004',importVersion:'1',customerVersion:'2',draftId:'00000000-0000-0000-0000-000000000003',draftVersion:'3',manifestDigest:'a'.repeat(64)};
const receipt={id:'00000000-0000-0000-0000-000000000005',operation:'post_report' as const,version:'1',customer_id:scope.customerId,customer_version:'3'};
beforeAll(async()=>{
 bytes=readFileSync('tests/co/fixtures/accepted-monthly-20261029.xlsx');
 extracted=await extractXlsx(new Uint8Array(bytes),sha,transferableAbortController().signal);
 expect(extracted.sourceRows).toHaveLength(1);
});
beforeEach(()=>{
 vi.stubGlobal('AbortController',class{constructor(){return transferableAbortController()}});
 live=true;
 const eligible=[{stockKeyId:stockKey,unit:'test unit',available:'1'}];
 ports={isCurrent:()=>live,hasUnresolved:()=>false,
  // Extraction already ran above with exact fixture; no parser bypass in that check.
  extract:vi.fn(async()=>structuredClone(extracted)),
  loadContext:vi.fn(async()=>({scope,context:{customerVersion:'2'},selection:{},rows:[{stock_key_id:stockKey,display_sku:'TEST-ONLY-PRODUCT-A',product_name:'Synthetic product',eligible_quantity:'1'}],units:[{stockKeyId:stockKey,declaration:{unit:'test unit'}}]}) as any),
  prepare:vi.fn(async input=>{if(!validateReview(input,eligible).canConfirm)throw new Error('Unconfirmed source');return binding}),
  preview:vi.fn(async()=>({binding,previewFingerprint:'b'.repeat(64),requiredReopenOrders:[],issues:[],existingPreview:{operation:'post_report',can_post:true,before:{revenue:'0'},after:{revenue:'12000'},counts:{report:'1',stock:'1',credit:'1'}}}) as any),
  commit:vi.fn(async()=>receipt),acceptReceipt:vi.fn(async()=>{}),
  recover:vi.fn(async()=>({status:'unknown'} as const)),declareUnit:vi.fn(async()=>{}),acknowledgeSupporting:vi.fn(async()=>{}),abandon:vi.fn(async()=>{}),
 };
 wiring.controller=createImportReviewController(scope,ports);
});
afterEach(()=>{cleanup();router?.dispose();wiring.controller?.dispose();vi.unstubAllGlobals()});
async function load(){
 router=createMemoryRouter([{path:'/',element:<COReportUpload scope={scope} customerName="Dummy Customer B"/>}],{initialEntries:['/']});
 render(<RouterProvider router={router}/>);
 fireEvent.change(screen.getByLabelText('Pilih PDF atau XLSX'),{target:{files:[new File([bytes],'TEST_ONLY_MONTHLY_CO_20261029.xlsx')]}});
 await screen.findByText('Pemetaan memakai konteks pelanggan yang terikat versi.');
}
async function decide(){
 fireEvent.click(screen.getByRole('button',{name:'Pilih SKU',exact:true}));
 fireEvent.change(screen.getByLabelText('SKU Padiwan'),{target:{value:stockKey}});
 fireEvent.change(screen.getByLabelText('Jumlah terjual (tidak dikurangi retur)'),{target:{value:'1'}});
 fireEvent.click(screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini'));
 fireEvent.change(screen.getByLabelText('Mata uang sumber'),{target:{value:'IDR'}});
 fireEvent.click(screen.getByLabelText(/Semua barang dan bagian sumber sudah diperiksa/));
}
test('actual upload owner blocks unconfirmed source, then records once only after canonical acceptance port resolves',async()=>{
 let accept!:()=>void;vi.mocked(ports.acceptReceipt).mockImplementation(()=>new Promise<void>(r=>{accept=r}));
 await load();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 expect(ports.prepare).not.toHaveBeenCalled();expect(ports.commit).not.toHaveBeenCalled();
 await decide();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 const post=await screen.findByRole('button',{name:'Catat penjualan'});
 await waitFor(()=>expect((post as HTMLButtonElement).disabled).toBe(false));
 expect(screen.getByText(/harga sumber tidak mengganti harga CO/)).toBeTruthy();
 expect(screen.getByText('12000')).toBeTruthy(); // independent server port value, not source10000
 const input=vi.mocked(ports.prepare).mock.calls[0][0];
 expect(input.mappings[0]).toMatchObject({quantity:'1',stockKeyId:stockKey,confirmed:true,ledgerUnit:'test unit'});
 expect(input.returns).toEqual([]);expect(input.omittedZeroStockKeyIds).toEqual([]);
 fireEvent.click(post);fireEvent.click(post);
 await waitFor(()=>expect(ports.acceptReceipt).toHaveBeenCalledTimes(1));
 expect(ports.commit).toHaveBeenCalledTimes(1);
 expect(vi.mocked(ports.commit).mock.calls[0][0]).toEqual({binding,previewFingerprint:'b'.repeat(64),mode:'post',reason:null,acknowledgedReopenOrders:[]});
 expect(screen.queryByText('Penjualan sudah dicatat dan hasil kanonis sudah diperiksa.')).toBeNull();
 await act(async()=>accept());
 expect(await screen.findByText('Penjualan sudah dicatat dan hasil kanonis sudah diperiksa.')).toBeTruthy();
});
test('lost controller actor-currentness prevents recording an already displayed preview',async()=>{
 await load();await decide();fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));
 const post=await screen.findByRole('button',{name:'Catat penjualan'});
 await waitFor(()=>expect((post as HTMLButtonElement).disabled).toBe(false));
 live=false;fireEvent.click(post);
 expect(ports.commit).not.toHaveBeenCalled();expect(ports.acceptReceipt).not.toHaveBeenCalled();
});
