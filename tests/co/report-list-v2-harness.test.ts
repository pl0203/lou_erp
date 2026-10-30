import { expect, test } from 'vitest';
import { customer, draftId, id, month, store } from './report-ui-harness';
import { fetchCOReportsPageV2 } from '../../src/lib/co/workspaceReads';

const args = { p_customer_id: customer, p_month: month, p_status: 'all', p_page: 1, p_page_size: 1 };

test('V2 list decodes historical pending work without pretending it is posted', async () => {
  store();
  const pending = await fetchCOReportsPageV2(args);
  expect(pending).toMatchObject({ version: '2', total: '1', page: 1, page_size: 1 });
  expect(pending.rows).toEqual([{ id: draftId, customer_id: customer, customer_name: 'Store A', report_month: month,
    status: 'historical_pending', revision_id: null, report_head_id: null, legacy_pending: true,
    source_filename: null, updated_at: '2026-10-09T00:00:00Z' }]);
  const postedOnly = await fetchCOReportsPageV2({ ...args, p_status: 'posted' });
  expect(postedOnly.total).toBe('0'); expect(postedOnly.rows).toEqual([]);
});

test('V2 posted identity and exact total survive page boundary and filters', async () => {
  const s = store(); s.effective = { ...s.header(), report_head_id: id(4), revision_id: id(5), source_filename: 'fixture.pdf' };
  const first = await fetchCOReportsPageV2({ ...args, p_status: 'posted' });
  expect(first.rows).toHaveLength(1);
  expect(first.rows[0]).toMatchObject({ id: id(4), report_head_id: id(4), revision_id: id(5), legacy_pending: true, source_filename: 'fixture.pdf' });
  s.draft = false;
  expect((await fetchCOReportsPageV2(args)).rows[0].legacy_pending).toBe(false);
  const second = await fetchCOReportsPageV2({ ...args, p_status: 'posted', p_page: 2 });
  expect(second.total).toBe('1'); expect(second.rows).toEqual([]); expect(second.page).toBe(2);
  for (const filter of [{ p_customer_id: id(9) }, { p_month: '2026-08-01' }, { p_status: 'historical_pending' }]) {
    const result = await fetchCOReportsPageV2({ ...args, ...filter });
    expect(result.total).toBe('0'); expect(result.rows).toEqual([]);
  }
});

test('V2 truly absent report has no draft or posted row and sends no command', async () => {
  const s = store(); s.draft = false;
  const empty = await fetchCOReportsPageV2({ ...args, p_customer_id: null, p_month: null });
  expect(empty.total).toBe('0'); expect(empty.rows).toEqual([]); expect(s.commands).toEqual([]);
});
