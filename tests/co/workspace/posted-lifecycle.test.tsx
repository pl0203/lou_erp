// Synthetic transport integration, not SQL atomicity or hosted authorization evidence.
import { expect, test } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { wire, customer, month, id } from '../report-ui-harness';
import { beginIntegrated, integratedServer, readyPreview } from './import-acceptance-harness';
import COMonthlyReport from '../../../src/pages/athel/co/COMonthlyReport';
import COMonthlyReports from '../../../src/pages/athel/co/COMonthlyReports';

function Routes() {
  return useLocation().pathname === '/athel/co/reports' ? <COMonthlyReports/> : <COMonthlyReport/>;
}
function withMonthlyList() {
  const f = integratedServer();
  const listRequests: any[] = [];
  wire.handler = async (name, args) => {
    if (name !== 'pilot_co_reports_page_v2') return f.server(name, args);
    listRequests.push(args);
    const effective = f.s.effective;
    // Model the existing server filter: an all-status request would expose
    // the unconsumed internal preparation. Do not hide it in test rendering.
    const row = {
      id: id(4), customer_id: customer, customer_name: 'Store A', report_month: month,
      status: effective ? 'posted' : 'historical_pending',
      report_head_id: effective?.report_head_id ?? null,
      revision_id: effective?.revision_id ?? null,
      legacy_pending: !f.s.metadata.consumed,
      source_filename: effective ? 'synthetic.pdf' : null,
      updated_at: '2026-10-09T00:00:00Z',
    };
    const rows = effective || args.p_status !== 'posted' ? [row] : [];
    return { data: {
      version: '2', as_of: '2026-10-09T00:00:00Z', customer_id: args.p_customer_id,
      report_month: args.p_month, status: args.p_status, page: args.p_page,
      page_size: args.p_page_size, total: String(rows.length), rows,
    }, error: null };
  };
  return { f, listRequests };
}
async function openList(router: Awaited<ReturnType<typeof beginIntegrated>>['router']) {
  await act(() => router.navigate('/athel/co/reports'));
  const discard = screen.queryByRole('button', { name: 'Buang perubahan' });
  if (discard) fireEvent.click(discard);
  await screen.findByRole('table', { name: 'Laporan penjualan pelanggan' });
}

test.each(['before prepare', 'after prepare'] as const)('cancelled upload %s never appears as a monthly report or posts implicitly', async phase => {
  const { f, listRequests } = withMonthlyList();
  const { router } = await beginIntegrated(f, '70', <Routes/>);
  if (phase === 'after prepare') await readyPreview();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_prepare_v1')).toHaveLength(phase === 'after prepare' ? 1 : 0);
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Buang perubahan' }));
  await waitFor(() => expect(screen.queryByLabelText('Jumlah terjual (tidak dikurangi retur)')).toBeNull());
  await openList(router);
  expect(await screen.findByRole('heading', { name: 'Belum ada laporan sesuai filter.' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Buka laporan' })).toBeNull();
  expect(screen.queryByText('Pekerjaan lama · perlu diperiksa')).toBeNull();
  expect(listRequests.length).toBeGreaterThan(0);
  expect(listRequests.every(a => a.p_status === 'posted')).toBe(true);
  expect(f.s.draft).toBe(true);
  expect(f.s.effective).toBeNull();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(0);
  if (phase === 'after prepare') expect(f.s.rows[0].sold_quantity).toBe('70');
});

test('one successful save produces one recorded list row and starting then cancelling Edit retains that recorded row', async () => {
  const { f, listRequests } = withMonthlyList();
  const { router } = await beginIntegrated(f, '70', <Routes/>);
  await readyPreview();
  fireEvent.click(screen.getByRole('button', { name: 'Catat penjualan' }));
  await screen.findByRole('button', { name: 'Edit' });
  const originalRevision = f.s.effective.revision_id;
  await openList(router);
  expect(await screen.findByRole('link', { name: 'Buka laporan' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'Buka laporan' })).toHaveLength(1);
  expect(screen.getByText('Tercatat')).toBeTruthy();
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(1);
  fireEvent.click(screen.getByRole('link', { name: 'Buka laporan' }));
  await screen.findByRole('button', { name: 'Edit' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' }).matches(':disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await screen.findByText('Nilai awal dari laporan tercatat');
  fireEvent.change(screen.getByLabelText('Alasan Edit'), { target: { value: 'Pending review only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Batal' }));
  const discard = screen.queryByRole('button', { name: 'Buang perubahan' });
  if (discard) fireEvent.click(discard);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
  await openList(router);
  expect(await screen.findByRole('link', { name: 'Buka laporan' })).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'Buka laporan' })).toHaveLength(1);
  expect(screen.getByText('Tercatat')).toBeTruthy();
  expect(f.s.effective.revision_id).toBe(originalRevision);
  expect(f.requests.filter(r => r.n === 'pilot_co_import_commit_v1')).toHaveLength(1);
  expect(listRequests.every(a => a.p_status === 'posted')).toBe(true);
});
