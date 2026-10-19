// Fixed dispatch only. No caller-provided paths, scripts or SQL.
import { pathToFileURL } from 'node:url'
import { runCommandRaces, runReportingRaces } from './command-races.mjs'
export function parseConcurrencyArgs(args) {
  if (args.length !== 2 || args[0] !== '--suite' || !['commands','reporting'].includes(args[1])) throw Error('Only --suite commands or reporting is an implemented fixed race target')
  return args[1]
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const suite=parseConcurrencyArgs(process.argv.slice(2)); await (suite==='commands'?runCommandRaces():runReportingRaces()) }
  catch (error) { process.stderr.write(`Employee races refused or failed: ${error.message}\n`); process.exitCode = 1 }
}
