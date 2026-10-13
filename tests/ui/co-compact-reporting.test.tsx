import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { allocation, customer, month, mount, reportImpact, store, wire } from '../co/report-ui-harness';
import COMonthlyReport from '../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../src/pages/athel/co/COMonthlyReports';

const variant = (node: HTMLElement, value: string) => expect(node.classList.contains(`ui-action--${value}`)).toBe(true);

test('guided report emphasis keeps Review primary through dirty entry and Post primary after review', async () => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.impacts.report = [reportImpact()];
    mount(<COMonthlyReport/>);
    const sold = await screen.findByLabelText('Terjual Item 1');
    const draft = screen.getByRole('group', { name: 'Tindakan draft laporan' });
    const save = within(draft).getByRole('button', { name: 'Simpan Draft' });
    const review = within(draft).getByRole('button', { name: 'Tinjau laporan' });
    variant(save, 'secondary'); variant(review, 'primary');
    fireEvent.change(sold, { target: { value: '69' } });
    variant(save, 'secondary'); variant(review, 'primary');
    fireEvent.click(save);
    await waitFor(() => expect(save.matches(':disabled')).toBe(false));
    await waitFor(() => variant(save, 'secondary')); variant(review, 'primary');
    expect(s.commands).toHaveLength(1); expect(s.commands[0].payload.lines[0].sold_quantity).toBe(69);
    fireEvent.click(review);
    const posting = await screen.findByRole('group', { name: 'Tindakan posting laporan' });
    variant(within(posting).getByRole('button', { name: 'Post laporan' }), 'primary');
    variant(review, 'secondary'); variant(save, 'secondary');
    expect(s.previewCount).toBe(1); expect(s.commands).toHaveLength(1);
});

test('report impact selectors are quiet compact commands retaining pressed state and server read selection', async () => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.impacts.report = [reportImpact()];
    mount(<COMonthlyReport/>); await screen.findByLabelText('Terjual Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    const region = await screen.findByRole('region', { name: 'Peninjauan dampak' });
    const selector = within(region).getByRole('button', { name: 'Stok (0)' });
    variant(selector, 'quiet'); expect(selector.classList.contains('ui-action--compact')).toBe(true);
    expect(selector.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(selector); expect(selector.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(wire.rpc.mock.calls.some(([name, args]) => name === 'pilot_co_preview_impacts_v1' && args.p_kind === 'stock')).toBe(true));
    expect(s.commands).toHaveLength(0);
});

test('impact selection moves a visible tinted border between compact quiet selectors', async () => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.impacts.report = [reportImpact()];
    mount(<COMonthlyReport/>); await screen.findByLabelText('Terjual Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    const region = await screen.findByRole('region', { name: 'Peninjauan dampak' });
    const selectors = Array.from(region.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'));
    expect(selectors).toHaveLength(7);
    const issue = within(region).getByRole('button', { name: 'Penghalang (0)' });
    const stock = within(region).getByRole('button', { name: 'Stok (0)' });
    const visibleSelection = (selected: HTMLElement) => {
        for (const button of selectors) {
            variant(button, 'quiet'); expect(button.classList.contains('ui-action--compact')).toBe(true);
            expect(button.classList.contains('bg-brand-tint')).toBe(button === selected);
            expect(button.classList.contains('border-brand-primary')).toBe(button === selected);
            expect(button.getAttribute('aria-pressed')).toBe(button === selected ? 'true' : 'false');
        }
    };
    visibleSelection(issue);
    fireEvent.click(stock); visibleSelection(stock);
    fireEvent.click(issue); visibleSelection(issue);
    expect(s.commands).toHaveLength(0);
});

test('report allocation links keep exact native destinations with quiet compact affordance', async () => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.impacts.report = [reportImpact()]; s.allocations = [allocation(1, '70', '10')];
    mount(<COMonthlyReport/>); await screen.findByLabelText('Terjual Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByRole('group', { name: 'Tindakan posting laporan' });
    fireEvent.click(screen.getByRole('button', { name: 'Alokasi Item 1' }));
    const allocationLink = await screen.findByRole('link', { name: 'CO-1' });
    variant(allocationLink, 'quiet'); expect(allocationLink.classList.contains('ui-action--compact')).toBe(true);
    expect(allocationLink.getAttribute('href')).toBe(`/athel/co/${s.allocations[0].co_id}`);
    variant(screen.getByRole('link', { name: '← Laporan bulanan' }), 'quiet');
});

test('guided period action retains the authoritative customer and month destination', async () => {
    store();
    mount(<COMonthlyReports/>, `/athel/co/reports?customer=${customer}&month=2026-09`);
    const next = await screen.findByRole('link', { name: 'Buka pengisian: September 2026' });
    variant(next, 'primary');
    expect(next.getAttribute('href')).toBe(`/athel/co/reports/${customer}/${month}`);
});

test('an absent report emphasizes explicit preparation without initializing on route load', async () => {
    const s = store(); s.draft = false;
    mount(<COMonthlyReport/>);
    const prepare = await screen.findByRole('button', { name: 'Mulai laporan' });
    variant(prepare, 'primary');
    expect(s.commands).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Simpan Draft' })).toBeNull();
});


test.each(['Detail teknis laporan', 'Detail teknis peninjauan'])('%s uses shared responsive targets while retaining native disclosure and mounted children', async label => {
    const s = store(); s.rows[0].sold_quantity = '70'; s.impacts.report = [reportImpact()];
    mount(<COMonthlyReport/>);
    const sold = await screen.findByLabelText('Terjual Item 1');
    fireEvent.click(screen.getByRole('button', { name: 'Tinjau laporan' }));
    await screen.findByText('Pendapatan periode dipilih: Rp 720.000');
    await screen.findByText('Tidak ada penghalang.');
    const summary = screen.getByText(label);
    const details = summary.parentElement as HTMLDetailsElement;
    expect(summary.tagName).toBe('SUMMARY'); expect(details.tagName).toBe('DETAILS');
    // These classes opt into the existing token contract tested in density.test.ts:
    // 44px touch/narrow minimum; 32px + compact padding only on wide fine-pointer desktop.
    for (const token of ['ui-action', 'ui-action--quiet', 'ui-action--compact', 'list-item'])
        expect(summary.classList.contains(token), token).toBe(true);
    expect(summary.getAttribute('role')).toBeNull();
    expect(summary.getAttribute('tabindex')).toBeNull();
    expect(summary.classList.contains('outline-none')).toBe(false);
    const contents = summary.nextElementSibling;
    expect(contents).not.toBeNull(); expect(details.open).toBe(false);
    const reads = wire.rpc.mock.calls.length;
    summary.focus(); expect(document.activeElement).toBe(summary);
    fireEvent.click(summary); expect(details.open).toBe(true);
    expect(summary.nextElementSibling).toBe(contents);
    fireEvent.click(summary); expect(details.open).toBe(false);
    expect(summary.nextElementSibling).toBe(contents);
    expect(screen.getByLabelText('Terjual Item 1')).toBe(sold);
    expect(wire.rpc.mock.calls).toHaveLength(reads);
    expect(s.commands).toHaveLength(0);
});
