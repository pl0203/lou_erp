import { beginIntegrated, readyPreview } from './workspace/import-acceptance-harness';
import { wire } from './report-ui-harness';
import { expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { customer, id, month, mount, store } from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';

async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false));
    fireEvent.click(button);
}
test.each(['42501','08006'])('monthly allocation %s propagates only confirmed denial to the source',async code=>{
 const {f,client}=await beginIntegrated();await readyPreview();fireEvent.click(screen.getByRole('button',{name:'Catat penjualan'}));await screen.findByRole('button',{name:'Edit'});await screen.findByRole('columnheader',{name:'Harga CO'});fireEvent.click(screen.getByRole('button',{name:'Edit'}));await screen.findByText('Nilai awal dari laporan tercatat');fireEvent.change(screen.getByLabelText('Alasan Edit'),{target:{value:'PRIVATE MONTHLY NOTE'}});
 wire.handler=(n,a)=>n==='pilot_co_report_allocations_v1'&&a.p_page_size===20?Promise.resolve({data:null,error:{code,message:'Allocation read failed'}}):f.server(n,a);
 fireEvent.click(screen.getByText('Bukti alokasi FIFO dan PIC asli'));await screen.findAllByText('Allocation read failed');
 if(code==='42501'){expect(screen.queryByDisplayValue('PRIVATE MONTHLY NOTE')).toBeNull();expect(screen.queryByLabelText('Alasan Edit')).toBeNull();expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0)}else{expect((screen.getByLabelText('Alasan Edit') as HTMLInputElement).value).toBe('PRIVATE MONTHLY NOTE');expect(screen.getAllByRole('button',{name:'Coba lagi'}).length).toBeGreaterThan(0)}
 expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(1);
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
test('current profile data revocation on a business save immediately clears the monthly source',async()=>{
 const {f,client}=await beginIntegrated();fireEvent.change(screen.getByLabelText('Alasan perubahan (wajib untuk Edit)'),{target:{value:'PRIVATE BEFORE PROFILE CHECK'}});wire.handler=(n,a)=>n==='pilot_my_profile'?Promise.resolve({data:[],error:null}):f.server(n,a);fireEvent.click(screen.getByRole('button',{name:'Tinjau pencatatan'}));await waitFor(()=>expect(screen.queryByDisplayValue('PRIVATE BEFORE PROFILE CHECK')).toBeNull());expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull();expect(f.requests.filter(r=>r.n==='pilot_co_import_prepare_v1')).toHaveLength(0);expect(f.requests.filter(r=>r.n==='pilot_co_import_commit_v1')).toHaveLength(0);expect(client.getQueryCache().getAll().filter(q=>q.queryKey[0]==='co'&&q.state.data)).toHaveLength(0);
});
