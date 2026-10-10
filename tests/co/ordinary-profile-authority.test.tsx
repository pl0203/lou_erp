import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { stockFixture, mountApp, wire } from './stock-ui-harness';
import App from '../../src/App';
import * as catalog from '../../src/lib/co/catalog';
async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false)); fireEvent.click(button);
}
test.each(['edit', 'sj', 'cancel'] as const)('%s current-profile revocation clears fields before any transaction dispatch', async kind => {
    const s = stockFixture(); s.allowed = ['edit_co', 'cancel_co', 'save_sj_draft', 'post_sj'];
    vi.spyOn(catalog, 'fetchCOCatalog').mockResolvedValue([]);
    const { client } = mountApp(<App/>, `/athel/co/${s.co.id}${kind === 'edit' ? '/edit' : ''}`);
    await screen.findByText('Original PIC');
    if (kind === 'edit') fireEvent.change(await screen.findByLabelText('Catatan'), { target: { value: 'Private profile note' } });
    else {
        await click(kind === 'sj' ? 'Tambah Surat Jalan' : 'Batalkan CO');
        fireEvent.change(await screen.findByLabelText(kind === 'sj' ? 'Nomor SJ' : 'Alasan pembatalan'), { target: { value: 'Private profile note' } });
        if (kind === 'sj') fireEvent.change(screen.getByLabelText('Jumlah dikirim Item 1'), { target: { value: '1' } });
    }
    s.fail = (name: string) => name === 'pilot_my_profile' ? { data: [], error: null } : null;
    await click(kind === 'edit' ? 'Simpan Perubahan' : kind === 'sj' ? 'Simpan Draft SJ' : 'Konfirmasi pembatalan');
    await screen.findByText('CO authority required');
    expect(screen.queryByDisplayValue('Private profile note')).toBeNull(); expect(screen.queryByText('Original PIC')).toBeNull();
    expect(client.getQueriesData({ queryKey: ['co'] }).filter(([, data]) => data !== undefined)).toEqual([]);
    expect(wire.rpc.mock.calls.filter(([name]) => name === 'pilot_co_transaction_v1')).toHaveLength(0);
});
