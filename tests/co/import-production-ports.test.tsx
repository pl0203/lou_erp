import { productionImportFixture } from './import-production-ports-harness';
import { fireEvent, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
test.each(['selection','eligible'])('actual decoder rejects hostile %s binding without evidence/import/ledger writes',async kind=>{
 const f=await productionImportFixture();f.s.draft=true;
 if(kind==='selection')f.state.corruptSelection=true;else f.state.corruptEligible=true;
 f.mountRoute();await f.choose();await screen.findByRole('alert');
 expect(screen.queryByText('Pemetaan memakai konteks pelanggan yang terikat versi.')).toBeNull();
 expect(f.writes).toHaveLength(0);expect(f.s.effective).toBeNull();
});

test('production sender refuses initial internal preparation after authoritative profile revocation',async()=>{
 const f=await productionImportFixture();f.mountRoute();await screen.findByLabelText('Pilih PDF atau XLSX');
 f.s.fail=(name:string)=>name==='pilot_my_profile'?{data:[],error:null}:null;
 await f.choose();await screen.findByRole('alert');
 expect(f.writes).toHaveLength(0);expect(f.s.effective).toBeNull();
 expect(screen.queryByText('Pemetaan memakai konteks pelanggan yang terikat versi.')).toBeNull();
});
test('production preview decoder rejects immutable import binding substitution before a record action exists',async()=>{
 const f=await productionImportFixture();f.state.corruptPreview=true;f.mountRoute();await f.choose();await f.confirmDecisions();
 fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await screen.findByRole('alert');
 expect(f.state.prepareCount).toBe(1);expect(f.state.previewCount).toBe(1);
 expect(screen.queryByRole('heading',{name:'Konfirmasi pencatatan'})).toBeNull();
 expect(screen.queryByRole('button',{name:'Catat penjualan'})).toBeNull();
 expect(f.writes.some(w=>w.name==='pilot_co_import_commit_v1')).toBe(false);expect(f.s.effective).toBeNull();
});
