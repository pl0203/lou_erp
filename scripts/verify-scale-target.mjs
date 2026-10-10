/** Safety preflight for disposable local CI only. Hosted targets require a separate reviewed packet. */
export function verifyScaleConnectionTarget({ host, database, permit, rows }) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Only a loopback disposable PostgreSQL target is allowed')
  if (database !== 'pilot_test') throw new Error('Disposable database pilot_test is required')
  if (permit !== 'disposable-pilot-ci') throw new Error('Explicit disposable-pilot-ci permit is required')
  if (![6000, 30000].includes(rows)) throw new Error('Fixture size must be exactly 6000 or 30000 POs')
}
export function verifyScaleTarget(target) {
  verifyScaleConnectionTarget(target)
  if (target.marker !== 'disposable-pilot-ci') throw new Error('Actual disposable fixture marker is missing')
}
