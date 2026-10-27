import {test,expect} from 'vitest';
import {act,fireEvent,screen,waitFor,within} from '@testing-library/react';
import {integratedServer,beginIntegrated} from './import-acceptance-harness';
import {wire,id,customer,row} from '../report-ui-harness';

async function omittedUnitFlow(refusal?:'PT409'|'42501') {
 const f=integratedServer();f.s.rows.push(row(2));let declared=false;const unitRequests:any[]=[];
 const receipt={id:id(71),operation:'declare_stock_key_unit',version:'1',customer_id:customer,customer_version:'2'};
 wire.handler=async(n,a)=>{
  if(n==='pilot_co_stock_key_units_v1')return {data:{customerVersion:f.s.cv,rows:a.p_stock_key_ids.map((key:string)=>({customerId:customer,stockKeyId:key,state:key===id(1002)&&!declared?'unknown':'declared',declaration:key===id(1002)&&!declared?null:{id:key===id(1001)?id(70):id(71),version:'1',unit:key===id(1001)?'PCS':'DOS',declaredBy:id(1),declaredAt:'2026-10-26T00:00:00Z',reason:'Warehouse evidence'}}))},error:null};
  if(n==='pilot_co_declare_stock_key_unit_v1'){unitRequests.push(a);if(refusal)return {data:null,error:{code:refusal,message:'Declaration authority/version refused'}};declared=true;f.s.cv='2';return {data:receipt,error:null}};
  if(n==='pilot_reconcile_co_unit_v1')return {data:{status:'committed',operation:'declare_stock_key_unit',receipt},error:null};
  return f.server(n,a);
 };
 const view=await beginIntegrated(f,'2');
 const group=screen.getByRole('group',{name:'Nyatakan satuan SKU-2 · Item 2'});
 fireEvent.change(within(group).getByLabelText('Satuan buku baru'),{target:{value:'DOS'}});
 fireEvent.change(within(group).getByLabelText('Dasar pernyataan satuan'),{target:{value:'Warehouse pack evidence'}});
 fireEvent.click(within(group).getByLabelText('Saya memastikan satuan buku ini'));
 fireEvent.click(within(group).getByRole('button',{name:'Nyatakan satuan'}));
 await waitFor(()=>expect(unitRequests).toHaveLength(1));
 expect(unitRequests[0].p_payload).toMatchObject({stock_key_id:id(1002),expected_customer_version:'1',expected_unit_version:null,unit:'DOS',reason:'Warehouse pack evidence',confirmed:true});
 return {...view,unitRequests};
}
test('F2 composed A mapped / B missing unit → explicit B declaration → zero → checked review',async()=>{
 const {f}=await omittedUnitFlow();await screen.findByText('Satuan buku: DOS');
 expect((screen.getByLabelText(/Nol penjualan: SKU-2/) as HTMLInputElement).checked).toBe(false);
 fireEvent.click(screen.getByLabelText(/Nol penjualan: SKU-2/));
 const mapped=screen.getByLabelText('Saya sudah memeriksa pemetaan dan jumlah ini') as HTMLInputElement;if(!mapped.checked)fireEvent.click(mapped);
 const complete=screen.getByLabelText(/Semua barang dan bagian sumber/) as HTMLInputElement;if(!complete.checked)fireEvent.click(complete);
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await screen.findByText('Konfirmasi pencatatan');
 const prepare=f.requests.find(r=>r.n==='pilot_co_import_prepare_v1')!;
 expect(prepare.a.p_payload.expected_customer_version).toBe('2');
 expect(prepare.a.p_payload.manifest.input.mappings[0].stockKeyId).toBe(id(1001));
 expect(prepare.a.p_payload.manifest.input.omittedZeroStockKeyIds).toEqual([id(1002)]);
 expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});
test.each(['PT409','42501'] as const)('F2 omitted declaration %s refusal cannot retain preview or grant readiness',async refusal=>{
 const {f}=await omittedUnitFlow(refusal);if(refusal==='42501')await waitFor(()=>expect(screen.queryByRole('button',{name:'Nyatakan satuan'})).toBeNull());else{await screen.findByText('Satuan buku: Belum dinyatakan');fireEvent.click(screen.getByLabelText(/Nol penjualan: SKU-2/));fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));expect(screen.getByRole('region',{name:'Hal yang perlu diperiksa'}).textContent).toContain('Konteks satuan atau ketersediaan barang belum lengkap.');}
 expect(screen.queryByText('Konfirmasi pencatatan')).toBeNull();expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1'||r.n==='pilot_co_import_commit_v1')).toHaveLength(0);
});
