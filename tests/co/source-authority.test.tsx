import { expect, test } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { customer, id, month, mount, store } from './report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';

async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false));
    fireEvent.click(button);
}
test.each(['42501', '08006'])('monthly allocation %s propagates only confirmed denial to the source', async code => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.metadata.notes = 'PRIVATE MONTHLY NOTE';
    mount(<COMonthlyReport />);
    await click('Tinjau laporan');
    await screen.findByRole('button', { name: 'Post laporan' });
    s.fail = (n: string) => n === 'pilot_co_preview_allocations_v1'
        ? { data: null, error: { code, message: 'Allocation read failed' } } : null;
    await click('Alokasi Item 1');
    await screen.findAllByText('Allocation read failed');
    if (code === '42501') {
        expect(screen.queryByDisplayValue('PRIVATE MONTHLY NOTE')).toBeNull();
        expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();
    } else {
        expect(screen.getByDisplayValue('PRIVATE MONTHLY NOTE')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Coba lagi' }).length).toBeGreaterThan(0);
    }
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
test('current profile data revocation on a business save immediately clears the monthly source',async()=>{const s=store();s.metadata.notes='PRIVATE BEFORE PROFILE CHECK';mount(<COMonthlyReport/>);fireEvent.change(await screen.findByLabelText('Terjual Item 1'),{target:{value:'8'}});s.fail=(n:string)=>n==='pilot_my_profile'?{data:[],error:null}:null;await click('Simpan Draft');await waitFor(()=>expect(screen.queryByDisplayValue('PRIVATE BEFORE PROFILE CHECK')).toBeNull());expect(screen.queryByLabelText('Terjual Item 1')).toBeNull();expect(s.commands).toHaveLength(0);});
