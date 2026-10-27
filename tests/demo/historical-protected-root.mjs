// Historical demo-release checkpoint ONLY, never a current CO rollout baseline.
// Three original snapshots are exact bytes from reviewed BASE
// 5e99f7792e47658ce70ddd8b269df61fd843be3a. The 24 additional snapshots use
// surrogate pre-UI 5c8d851dd855bfaab3665a093c82860e9da952c6 bytes that
// independently match the same immutable old manifest hashes.
// Four leave-reader snapshots are exact bytes from reviewed baseline
// 5a37760e664e87dbb7be3dd1cf26e01468cefe27 and match the immutable pins.
// Three authority snapshots are exact 6fa941 Git object bytes, independently
// verified against unchanged manifest SHA-256 pins during recovery.
// No Git lookup, hash regeneration, arbitrary fallback, network or DB activity.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_MIGRATIONS } from '../../scripts/build-demo-rollout.mjs'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const snapshots = new Map([
  ['src/lib/leave/queryKeys.ts', 'queryKeys.ts.snapshot'],
  ['src/lib/leave/useLeaveContext.ts', 'useLeaveContext.ts.snapshot'],
  ['src/lib/leave/useOwnRequestAuthority.ts', 'useOwnRequestAuthority.ts.snapshot'],

  ['src/lib/leave/readContracts.ts', 'readContracts.ts.snapshot'],
  ['src/lib/leave/readQueryKeys.ts', 'readQueryKeys.ts.snapshot'],
  ['src/lib/leave/readRpc.ts', 'readRpc.ts.snapshot'],
  ['src/lib/leave/useLeaveReads.ts', 'useLeaveReads.ts.snapshot'],
  ['src/lib/AuthContext.tsx', 'AuthContext.tsx.snapshot'],
  ['src/pages/ihr/LeaveManagement.tsx', 'LeaveManagement.tsx.snapshot'],
  ['src/pages/ihr/UserManagement.tsx', 'UserManagement.tsx.snapshot'],
  ['src/pages/ForgotPassword.tsx', 'ForgotPassword.tsx.snapshot'],
  ['src/pages/ResetPassword.tsx', 'ResetPassword.tsx.snapshot'],
  ['src/pages/ihr/leave/AssignedApprovalInbox.tsx', 'AssignedApprovalInbox.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveAccessSettings.tsx', 'LeaveAccessSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveAdminPrivatePanel.tsx', 'LeaveAdminPrivatePanel.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveAdminRotaPanel.tsx', 'LeaveAdminRotaPanel.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveAdminSettings.tsx', 'LeaveAdminSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveAdminWritePanels.tsx', 'LeaveAdminWritePanels.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveAdministration.tsx', 'LeaveAdministration.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveApprovalBadge.tsx', 'LeaveApprovalBadge.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveBalanceSettings.tsx', 'LeaveBalanceSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveGovernanceSettings.tsx', 'LeaveGovernanceSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeavePeopleSettings.tsx', 'LeavePeopleSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeavePolicySettings.tsx', 'LeavePolicySettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveReassignmentSettings.tsx', 'LeaveReassignmentSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveRequestForm.tsx', 'LeaveRequestForm.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveRotaSettings.tsx', 'LeaveRotaSettings.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveSetupImpacts.tsx', 'LeaveSetupImpacts.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveSetupStatus.tsx', 'LeaveSetupStatus.tsx.snapshot'],
  ['src/pages/ihr/leave/LeaveTabs.tsx', 'LeaveTabs.tsx.snapshot'],
  ['src/pages/ihr/leave/MyLeave.tsx', 'MyLeave.tsx.snapshot'],
  ['src/pages/ihr/leave/OwnLeaveHistory.tsx', 'OwnLeaveHistory.tsx.snapshot'],
  ['src/pages/ihr/leave/OwnRequestActions.tsx', 'OwnRequestActions.tsx.snapshot'],
  ['src/pages/ihr/leave/TeamLeaveCalendar.tsx', 'TeamLeaveCalendar.tsx.snapshot'],
])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function createHistoricalProtectedRoot() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'scripts/demo-rollout-protected-sources.json'), 'utf8'))
  assert.equal(manifest.sources.length, 81, 'Exact historical protected source inventory required')
  const root = mkdtempSync(join(tmpdir(), 'demo-historical-checkpoint-'))
  const cleanup = () => rmSync(root, { recursive: true, force: true })
  try {
    for (const source of manifest.sources) {
      const snapshot = snapshots.get(source.path)
      const bytes = readFileSync(snapshot ? new URL(`./fixtures/historical-protected/${snapshot}`, import.meta.url) : join(repoRoot, source.path))
      assert.equal(sha256(bytes), source.sha256, `Historical protected source drift: ${source.path}`)
      const destination = join(root, source.path)
      mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, bytes)
    }
    for (const path of DEMO_MIGRATIONS) {
      const destination = join(root, path)
      mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, readFileSync(join(repoRoot, path)))
    }
    return { root, cleanup }
  } catch (error) { cleanup(); throw error }
}
