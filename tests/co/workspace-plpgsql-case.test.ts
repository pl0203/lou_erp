// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const sql = readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql','utf8')
// PostgreSQL 17.11 CI rejected the inner THEN as the end of a PL/pgSQL IF
// expression (42601). Parentheses keep CASE as one SQL expression.
test('prepare evidence MIME comparison delimits the CASE expression inside IF', () => {
 expect(sql.split('\n').find(line=>line.includes('e.mime_type IS DISTINCT FROM'))).toContain("e.mime_type IS DISTINCT FROM (CASE m->'input'->'extracted'->>'format' WHEN 'pdf' THEN 'application/pdf' WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' END) THEN RAISE EXCEPTION 'Import evidence source mismatch' USING ERRCODE='22023'")
})
test('commit mode comparison keeps its CASE inside the existing stale-preview IF', () => {
 expect(sql.split('\n').find(line=>line.includes("p_payload->>'mode' IS DISTINCT FROM"))).toContain("p_payload->>'mode' IS DISTINCT FROM (CASE op WHEN 'post_report' THEN 'post' ELSE 'edit' END) OR p_payload->'reason' IS DISTINCT FROM m.canonical_json->'input'->'reason' THEN RAISE EXCEPTION 'CO_PREVIEW_STALE' USING ERRCODE='PT409'")
 expect(sql).not.toMatch(/IS DISTINCT FROM CASE/)
})
