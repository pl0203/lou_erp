import React from 'react';
import { expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { mount, wire, customer, month, draftId, id } from './report-ui-harness';
import { evidenceId, fixture, choose } from './evidence-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';


async function begin(mode: 'exact' | 'newer' | 'consumed' = 'exact', arrange?: (f: ReturnType<typeof fixture>) => void) {
 const f=fixture();
 wire.invoke.mockImplementation(async name => {
  if(name==='co-evidence-download')return {data:new Blob(['%PDF-1.7\n%%EOF\n']),error:null};
  f.finalizeElsewhere();
  if(mode!=='exact'){f.s.version='3'; f.s.rows[0].sold_quantity='4';f.s.metadata.notes='Latest canonical note';}
  if(mode==='consumed'){
   f.s.metadata.consumed=true;
   f.s.effective={...f.s.header(),id:id(4),status:'posted',draft_id:null,draft_version:null,report_head_id:id(4),revision_id:id(5),report_version:'1',revenue:'40000',eligible_set_fingerprint:null,consumed:false};
  }
  return {data:{id:evidenceId,state:'finalized'},error:null};
 });
 arrange?.(f);
 const owner=mount(<COMonthlyReport/>);
 fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'8'}});
 fireEvent.change(screen.getByLabelText('Catatan laporan'),{target:{value:'Keep authorized report fields'}});
 await choose(); fireEvent.click(screen.getByText('Verifikasi dan pasang lampiran'));
 return {f,...owner};
}
test('same-creator finalized upload adopts checked canonical evidence with dirty fields and no local finalize receipt',async()=>{
 const {f}=await begin();
 await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);
 expect(f.commands.map(c=>c.p_operation)).toEqual(['register_evidence']); expect(localStorage.length).toBe(0);
 expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
 expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Keep authorized report fields');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Simpan Draft'}).matches(':disabled')).toBe(false));
 expect(screen.queryByText('Coba buka hasil lampiran')).toBeNull();
 const create=vi.fn(()=> 'blob:adopted'),revoke=vi.fn();let downloaded='';
 vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(function(this: HTMLAnchorElement){downloaded=this.download;});
 vi.stubGlobal('URL',class extends URL {static createObjectURL=create;static revokeObjectURL=revoke;});
 fireEvent.click(screen.getByText(`Unduh evidence-${evidenceId}.pdf`));
 await waitFor(()=>expect(downloaded).toBe(`evidence-${evidenceId}.pdf`));
 expect(create.mock.calls).toHaveLength(1);expect(revoke).toHaveBeenCalledWith('blob:adopted');
 await waitFor(()=>expect(screen.getByRole('button',{name:'Simpan Draft'}).matches(':disabled')).toBe(false));
 fireEvent.click(screen.getByRole('button',{name:'Simpan Draft'}));
 await waitFor(()=>expect(f.s.metadata.notes).toBe('Keep authorized report fields'));
 expect(f.s.rows[0].sold_quantity).toBe('8');
 expect(f.s.commands[0].payload.expected_draft_version).toBe('2');
});
test.each(['newer','consumed'] as const)('observed finalized evidence with %s source uses explicit Keep/Discard without a fabricated acknowledgement',async mode=>{
 const {f}=await begin(mode);
 await screen.findByText('Coba buka hasil lampiran');
 expect(localStorage.length).toBe(0);
 expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
 await waitFor(()=>expect(screen.getByText('Selesaikan konflik lampiran').matches(':disabled')).toBe(false));
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Tetap mengedit'));
 expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Keep authorized report fields');
 await waitFor(()=>expect(screen.getByText('Selesaikan konflik lampiran').matches(':disabled')).toBe(false));
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Buang perubahan'));
 await waitFor(()=>expect(screen.queryByText('Coba buka hasil lampiran')).toBeNull());
 expect(f.commands.map(c=>c.p_operation)).toEqual(['register_evidence']);expect(localStorage.length).toBe(0);
 expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Latest canonical note');
 if(mode==='newer')expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('4');
});

test.each(['authority','wrong sidecar','read failure','late owner','late denial'] as const)('canonical observation retains authority and lifetime checks: %s',async mode=>{
 let release!:()=>Promise<void>, resumeReads!:()=>void;
 const {f}=await begin('exact',f=>{
  const base=wire.handler;resumeReads=()=>{wire.handler=base;};
  wire.handler=async(n:string,a:any)=>{
   if(n==='pilot_co_evidence_selection_v1'&&f.e?.state==='finalized'){
    if(mode==='authority')return {data:null,error:{code:'42501',message:'Evidence authority removed'}};
    if(mode==='read failure')return {data:null,error:{code:'08006',message:'Selection unavailable'}};
    if(mode==='wrong sidecar'){
     const r=await base(n,a);return {...r,data:{...r.data,evidence:{...f.e,id:id(46),filename:`evidence-${id(46)}.pdf`}}};
    }
    if(mode==='late owner'||mode==='late denial')return new Promise(resolve=>{release=async()=>resolve(mode==='late denial'?{data:null,error:{code:'42501',message:'Late old authority denial'}}:await base(n,a));});
   }
   return base(n,a);
  };
 });
 if(mode==='late owner'||mode==='late denial'){
  await waitFor(()=>expect(release).toBeTypeOf('function'));
  const oldRelease=release;
  cleanup();const base=wire.handler;wire.handler=(n:string,a:any)=>n==='pilot_co_evidence_selection_v1'?Promise.resolve({data:{version:'1',customer_id:customer,draft_id:a.p_draft_id,draft_version:a.p_expected_draft_version,revision_id:a.p_revision_id,evidence:f.e},error:null}):base(n,a);
  mount(<COMonthlyReport/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'19'}});
  await act(async()=>oldRelease());
  expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('19');
  expect(screen.queryByText('Late old authority denial')).toBeNull();
  expect(screen.queryByText('Coba buka hasil lampiran')).toBeNull();
 }else{
  await screen.findAllByText(mode==='authority'?'Evidence authority removed':mode==='read failure'?'Selection unavailable':'Pilihan lampiran tidak sesuai.');
  if(mode==='authority')expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
  else {
   expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
   expect(screen.getByRole('button',{name:'Simpan Draft'}).matches(':disabled')).toBe(true);
   expect(screen.getByText('Coba buka hasil lampiran')).toBeTruthy();
   if(mode==='read failure'){
    resumeReads();fireEvent.click(screen.getByText('Coba buka hasil lampiran'));
    await screen.findByText(`Unduh evidence-${evidenceId}.pdf`);
    await waitFor(()=>expect(screen.getByRole('button',{name:'Simpan Draft'}).matches(':disabled')).toBe(false));
    expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
   }
  }
 }
 expect(f.commands.map(c=>c.p_operation)).toEqual(['register_evidence']);expect(localStorage.length).toBe(0);
});
test('canonical observation never discards dirty fields before all current report pages are checked',async()=>{
 const {f}=await begin('newer');
 await screen.findByText('Coba buka hasil lampiran');
 const base=wire.handler;
 wire.handler=async(n:string,a:any)=>n==='pilot_co_report_rows_v1'?{data:null,error:{code:'08006',message:'Current rows unavailable'}}:base(n,a);
 await waitFor(()=>expect(screen.getByText('Selesaikan konflik lampiran').matches(':disabled')).toBe(false));
 fireEvent.click(screen.getByText('Selesaikan konflik lampiran'));fireEvent.click(await screen.findByText('Buang perubahan'));
 await screen.findAllByText('Current rows unavailable');
 expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
 expect((screen.getByLabelText('Catatan laporan') as HTMLInputElement).value).toBe('Keep authorized report fields');
 expect(f.commands.map(c=>c.p_operation)).toEqual(['register_evidence']);expect(localStorage.length).toBe(0);
});

test('observed immutable evidence metadata cannot change between canonical rechecks',async()=>{
 const {f}=await begin('exact',f=>{
  const base=wire.handler;let finalizedReads=0;
  wire.handler=async(n:string,a:any)=>{
   const result=await base(n,a);
   if(n==='pilot_co_evidence_v1'&&f.e?.state==='finalized'&&++finalizedReads===3)
    return {...result,data:{...result.data,byte_size:result.data.byte_size+1}};
   return result;
  };
 });
 await screen.findAllByText('Hasil lampiran asli berubah.');
 expect((screen.getByLabelText('Terjual Item 1') as HTMLInputElement).value).toBe('8');
 expect(screen.getByText('Coba buka hasil lampiran')).toBeTruthy();
 expect(f.commands.map(c=>c.p_operation)).toEqual(['register_evidence']);expect(localStorage.length).toBe(0);
});
