// @vitest-environment node
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
test('bounds generation-specific allocation/source links before historical display joins', () => {
  const migration = readFileSync('supabase/migrations/20261009110005_co_reads.sql', 'utf8');
  const helper = migration.split('CREATE FUNCTION private.co_read_allocations_v1')[1].split('CREATE FUNCTION public.pilot_co_report_allocations_v1')[0];
  expect(helper).toContain('WITH selected AS MATERIALIZED');
  const selected = helper.split('WITH selected AS MATERIALIZED')[1].split('SELECT jsonb_build_object')[0];
  expect(selected).toContain('m.generation_id=g');
  expect(selected).toContain('a.customer_id=c AND a.report_revision_id=r AND a.generation_id=g');
  expect(selected).toContain('m.delivery_revision_line_id');
  expect(selected).not.toContain('JOIN private.co_delivery_revision_lines');
  expect(helper).toContain('JOIN private.co_delivery_revision_lines dl ON dl.id=a.delivery_revision_line_id');
  expect(helper).not.toMatch(/\bLIMIT\b|\bDISTINCT\b|current_revision_id/);
});
