import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, mountApp, stockFixture, id } from '../co/stock-ui-harness';
import App from '../../src/App';
import { LegacyReturnOwner } from '../co/legacy-return-owner';
import { MainContent } from '../../src/components/ui/MainContent';
// Legacy return cases exercise the exported editor, not current App creation routes.

async function click(name: string) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.matches(':disabled')).toBe(false));
    button.focus(); fireEvent.click(button); return button;
}

for (const kind of ['return', 'settlement'] as const) {
    test(`${kind === 'return' ? 'legacy return editor' : 'current settlement'} shared native dialog preserves real sender pending dismissal and trigger focus`, async () => {
        const s = stockFixture();
        mountApp(kind === 'return' ? <MainContent><LegacyReturnOwner state={s}/></MainContent> : <App/>, kind === 'return' ? `/athel/co/stock?customer=${customer}` : `/athel/co/${id(11)}`);
        const disclosure = kind === 'settlement' ? await click('Actions') : null;
        const trigger = await click(kind === 'return' ? 'Retur barang belum terjual' : 'Selesaikan sisa belum dikirim');
        await screen.findByLabelText(kind === 'return' ? 'Jumlah retur SJ-1 Item 1' : 'Jumlah dibatalkan Item 1');
        let dialog = screen.getByRole('dialog');
        expect(dialog.tagName).toBe('DIALOG'); expect(dialog.classList.contains('ui-dialog')).toBe(true);
        fireEvent.keyDown(dialog, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(disclosure ?? trigger);
        if(disclosure) await click('Actions');
        await click(kind === 'return' ? 'Retur barang belum terjual' : 'Selesaikan sisa belum dikirim');
        const quantity = await screen.findByLabelText(kind === 'return' ? 'Jumlah retur SJ-1 Item 1' : 'Jumlah dibatalkan Item 1');
        expect(quantity.closest('.ui-field')).toBeTruthy();
        await waitFor(() => expect(quantity.matches(':disabled')).toBe(false));
        fireEvent.change(quantity, { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText(kind === 'return' ? 'Referensi retur' : 'Alasan penyelesaian'), { target: { value: 'PENDING DRAFT' } });
        let release!: () => void;
        s.fail = async (name: string) => {
            if (name === 'pilot_co_transaction_v1') { await new Promise<void>(resolve => { release = resolve; }); }
            return null;
        };
        const send = await click(kind === 'return' ? 'Simpan Draft retur' : 'Konfirmasi penyelesaian');
        expect(send.classList.contains('ui-action')).toBe(true);
        await waitFor(() => expect(release).toBeTypeOf('function'));
        expect(Object.keys(localStorage).filter(key => key.startsWith('co-request:'))).toHaveLength(1);
        dialog = screen.getByRole('dialog');
        fireEvent.keyDown(dialog, { key: 'Escape' });
        const cancel = new Event('cancel', { cancelable: true }); fireEvent(dialog, cancel);
        expect(cancel.defaultPrevented).toBe(true);
        const dismiss = screen.getByRole('button', { name: kind === 'return' ? 'Tutup retur' : 'Batal' });
        expect(dismiss.matches(':disabled')).toBe(true); fireEvent.click(dismiss);
        expect(screen.getByRole('dialog')).toBe(dialog);
        expect(screen.queryByRole('button', { name: 'Pulihkan hasil penyimpanan' })).toBeNull();
        await act(async () => release());
        await waitFor(() => expect(s.commands).toHaveLength(1));
        await waitFor(() => expect(Object.keys(localStorage).filter(key => key.startsWith('co-request:'))).toHaveLength(0));
    });
}

test('legacy return editor review keeps one native dialog and shared correction fields inside an embedded section', async () => {
    const s = stockFixture(); mountApp(<MainContent><LegacyReturnOwner state={s}/></MainContent>, `/athel/co/stock?customer=${customer}`);
    await click('Retur barang belum terjual');
    const quantity = await screen.findByLabelText('Jumlah retur SJ-1 Item 1');
    await waitFor(() => expect(quantity.matches(':disabled')).toBe(false));
    fireEvent.change(quantity, { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Referensi retur'), { target: { value: 'RETURN REVIEW' } });
    await click('Simpan Draft retur'); await click('Tinjau / post retur');
    const reason = await screen.findByLabelText('Alasan perubahan');
    expect(reason.closest('.ui-field')).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(reason.closest('section')?.getAttribute('aria-labelledby')).toBe('co-correction-title');
    expect(document.querySelectorAll('#main-content')).toHaveLength(1);
    const inspect = screen.getByRole('button', { name: 'Tinjau semua dampak' });
    expect(inspect.classList.contains('ui-action')).toBe(true);
    fireEvent.change(reason, { target: { value: 'Explicit impact review' } });
    await click('Tinjau semua dampak');
    await screen.findByRole('region', { name: 'Peninjauan dampak' });
    const impacts = ['Laporan', 'Stok', 'Pendapatan', 'Kredit PIC', 'CO dibuka ulang', 'Penghalang', 'Periode wajib'];
    for (const label of impacts) {
        const button = screen.getByRole('button', { name: new RegExp(`^${label} \\(`) });
        expect(button.classList.contains('ui-action')).toBe(true);
    }
    expect(s.commands).toHaveLength(1);
});
