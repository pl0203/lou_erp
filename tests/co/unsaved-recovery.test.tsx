import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { mount, state, ids, change, unload } from './ui-harness';
import COForm from '../../src/pages/athel/co/COForm';
const keep = () => fireEvent.click(screen.getByRole('button', { name: 'Tetap mengedit' }));
const discard = () => fireEvent.click(screen.getByRole('button', { name: 'Buang perubahan' }));
async function edit() { const r = mount(<COForm mode="edit"/>); await screen.findByDisplayValue('Item 1'); return r; }
test.each([-1, 1])('dirty history %s Keep/Discard preserves navigation and draft', async (delta) => { const { router } = await edit(); change('Catatan', 'Keep my work'); expect(unload()).toBe(true); await act(() => router.navigate(delta)); await screen.findByRole('dialog'); keep(); expect(screen.getByDisplayValue('Keep my work')).toBeTruthy(); await act(() => router.navigate(delta)); discard(); await waitFor(() => expect(router.state.location.pathname).toBe(delta < 0 ? '/before' : '/after')); });
test('Cancel and clean reversion do not leave a stale navigation bypass', async () => { const { router } = await edit(); change('Catatan', 'dirty'); fireEvent.click(screen.getByRole('link', { name: 'Batal' })); await screen.findByRole('dialog'); keep(); change('Catatan', ''); expect(unload()).toBe(false); fireEvent.click(screen.getByRole('link', { name: 'Batal' })); await waitFor(() => expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}`)); });
test('voluntary signout registers guarded dirty decision before auth clearing', async () => { await edit(); change('Catatan', 'Dirty'); let decision!: Promise<boolean>; await act(async () => { decision = state.guard!(new AbortController().signal); }); await screen.findByRole('dialog'); keep(); expect(await decision).toBe(false); await act(async () => { decision = state.guard!(new AbortController().signal); }); discard(); expect(await decision).toBe(true); });
test('failed save retains edits and successful save clears pending leave once', async () => { const { router } = await edit(); change('Catatan', 'Keep'); state.send.mockRejectedValueOnce(new Error('Save failed')); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await screen.findByText('Save failed'); expect(unload()).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await waitFor(() => expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}`)); expect(screen.queryByRole('dialog')).toBeNull(); });
test('committed recovery requires explicit acceptance of different dirty values', async () => { state.unresolved = true; const { router } = await edit(); change('Catatan', 'New work'); fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByRole('button', { name: 'Lihat hasil tersimpan' }); fireEvent.click(screen.getByRole('button', { name: 'Lihat hasil tersimpan' })); await screen.findByRole('dialog'); keep(); expect(state.acknowledge).not.toHaveBeenCalled(); expect(screen.getByDisplayValue('New work')).toBeTruthy(); await waitFor(() => expect((screen.getByRole('button', { name: 'Lihat hasil tersimpan' }) as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByRole('button', { name: 'Lihat hasil tersimpan' })); await screen.findByRole('dialog'); discard(); await waitFor(() => expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}`)); expect(state.acknowledge).toHaveBeenCalledTimes(1); });
test('unknown recovery keeps execution blocked', async () => { state.unresolved = true; state.reconcile.mockResolvedValue({ status: 'unknown' }); await edit(); fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); await screen.findByText(/Hasil belum dapat dipastikan/); expect(state.acknowledge).not.toHaveBeenCalled(); expect((screen.getByRole('button', { name: 'Simpan Perubahan' }) as HTMLButtonElement).disabled).toBe(true); });
test('late save cannot pull a departed editor back', async () => { let resolve!: (v: any) => void; state.send.mockReturnValue(new Promise(done => { resolve = done; })); const { router } = await edit(); change('Catatan', 'Dirty'); fireEvent.click(screen.getByRole('button', { name: 'Simpan Perubahan' })); await waitFor(() => expect(state.send).toHaveBeenCalled()); await act(() => router.navigate('/away')); discard(); await waitFor(() => expect(router.state.location.pathname).toBe('/away')); await act(async () => resolve({ id: ids.co, operation: 'edit_co', version: '2', customer_id: ids.customer, customer_version: '2' })); expect(router.state.location.pathname).toBe('/away'); });
test('newer work during committed recovery acknowledgement is protected', async () => { state.unresolved = true; let done!: () => void; state.acknowledge.mockImplementation(() => new Promise<void>(resolve => { done = resolve; })); const { router } = await edit(); change('Catatan', 'A'); fireEvent.click(screen.getByRole('button', { name: 'Pulihkan hasil penyimpanan' })); fireEvent.click(await screen.findByRole('button', { name: 'Lihat hasil tersimpan' })); discard(); await waitFor(() => expect(state.acknowledge).toHaveBeenCalled()); expect(screen.getByLabelText('Catatan').matches(':disabled')).toBe(true); await act(async () => done()); await waitFor(() => expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}`)); });
test('current route shell keeps one main and protects native form Back navigation', async () => {
 const {default:COLayout}=await import('../../src/pages/athel/co/COLayout');
 const {mountRoutes}=await import('./ui-harness');
 const {router}=mountRoutes([{path:'/athel/co',element:<COLayout/>,children:[
  {path:':id/edit',element:<COForm mode="edit"/>},{path:':id',element:<p>Detail destination</p>}
 ]}],`/athel/co/${ids.co}/edit`);
 await screen.findByDisplayValue('Item 1');
 expect(screen.getAllByRole('main')).toHaveLength(1);
 expect(screen.getByRole('main').id).toBe('main-content');
 change('Catatan','Navigation draft');
 fireEvent.click(screen.getByRole('link',{name:'Batal'}));await screen.findByRole('dialog');keep();
 expect(screen.getByDisplayValue('Navigation draft')).toBeTruthy();
 expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}/edit`);
 fireEvent.click(screen.getByRole('link',{name:'Batal'}));await screen.findByRole('dialog');discard();
 await screen.findByText('Detail destination');expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}`);
 expect(screen.getAllByRole('main')).toHaveLength(1);
});

test('actual sidebar Reports navigation preserves dirty work on Keep and changes selected destination only after Discard', async () => {
 const {default:COLayout}=await import('../../src/pages/athel/co/COLayout');
 const {default:ActualAthelNav}=await vi.importActual<typeof import('../../src/components/AthelNav')>('../../src/components/AthelNav');
 const {mountRoutes}=await import('./ui-harness');
 const {router}=mountRoutes([{path:'/athel/co',element:<><ActualAthelNav/><COLayout/></>,children:[
  {path:':id/edit',element:<COForm mode="edit"/>},{path:'reports',element:<p>Reports destination</p>}
 ]}],`/athel/co/${ids.co}/edit`);
 await screen.findByDisplayValue('Item 1');
 expect(screen.getByRole('link',{name:'Pesanan CO'}).getAttribute('aria-current')).toBe('page');
 const reports=screen.getByRole('link',{name:'Laporan Penjualan Bulanan'});
 expect(reports.getAttribute('href')).toBe('/athel/co/reports');
 change('Catatan','Sidebar draft');fireEvent.click(reports);await screen.findByRole('dialog');keep();
 expect(screen.getByDisplayValue('Sidebar draft')).toBeTruthy();
 expect(router.state.location.pathname).toBe(`/athel/co/${ids.co}/edit`);
 expect(screen.getByRole('link',{name:'Pesanan CO'}).getAttribute('aria-current')).toBe('page');
 expect(reports.getAttribute('aria-current')).not.toBe('page');
 fireEvent.click(reports);await screen.findByRole('dialog');discard();
 await screen.findByText('Reports destination');expect(router.state.location.pathname).toBe('/athel/co/reports');
 expect(screen.getByRole('link',{name:'Laporan Penjualan Bulanan'}).getAttribute('aria-current')).toBe('page');
 expect(screen.getByRole('link',{name:'Pesanan CO'}).getAttribute('aria-current')).not.toBe('page');
 expect(screen.queryByDisplayValue('Sidebar draft')).toBeNull();expect(state.commands).toEqual([]);
});
