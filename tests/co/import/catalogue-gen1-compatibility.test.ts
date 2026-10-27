// @vitest-environment node
// Authored integration contracts. PostgreSQL composed tests remain authoritative.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
const sql = readFileSync('supabase/candidates/co-workspace-redesign/20261026100000_co_import_manifest.sql', 'utf8');
const body = (name: string) => sql.split(`CREATE FUNCTION ${name}`)[1]?.split('END $$;')[0] ?? '';
test('workspace generation guard distinguishes bare from complete gen1 and locks admission', () => {
 const guard = body('private.co_workspace_generation_guard_v1');
 expect(guard).toContain("to_regclass('private.catalog_cutover_v1')");
 expect(guard).toContain('Partial catalogue workspace profile');
 expect(guard).toContain('INTO STRICT generation');
 expect(guard).toContain('WHERE singleton FOR SHARE');
 expect(guard).toContain('generation IS DISTINCT FROM 1');
 expect(guard).toContain('CO_WORKSPACE_GENERATION_UNSUPPORTED');
});
test('only generation-one inner registration and dispatch hooks are selected', () => {
 expect(sql).toContain("'private.catalog_evidence_legacy_v1(uuid,text,jsonb)'");
 expect(sql).toContain("'private.catalog_co_legacy_transaction_v1(uuid,text,jsonb)'");
 const hooks = sql.split('DO $import_publication_guards$')[1]?.split('END $import_publication_guards$;')[0];
 expect(hooks).toContain('CASE WHEN');
 expect(hooks).not.toContain('catalog_co_dispatch_v2');
 expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION (?:public\.pilot_co_transaction_v1|public\.pilot_co_evidence_transaction_v1|public\.pilot_co_evidence_attest_v1|private\.catalog_co_.*_v2)/);
});
test('fresh workspace mutations guard after immutable replay and before customer locks', () => {
 for (const name of ['public.pilot_co_import_prepare_v1', 'public.pilot_co_import_review_v1', 'public.pilot_co_import_commit_v1']) {
  const source = body(name), guard = source.indexOf('PERFORM private.co_workspace_generation_guard_v1();');
  expect(guard).toBeGreaterThan(source.indexOf('RETURN '));
  expect(guard).toBeLessThan(source.indexOf('private.co_lock_customer_v1'));
 }
 expect(body('public.pilot_co_declare_stock_key_unit_v1')).toContain('IF r IS NOT NULL THEN RETURN r; END IF;\n PERFORM private.co_workspace_generation_guard_v1();');
});
test('original import linkage and new manual attestation cannot slip through unsupported generation', () => {
 const link = sql.split('CREATE OR REPLACE FUNCTION private.co_link_import_v1')[1]?.split('END $$;')[0] ?? '';
 expect(link.match(/PERFORM private.co_workspace_generation_guard_v1\(\)/g)).toHaveLength(2);
 expect(body('public.pilot_co_evidence_manual_workbook_attest_v1')).toContain('IF NOT EXISTS(SELECT 1 FROM private.co_evidence_manual_workbook_checks WHERE evidence_id=e.id) THEN\n  PERFORM private.co_workspace_generation_guard_v1();');
});
test('workspace begin keeps canonical existing receipt handling before fresh admission and pending insert', () => {
 const source = body('private.co_workspace_command_begin_v1');
 expect(source).toContain("pg_advisory_xact_lock(hashtextextended('co-command:'");
 const replay = source.indexOf('RETURN private.co_command_begin_v1');
 const guard = source.indexOf('PERFORM private.co_workspace_generation_guard_v1');
 expect(replay).toBeGreaterThan(0); expect(guard).toBeGreaterThan(replay);
 expect(source.lastIndexOf('RETURN private.co_command_begin_v1')).toBeGreaterThan(guard);
 expect(source).not.toContain('INSERT INTO');
});
test('manual service attestation honors installed HR gate and refuses partial employee profiles', () => {
 const source = body('public.pilot_co_evidence_manual_workbook_attest_v1');
 expect(source).toContain("EXECUTE 'SELECT private.employee_account_allowed($1)' INTO account_allowed USING p_actor_id");
 expect(source).toContain('account_allowed IS DISTINCT FROM true');
 expect(source).toContain('Incomplete employee account authority');
 expect(source.indexOf('employee_account_allowed')).toBeLessThan(source.indexOf('SELECT * INTO e'));
 expect(source.indexOf('pg_advisory_xact_lock')).toBeLessThan(source.indexOf('PERFORM private.co_workspace_generation_guard_v1'));
 expect(source.indexOf('PERFORM private.co_workspace_generation_guard_v1')).toBeLessThan(source.indexOf('SELECT version INTO cv'));
});
test('current hook preimages pin complete authored bodies and portable metadata before mutation', async () => {
 const { createHash } = await import('node:crypto');
 const pins = sql.split('DO $workspace_current_preimages$')[1]?.split('END $workspace_current_preimages$;')[0] ?? '';
 for (const [path, name] of [
  ['supabase/catalogue/v1/new06-co-order-boundaries.sql', 'catalog_co_legacy_transaction_v1'],
  ['supabase/catalogue/v1/new07-lifetime-admission.sql', 'catalog_evidence_legacy_v1'],
 ]) {
  const source = readFileSync(path, 'utf8').split(`CREATE FUNCTION private.${name}(`)[1].split('AS $$')[1].split('$$;')[0];
  expect(pins).toContain(createHash('sha256').update(source).digest('hex'));
 }
 const monthly = readFileSync('supabase/migrations/20261009110004_co_returns_corrections.sql', 'utf8')
  .split('CREATE OR REPLACE FUNCTION private.co_monthly_transaction_v1(')[1].split('AS $$')[1].split('$$;')[0];
 const evidenceAnchor = '   g:=private.co_materialize_generation_v1(c,v+1,actor,plan,revision,line_ids);';
 const linkedMonthly = monthly.replace(evidenceAnchor, '   PERFORM private.co_link_evidence_v1(c,head,revision,d.id,d.version);\n' + evidenceAnchor);
 const monthlyHash = createHash('sha256').update(linkedMonthly).digest('hex');
 expect(monthlyHash).toBe('0442408fd2b5cee0326495e155f75f62ae96a30bd02e1888fcebdb3204ddf61f');
 expect(pins).toContain(monthlyHash);
 expect(pins).toContain('semantic_meta IS DISTINCT FROM reviewed_meta');
 expect(pins).toContain('aclexplode(coalesce(p.proacl,acldefault');
 expect(sql.indexOf('DO $workspace_current_preimages$')).toBeLessThan(sql.indexOf('DO $xlsx_registration$'));
});
