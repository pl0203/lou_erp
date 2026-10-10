# Historical demo-release frontend snapshots

These three inert `.snapshot` files preserve the original demo packet's protected-source checkpoint. They are exact bytes extracted locally from reviewed CO Task 7 BASE `5e99f7792e47658ce70ddd8b269df61fd843be3a`, already matching the immutable `scripts/demo-rollout-protected-sources.json` hashes:

- `src/lib/AuthContext.tsx`: `6c0d5690bdff04c03fd62d6516c441472873f9923df92e49d1e007c4d60f3295`
- `src/pages/ihr/LeaveManagement.tsx`: `52bae629481aa62dfad5ee0ad9ffe98d4edc5efc057e4f8d6cb6de00269ba310`
- `src/pages/ihr/UserManagement.tsx`: `c794d3c6c4cb5fa77bfa8ddd2b3cc62fd04b36a665a89e1eadd88c10d6343d14`

The manifest's older upstream object is unavailable in this checkout; the exact reviewed BASE bytes satisfy the existing pins. No fallback Git lookup occurs in tests. `historical-protected-root.mjs` verifies all 81 protected hashes (these three snapshots plus 78 current unchanged files), and copies the current four pinned SQL sources into a disposable root. Existing packet tests then exercise the unchanged production builder at its historical checkpoint. The builder still refuses the present CO tree. These files are not runtime code and are not current CO rollout evidence.
