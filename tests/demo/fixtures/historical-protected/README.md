# Historical demo-release frontend snapshots

These 27 inert `.snapshot` files preserve the original demo packet's protected-source checkpoint. They are test data, not runtime code or current rollout evidence. Every snapshot is checked against its existing immutable `scripts/demo-rollout-protected-sources.json` SHA-256 before the helper copies it.

## Original three snapshots

The original three snapshots preserve exact bytes previously extracted locally from reviewed CO Task 7 BASE `5e99f7792e47658ce70ddd8b269df61fd843be3a`, matching the old pins:

- `src/lib/AuthContext.tsx`: `6c0d5690bdff04c03fd62d6516c441472873f9923df92e49d1e007c4d60f3295`
- `src/pages/ihr/LeaveManagement.tsx`: `52bae629481aa62dfad5ee0ad9ffe98d4edc5efc057e4f8d6cb6de00269ba310`
- `src/pages/ihr/UserManagement.tsx`: `c794d3c6c4cb5fa77bfa8ddd2b3cc62fd04b36a665a89e1eadd88c10d6343d14`

## Additional 24 pre-UI snapshots

Approved HR/authentication presentation changes made 24 more current files diverge from the historical pins. Their snapshot bytes were extracted locally from available pre-UI commit `5c8d851dd855bfaab3665a093c82860e9da952c6`. This commit is a surrogate source: each blob independently and exactly matches its corresponding unchanged historical manifest SHA-256. The manifest's older upstream object is unavailable in this checkout; no claim is made that it was fetched or reconstructed.

- `src/pages/ForgotPassword.tsx`: `abca16ccf7885f8508626693bf08c94bec3c0a4e3979be54f2f3d102233877de`
- `src/pages/ResetPassword.tsx`: `ef8f5aa5e5b074e8d7193d1ea9cde15489e2cf00db5c070dcbb8d3f81b2a5a98`
- `src/pages/ihr/leave/AssignedApprovalInbox.tsx`: `f1e697a3ff6676d725434381812a6119a10ac6cffbf073fa6206f7c87d07b4b5`
- `src/pages/ihr/leave/LeaveAccessSettings.tsx`: `f9bc0b3563cce5f93c7d14d91c30a120abe5f2d3b2de07170d9aa36a0b551b4b`
- `src/pages/ihr/leave/LeaveAdminPrivatePanel.tsx`: `608b9b593a716aa8501d1cda22405ccd9fae13695243db247e5be8e80d04a004`
- `src/pages/ihr/leave/LeaveAdminRotaPanel.tsx`: `5216f0c1aad10c7fbad1737519d97b13be8b58badaf460a4988c01195a49521f`
- `src/pages/ihr/leave/LeaveAdminSettings.tsx`: `8eb282d3795341e781969148b4f0f506a73a5c591d511f13113507a12ab523a2`
- `src/pages/ihr/leave/LeaveAdminWritePanels.tsx`: `c90b30bf5d09a20864f32fcba33c98484c7aaf474c3864ab470077570e73a398`
- `src/pages/ihr/leave/LeaveAdministration.tsx`: `b00435a73c6432ae2fb2cd6ae66e3d12c010f33412a3938a8aad79d7589c1f36`
- `src/pages/ihr/leave/LeaveApprovalBadge.tsx`: `4b0513b064d66faea3a589bf700ee2fadbf183b6e8180c739e0563c389907039`
- `src/pages/ihr/leave/LeaveBalanceSettings.tsx`: `1c799ddd791a6a2d90c733cf337b85b38def889741bafe931afcb93352bea263`
- `src/pages/ihr/leave/LeaveGovernanceSettings.tsx`: `6e6215e54ebb07b9b61d5ba6c4d3818a9a56ab16537ed530c242e7eb861f4824`
- `src/pages/ihr/leave/LeavePeopleSettings.tsx`: `348a4b70f749ad630165adb16f8a911ae7915979a5f6d5449d34294ca04f0fb4`
- `src/pages/ihr/leave/LeavePolicySettings.tsx`: `ea1c94f64bcbc592880049416ba6d6029b25d36e324403eaeb9b85b76741eeb3`
- `src/pages/ihr/leave/LeaveReassignmentSettings.tsx`: `8cb71170a4def65ba8d0eb8924388c9b6d777fd0fcbe733d0d0114192992afe0`
- `src/pages/ihr/leave/LeaveRequestForm.tsx`: `c6fb66e5f98b4a4f173c6af9dd799992880b682f34f07ab1aad05e8c796ee0f0`
- `src/pages/ihr/leave/LeaveRotaSettings.tsx`: `5e5f457a58fd06d982b69b9a2dfaee9aa43a16a15b3b0a195e8786187b021282`
- `src/pages/ihr/leave/LeaveSetupImpacts.tsx`: `bd7bcf036482b5934797619ed4f139f09a7276a41b7c848ae7b8131b8c1e34d0`
- `src/pages/ihr/leave/LeaveSetupStatus.tsx`: `ade6e27f5a6da1eafd26d5ae99542759e2bd7a65941b56d4a87aec7ccf9516ec`
- `src/pages/ihr/leave/LeaveTabs.tsx`: `17aa698d598a955e1785783c240504a700684e86531093e276f287efa931f15d`
- `src/pages/ihr/leave/MyLeave.tsx`: `e1bcd65fb3f14e97f10279f2494391019a58fa5b5d7538ceed9668bf88c1e0ae`
- `src/pages/ihr/leave/OwnLeaveHistory.tsx`: `25116c0f98cd6e61306ab4c5cb6720b7197ddadf9dac8925df345f60c5e5ae72`
- `src/pages/ihr/leave/OwnRequestActions.tsx`: `2d476e264fdc553d0b96c44b3a51811d3642aeb08021228a5ce16d945e8240f5`
- `src/pages/ihr/leave/TeamLeaveCalendar.tsx`: `02edb29358e06f3dd74807cab7b9ca9d7e3a13b38c06fee944a5f6993e473ca0`

## Fail-closed use

`historical-protected-root.mjs` uses only an explicit, bounded path-to-snapshot map. It verifies all 81 protected hashes: 27 pinned snapshots plus 54 unchanged current files. The helper also copies the current four pinned SQL sources into a disposable root, preserving successful cleanup and cleanup on error. Existing packet tests independently verify those four migration pins and exercise the unchanged production builder at its historical checkpoint.

There is no dynamic fallback, runtime Git lookup, network access, database activity, ignored mismatch, or automatic repinning. A mapped missing or altered snapshot fails even when the current source matches the old pin. The immutable source manifest, production builder and SQL remain unchanged. The production builder still rejects the present frontend tree, as the rollout-guard regression verifies. These snapshots do not establish current CO or UI rollout readiness.
