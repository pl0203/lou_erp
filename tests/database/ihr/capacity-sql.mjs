import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
import { buildCapacityFixture, validateCapacityFixture } from './capacity-fixture.mjs'
export const literal = value => `'${String(value).replaceAll("'", "''")}'`
export function buildCapacitySql(fixture = buildCapacityFixture()) {
  const report = validateCapacityFixture(fixture)
  return `-- FICTIONAL CAPACITY INPUT ${report.materializedInputHash}\nBEGIN;\nSET LOCAL jit=off;\nSELECT set_config('request.jwt.claim.sub','',true);\nDO $$ BEGIN
IF current_user<>'postgres' OR current_database()<>'pilot_test' OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN
RAISE EXCEPTION 'Owned disposable PG17 marker required'; END IF; END $$;\nCREATE TEMP TABLE capacity_input(j jsonb,input_hash text,uuid_hash text) ON COMMIT DROP;\nINSERT INTO capacity_input VALUES(${literal(JSON.stringify(fixture))}::jsonb,${literal(report.materializedInputHash)},${literal(report.fictionalUuidHash)});\n${readFileSync(join(here, 'capacity-materialize.sql'), 'utf8')}\n${readFileSync(join(here, 'capacity-validate.sql'), 'utf8')}\nCOMMIT;\n`
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || !process.argv[2].endsWith('.sql')) throw new Error('Usage: node capacity-sql.mjs <new-local-output.sql>')
  writeFileSync(process.argv[2], buildCapacitySql(), { flag: 'wx' })
}
