// Real retained source-correction owner. Never recreates the removed primary monthly editor.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import COCorrectionDialog from '../../src/components/co/COCorrectionDialog';
import { useCOTransactionSender } from '../../src/lib/co/transactions';
import { mount, wire, customer, month, id } from './report-ui-harness';
export function NestedReportCorrection() {
  const sender = useCOTransactionSender({ formScope: 'nested-report-acceptance', customerId: customer });
  return <COCorrectionDialog operation="correct_sj" customerId={customer}
    source={{ customer_id: customer, expected_customer_version: '1', co_id: id(10), expected_co_version: '1', delivery_head_id: id(12), original_revision_id: id(13), expected_delivery_version: '1', action: 'void' }}
    sender={sender} current={() => wire.actor} onAccepted={async () => true} onClose={() => {}} returnFocus={null}/>;
}
export async function mountNestedReport(s: any) {
  s.impacts.missing_month = [{ report_month: month, reason: 'missing', head_id: null, coverage_through_date: null }];
  const view = mount(<NestedReportCorrection />);
  fireEvent.change(await screen.findByLabelText('Alasan perubahan'), { target: { value: 'Correct original delivery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tinjau semua dampak' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Lengkapi periode 2026-09' }));
  const initialize = await screen.findByRole('button', { name: 'Perbarui periode terhadap sumber usulan' });
  await waitFor(() => expect((initialize as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(initialize);
  await screen.findByLabelText('Terjual Item 1');
  return view;
}
