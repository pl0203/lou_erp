import { parseMoney, minorUnits, parseEnteredQuantity, invalid } from './validation';
import type { Money } from './contracts';
import { PRICE_TIERS } from '../catalogPricing';
export function parseCOUnitPrice(value: unknown): Money { const amount = parseMoney(value); if (minorUnits(amount) > 99999999999999n)
    invalid('unit price'); return amount; }
export function parseCOPriceInput(raw: string): Money | null { return raw.trim() === '' ? null : parseCOUnitPrice(raw.trim()); }
export function formatCOMinorUnits(value: bigint): Money { if (value < 0n)
    invalid('negative amount'); return `${value / 100n}.${String(value % 100n).padStart(2, '0')}` as Money; }
export function coLineAmount(quantity: number, price: Money): Money { return formatCOMinorUnits(BigInt(parseEnteredQuantity(quantity, true)) * minorUnits(parseCOUnitPrice(price))); }
export function coPlannedAmount(lines: readonly {
    quantity: number;
    unit_price: Money | null;
}[]): Money | null { let total = 0n; for (const line of lines) {
    if (line.unit_price === null)
        return null;
    total += minorUnits(coLineAmount(line.quantity, line.unit_price));
} return formatCOMinorUnits(total); }
/** Existing catalog numeric values are checked before their decimal representation is used. No tier fallback. */
export function resolveCOCatalogPrice(prices: Record<string, unknown> | null | undefined, tier: string | null | undefined): Money | null { if (!tier || !PRICE_TIERS.includes(tier as typeof PRICE_TIERS[number]))
    return null; const v = prices?.[tier]; if (v == null)
    return null; if (typeof v === 'number') {
    if (!Number.isFinite(v))
        invalid('catalog price');
    return parseCOUnitPrice(String(v));
} return parseCOUnitPrice(v); }
import { supabase } from '../supabase';
import { readCompleteQuery } from '../reads/completeQuery';
import { parseUUID, parseText, nullable, oneOf } from './validation';
import type { COReadOptions } from './rpc';
export type COCustomerOption = {
    id: string;
    name: string;
    pricing_tier: string;
};
export type COCatalogOption = {
    id: string;
    name: string;
    sku: string;
    size: string | null;
} & Record<typeof PRICE_TIERS[number], Money | null>;
function current(options: COReadOptions) { options.signal?.throwIfAborted(); if (options.isCurrent && !options.isCurrent())
    invalid('catalog identity'); }
/** Existing RLS-authorized master reads only; no CO private tables or master writes. */
export async function fetchCOCustomers(options: COReadOptions = {}): Promise<COCustomerOption[]> { current(options); const rows = await readCompleteQuery<COCustomerOption>((offset, limit) => supabase.from('customers').select('id,name,pricing_tier', { count: 'exact' }).order('id').range(offset, offset + limit - 1), r => r.id, options.signal); current(options); return rows.map(r => ({ id: parseUUID(r.id), name: parseText(r.name), pricing_tier: oneOf([...PRICE_TIERS, 'others'])(r.pricing_tier) })).sort((a, b) => a.name.localeCompare(b.name)); }
export async function fetchCOCatalog(options: COReadOptions = {}): Promise<COCatalogOption[]> { current(options); const rows = await readCompleteQuery<Record<string, any>>((offset, limit) => supabase.from('products').select('id,name,sku,size,harga_pokok,luar_kota,dalam_kota,depo_bangunan', { count: 'exact' }).order('id').range(offset, offset + limit - 1), r => r.id, options.signal); current(options); return rows.map(r => ({ id: parseUUID(r.id), name: parseText(r.name), sku: parseText(r.sku), size: nullable(parseText)(r.size), ...Object.fromEntries(PRICE_TIERS.map(tier => [tier, resolveCOCatalogPrice(r, tier)])) } as COCatalogOption)).sort((a, b) => a.name.localeCompare(b.name)); }
