import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { verifyScaleConnectionTarget } from './verify-scale-target.mjs'
import { sanitizeConnectionEnv } from '../tests/scalability/measure-reads.mjs'

/** Every bootstrap/load/check uses the same validated, allowlisted connection environment. */
export function runDisposableSql(file, { env = process.env, execute = execFileSync } = {}) {
  if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('A SQL file is required')
  const connection = sanitizeConnectionEnv(env)
  verifyScaleConnectionTarget({ host: connection.PGHOST, database: connection.PGDATABASE, permit: env.SCALE_PERMIT, rows: Number(env.SCALE_ROWS) })
  return execute('psql', ['-X', '--no-password', '--set=ON_ERROR_STOP=1', `--file=${file}`], {
    env: connection, stdio: 'inherit', timeout: (file === 'tests/database/scalable-pooled-reads.sql' ? (Number(env.SCALE_ROWS) === 30000 ? 40 : 18) : 15) * 60 * 1000, shell: false,
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--file') throw new Error('Use --file only')
    runDisposableSql(process.argv[3])
  } catch {
    process.stderr.write('Disposable SQL execution refused or failed. Check the explicit local target, permit, fixture and SQL log.\n')
    process.exitCode = 1
  }
}
