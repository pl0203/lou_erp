import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const baseline = readFileSync('supabase/migrations/202609300002_order_transactions.sql', 'utf8')
const candidate = () => readFileSync('supabase/migrations/202610010010_nullable_catalog_prices.sql', 'utf8')
const body = (text: string) => text.match(/CREATE(?: OR REPLACE)? FUNCTION public\.pilot_order_transaction\(p_request_id uuid,p_operation text,p_payload jsonb\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/)![1]

describe('catalog pricing migration preserves transactional authority', () => {
  it('changes only the promotional unknown-tier fallback in the existing transaction body', () => {
    const expected = body(baseline).replace('ELSE promo.luar_kota END;', "WHEN 'luar_kota' THEN promo.luar_kota ELSE NULL END;")
    expect(body(candidate())).toBe(expected)
  })
  it('pins the existing function before replacement and preserves authorization metadata', () => {
    const sql = candidate()
    expect(sql).toContain(createHash('md5').update(body(baseline)).digest('hex'))
    expect(sql).toContain('pg_get_function_arguments')
    expect(sql).toContain('proacl')
    expect(sql).toContain('prosecdef')
    expect(sql).toContain('Catalog product data changed')
  })
  it('makes absent catalog prices representable without updating existing products or historical lines', () => {
    const sql = candidate()
    for (const column of ['unit_price', 'harga_pokok', 'luar_kota', 'dalam_kota', 'depo_bangunan']) {
      expect(sql).toContain(`ALTER COLUMN ${column} DROP NOT NULL`)
      expect(sql).toContain(`ALTER COLUMN ${column} DROP DEFAULT`)
    }
    const outsideTransactionFunction = sql.replace(/CREATE OR REPLACE FUNCTION public\.pilot_order_transaction[\s\S]*?\$\$;/, '')
    expect(outsideTransactionFunction).not.toMatch(/\b(?:UPDATE|DELETE FROM|INSERT INTO) public\./i)
    expect(sql).toContain("ALTER TYPE public.pricing_tier ADD VALUE 'others'")
  })
  it('executes the exact migration body against a preexisting-price probe without committing the test', () => {
    execFileSync(process.execPath, ['tests/catalog-pricing-guards.mjs'])
    const packet = readFileSync('scale-results/catalog-pricing-guards.sql', 'utf8')
    expect(packet.match(/^BEGIN;$/gm)).toHaveLength(7)
    expect(packet.match(/^ROLLBACK;$/gm)).toHaveLength(7)
    expect(packet).not.toMatch(/^COMMIT;$/m)
    expect(packet.match(/CATALOG_CONTRACT_DRIFT_REJECTED_/g)).toHaveLength(6)
    expect(packet.indexOf('SYNTH-PRE-MIGRATION-PRICES')).toBeLessThan(packet.indexOf("ALTER TYPE public.pricing_tier ADD VALUE 'others'"))
    expect(packet).toContain(candidate().replace(/^BEGIN;\n/m, '').replace(/\nCOMMIT;\s*$/, ''))
    expect(packet).toContain('CATALOG_EXISTING_VALUES_ROLLBACK_VERIFIED')
  })
})
