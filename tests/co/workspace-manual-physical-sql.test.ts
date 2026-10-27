// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
const sql=readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql','utf8')
const body=sql.split('CREATE FUNCTION private.co_manual_workbook_physical_v1(')[1].split('END $$;')[0]
test('manual physical reference loop does not shadow SQL source-row aliases',()=>{
 expect(body.split('BEGIN')[0]).not.toMatch(/\br jsonb\b/)
 expect(body).toContain('FOR physical_ref IN SELECT value FROM jsonb_array_elements(refs) LOOP')
 expect(body).toContain("physical_ref->>'fileSha256' IS DISTINCT FROM source->>'sha256'")
 expect(body).toContain("s->>'name'=physical_ref->>'sheet' AND 'r'||(n#>>'{}')=physical_ref->>'row'")
 expect(body).toContain("jsonb_agg(r),'[]') INTO control_rows FROM jsonb_array_elements(source->'sourceRows') r WHERE control->'rowIds'?(r->>'id')")
 expect(body).toContain("FROM jsonb_array_elements(control_rows) r WHERE r->'ref'->>'sheet' IS DISTINCT FROM control->'ref'->>'sheet'")
 expect(body).toContain("RAISE EXCEPTION 'Unattested manual physical reference' USING ERRCODE='22023'")
 expect(body).toContain("RAISE EXCEPTION 'Manual control explicit coverage mismatch' USING ERRCODE='22023'")
})
