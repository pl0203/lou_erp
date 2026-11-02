import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read=(name:string)=>{const path=`supabase/catalogue/v2/${name}.sql`;return existsSync(path)?readFileSync(path,'utf8'):''}
describe('additive Tipe SQL proposal boundaries (not runtime authorization proof)',()=>{
 it('negotiates v2 read shape without replacing v1 or its RLS-invoker path',()=>{
  const sql=read('product-type-reads');expect(sql).toContain('public.pilot_catalog_page_v2(');expect(sql).toContain('SECURITY INVOKER');expect(sql).toContain("'version', 2");expect(sql).toContain("'product_type', p.product_type");expect(sql).not.toContain('CREATE FUNCTION public.pilot_catalog_page_v1');
 })
 it('domains v2 fingerprints while retaining shared request serialization and live authority helpers',()=>{
  const sql=read('product-type-writes');expect(sql).toContain("jsonb_build_array('catalogue-product-v2',p_operation,p_payload)");expect(sql).toContain("'catalog_request_v1:'");expect(sql).toContain('private.catalog_assert_write_policy_v1(target_kind)');expect(sql).not.toContain('CREATE FUNCTION private.catalog_assert_write_policy_v1');expect(sql).toContain('product.depo_bangunan,NULL,product.product_type');
 })
 it('rejects fresh legacy creates only after exact committed replay recognition',()=>{
  const sql=read('product-type-legacy-guard');expect(sql.indexOf('RETURN prior.receipt;')).toBeGreaterThan(0);expect(sql.indexOf("DETAIL='CATALOG_TYPE_REQUIRED' ")).toBeGreaterThan(sql.indexOf('RETURN prior.receipt;'));expect(sql).toContain("old_row->>'product_type' IS NULL");expect(sql).toContain('CREATE OR REPLACE FUNCTION public.pilot_catalog_transaction_v1');expect(sql).not.toContain('CREATE FUNCTION private.');
 })
})
