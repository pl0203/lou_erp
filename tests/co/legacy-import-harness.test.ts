import { expect, test } from 'vitest';
import { customer, id, month, store } from './report-ui-harness';
import { fetchCOReportImport } from '../../src/lib/co/workspaceReads';
function historicalReport() {
    const s = store();
    s.effective = { ...s.header(), report_head_id: id(4), revision_id: id(5), report_version: '7' };
    return s;
}
test('legacy immutable source fixture decodes with explicit absence, not invented provenance', async () => {
    const s = historicalReport();
    expect(await fetchCOReportImport(customer, month, id(5))).toMatchObject({
        customer_id: customer, report_month: month, revision_id: id(5), report_head_id: id(4), effective_revision_id: id(5),
        report_version: '7', manifest: null, unit_declarations: {}, source_amount: null, currency: null, source_filename: null,
    });
    expect(s.commands).toHaveLength(0);
});
test.each(['customer', 'month', 'revision'])('legacy immutable fixture rejects wrong %s without mutation', async scope => {
    const s = historicalReport();
    await expect(fetchCOReportImport(scope === 'customer' ? id(99) : customer, scope === 'month' ? '2026-08-01' : month, scope === 'revision' ? id(99) : id(5))).rejects.toThrow();
    expect(s.commands).toHaveLength(0);
});
