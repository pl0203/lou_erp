import React from 'react';
import { readFileSync } from 'node:fs';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { customer, id, month, mount, store } from '../co/report-ui-harness';
import { COReportFields, useCOReportWorkspace } from '../../src/components/co/COReportWorkspace';
import type { COReportWorkspace } from '../../src/components/co/COReportWorkspace';

const uiStyles = readFileSync('src/styles/ui.css', 'utf8');

let workspace: COReportWorkspace;
function ReportFields() {
    const work = useCOReportWorkspace(customer, month);
    workspace = work;
    return work.header ? <COReportFields work={work}/> : null;
}

function posted(metadata: Record<string, string | null>) {
    const s = store();
    s.metadata = metadata;
    s.effective = {
        ...s.header(), id: id(4), status: 'posted', draft_id: null, draft_version: null,
        report_head_id: id(4), revision_id: id(5), report_version: '1',
        eligible_set_fingerprint: null, revenue: '0',
    };
    s.draft = false;
    return s;
}

async function summary() {
    await screen.findByRole('region', { name: 'Isian laporan pelanggan' });
    const panel = screen.getByRole('region', { name: 'Isian laporan pelanggan' });
    await waitFor(() => expect(panel.querySelector('dl')).toBeTruthy());
    return panel.querySelector('dl') as HTMLDListElement;
}

function valueFor(list: HTMLDListElement, label: string) {
    const term = within(list).getByText(label, { selector: 'dt' });
    const value = term.nextElementSibling;
    expect(value?.tagName).toBe('DD');
    return value as HTMLElement;
}

test('posted reference and multiline notes use complete wrapping semantic summary text', async () => {
    const reference = `SYNTHETIC-${'R'.repeat(240)}`;
    const notes = `First synthetic note line\n${'N'.repeat(260)}\nLast synthetic note line`;
    const s = posted({ report_reference: reference, received_date: '2026-09-30', notes });
    mount(<ReportFields/>);
    const list = await summary();
    expect(list.classList.contains('ui-summary-list')).toBe(true);
    expect(list.classList.contains('min-w-0')).toBe(true);
    expect(list.classList.contains('sm:grid-cols-2')).toBe(true);
    expect(list.classList.contains('[&_dd]:whitespace-pre-wrap')).toBe(true);
    expect(list.classList.contains('[&_dd]:[overflow-wrap:anywhere]')).toBe(true);
    expect(valueFor(list, 'Referensi laporan').textContent).toBe(reference);
    expect(valueFor(list, 'Catatan laporan').textContent).toBe(notes);
    expect(list.querySelector('input, textarea, fieldset')).toBeNull();
    expect(uiStyles).toMatch(/\.ui-summary-list dd\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/);
    expect(s.commands).toHaveLength(0);
});

test('posted metadata keeps descriptive labels and a calendar date without a timezone conversion', async () => {
    posted({ report_reference: 'SYNTHETIC-REF', received_date: '2026-01-01', notes: 'Synthetic note' });
    mount(<ReportFields/>);
    const list = await summary();
    expect(Array.from(list.querySelectorAll('dt'), term => term.textContent)).toEqual([
        'Referensi laporan', 'Tanggal diterima', 'Catatan laporan',
    ]);
    const date = valueFor(list, 'Tanggal diterima');
    expect(date.textContent).toBe('1 Januari 2026');
    expect(date.querySelector('time')?.getAttribute('datetime')).toBe('2026-01-01');
    expect(list.textContent).not.toMatch(/WIB|UTC|00:00/);
    expect(screen.queryByRole('textbox')).toBeNull();
});

test.each([null, ''])('posted metadata explicitly shows an absent date and empty text values (%s)', async empty => {
    // The wire contract uses null for an absent SQL DATE; workspace metadata normalizes it to ''.
    posted({ report_reference: empty, received_date: null, notes: empty });
    mount(<ReportFields/>);
    const list = await summary();
    for (const label of ['Referensi laporan', 'Tanggal diterima', 'Catatan laporan']) {
        expect(valueFor(list, label).textContent).toBe('—');
    }
    expect(list.querySelector('time')).toBeNull();
});

test('posted reference and notes render HTML-shaped metadata as literal text', async () => {
    const reference = '<img src="synthetic" onerror="alert(1)">';
    const notes = '<script>synthetic()</script>\n<b>Literal note</b> & text';
    posted({ report_reference: reference, received_date: '2026-09-30', notes });
    mount(<ReportFields/>);
    const list = await summary();
    expect(valueFor(list, 'Referensi laporan').textContent).toBe(reference);
    expect(valueFor(list, 'Catatan laporan').textContent).toBe(notes);
    expect(list.querySelector('img, script, b')).toBeNull();
});

test('editable metadata retains native labels, IDs, date input and existing change handlers', async () => {
    const s = store();
    mount(<ReportFields/>);
    await screen.findByLabelText('Catatan laporan');
    await waitFor(() => expect(workspace.frozen).toBe(false));
    const fields = [
        ['Referensi laporan', 'report_reference', 'SYNTHETIC-DRAFT-REF', 'text'],
        ['Tanggal diterima', 'received_date', '2026-09-29', 'date'],
        ['Catatan laporan', 'notes', 'Unsent synthetic draft note', 'text'],
    ] as const;
    for (const [label, key, value, type] of fields) {
        const input = screen.getByLabelText(label) as HTMLInputElement;
        expect(input.tagName).toBe('INPUT');
        expect(input.type).toBe(type);
        expect(input.id).toMatch(new RegExp(`^co-report-.+-${key}$`));
        expect(input.labels).toHaveLength(1);
        expect(input.labels?.[0].htmlFor).toBe(input.id);
        expect(input.matches(':disabled')).toBe(false);
        fireEvent.change(input, { target: { value } });
        expect(workspace.meta[key]).toBe(value);
        expect(input.value).toBe(value);
    }
    expect(workspace.dirty).toBe(true);
    expect(document.querySelector('dl')).toBeNull();
    expect(s.commands).toHaveLength(0);
});

test('temporarily frozen editing keeps the same disabled controls and unsent metadata', async () => {
    const s = store();
    mount(<ReportFields/>);
    await screen.findByLabelText('Catatan laporan');
    await waitFor(() => expect(workspace.frozen).toBe(false));
    const reference = screen.getByLabelText('Referensi laporan') as HTMLInputElement;
    const date = screen.getByLabelText('Tanggal diterima') as HTMLInputElement;
    const notes = screen.getByLabelText('Catatan laporan') as HTMLInputElement;
    fireEvent.change(reference, { target: { value: 'SYNTHETIC-UNSENT' } });
    fireEvent.change(date, { target: { value: '2026-09-29' } });
    fireEvent.change(notes, { target: { value: 'Keep synthetic unsent note' } });
    const before = { ...workspace.meta };
    await act(async () => workspace.setEvidenceState({ dirty: false, pending: true, unresolved: false }));
    expect(workspace.editing).toBe(true);
    for (const [label, control, value] of [
        ['Referensi laporan', reference, before.report_reference],
        ['Tanggal diterima', date, before.received_date],
        ['Catatan laporan', notes, before.notes],
    ] as const) {
        expect(screen.getByLabelText(label)).toBe(control);
        expect(control.matches(':disabled')).toBe(true);
        expect(control.value).toBe(value);
        expect(control.labels?.[0].htmlFor).toBe(control.id);
    }
    expect(document.querySelector('dl')).toBeNull();
    expect(workspace.meta).toEqual(before);
    await act(async () => workspace.editMeta('notes', 'Blocked synthetic change'));
    expect(workspace.meta).toEqual(before);
    await act(async () => workspace.setEvidenceState({ dirty: false, pending: false, unresolved: false }));
    expect(screen.getByLabelText('Catatan laporan')).toBe(notes);
    expect(notes.matches(':disabled')).toBe(false);
    fireEvent.change(notes, { target: { value: 'Synthetic resumed edit' } });
    expect(workspace.meta.notes).toBe('Synthetic resumed edit');
    expect(s.commands).toHaveLength(0);
});
