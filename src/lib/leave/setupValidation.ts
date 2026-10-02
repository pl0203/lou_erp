import { parseUUID } from './contracts'
import type { SetupBlocker, SetupInput } from './contracts'

/** Request-readiness presentation only; not an organization/real-data enablement gate. */
export function validateLeaveSetup(input: SetupInput): SetupBlocker[] {
  const blockers: SetupBlocker[] = []
  const block = (code: string, message: string, field: keyof SetupInput) => blockers.push({ code, message, field })
  if (input.memberKind === 'director') block('director_excluded', 'Direktur tidak dapat mengajukan cuti dalam kebijakan ini.', 'memberKind')
  else if (input.memberKind !== 'employee' && input.memberKind !== 'manager') block('member_missing', 'Keanggotaan kebijakan cuti belum ditetapkan.', 'memberKind')
  if (input.active !== true) block('member_inactive', 'Keanggotaan cuti tidak aktif.', 'active')
  if (!input.timezone || !input.timezone.trim()) block('timezone_missing', 'Zona waktu organisasi belum ditetapkan.', 'timezone')
  else {
    try { new Intl.DateTimeFormat('id-ID', { timeZone: input.timezone }) }
    catch { block('timezone_invalid', 'Zona waktu organisasi tidak valid.', 'timezone') }
  }
  if (input.annualPolicyConfirmed !== true) block('annual_policy_unconfirmed', 'Kebijakan jatah tahunan belum dikonfirmasi.', 'annualPolicyConfirmed')
  if (input.openingReconciled !== true) block('opening_unreconciled', 'Saldo awal belum direkonsiliasi.', 'openingReconciled')
  if (!input.approverId) block('approver_missing', 'Penyetuju cuti belum ditetapkan.', 'approverId')
  else {
    try { parseUUID(input.approverId) }
    catch { block('approver_invalid', 'Identitas penyetuju cuti tidak valid.', 'approverId') }
  }
  if (input.approverActive !== true) block('approver_inactive', 'Penyetuju cuti tidak aktif.', 'approverActive')
  if (input.hasCalendar !== true) block('calendar_missing', 'Kalender kerja belum tersedia.', 'hasCalendar')
  if (input.hasRosterCoverage !== true) block('roster_coverage_missing', 'Cakupan jadwal kerja belum lengkap.', 'hasRosterCoverage')
  // First-grant policy alone cannot change a blocked cycle into an established one.
  if (input.cycleState !== 'established_calendar') block('first_grant_blocked', 'Pemberian jatah pertama memerlukan aturan dan transisi yang disetujui HR.', 'cycleState')
  if (input.reservePendingAccepted !== true) block('pending_reservation_unaccepted', 'Reservasi saldo untuk permohonan tertunda belum diterima.', 'reservePendingAccepted')
  if (input.singleDateRuleAccepted !== true) block('single_date_rule_unaccepted', 'Aturan satu permohonan aktif per tanggal belum diterima.', 'singleDateRuleAccepted')
  return blockers
}
