import { it, expect } from 'vitest';
import { decodeUnitDeclaration, decodeUnitReceipt, decodeStockKeyUnits } from '../../../src/lib/co/import/units';
const id = '11111111-1111-1111-1111-111111111111', key = '22222222-2222-2222-2222-222222222222';
it('requires explicit first declaration with exact existing counter provenance', () => { const p = { customer_id: id, stock_key_id: key, expected_customer_version: '2', expected_unit_version: null, unit: 'PCS', reason: 'Confirmed existing counter', confirmed: true }; expect(decodeUnitDeclaration(p)).toEqual(p); for (const change of [{ confirmed: false }, { expected_unit_version: '1' }, { unit: ' PCS ' }, { reason: '' }, { conversion: { numerator: '12' } }])
    expect(() => decodeUnitDeclaration({ ...p, ...change })).toThrow(); });
it('keeps unit command receipts exactly five fields and a distinct operation', () => { const r = { id, operation: 'declare_stock_key_unit', version: '1', customer_id: id, customer_version: '3' }; expect(decodeUnitReceipt(r)).toEqual(r); for (const change of [{ operation: 'post_report' }, { version: '2' }, { unit: 'PCS' }])
    expect(() => decodeUnitReceipt({ ...r, ...change })).toThrow(); });
it('unknown means no declaration; declared units retain timestamp and author provenance', () => { const row = { customerId: id, stockKeyId: key, state: 'unknown', declaration: null }, value = { customerVersion: '2', rows: [row] }; expect(decodeStockKeyUnits(value, id, [key], '2')).toEqual(value); const declaration = { id, version: '1', unit: 'PCS', declaredBy: id, declaredAt: '2026-10-26T10:00:00Z', reason: 'Confirmed existing counter' }; expect(decodeStockKeyUnits({ ...value, rows: [{ ...row, state: 'declared', declaration }] }, id, [key], '2').rows[0].state).toBe('declared'); expect(() => decodeStockKeyUnits({ ...value, rows: [{ ...row, declaration }] }, id, [key], '2')).toThrow(); expect(() => decodeStockKeyUnits(value, id, [id], '2')).toThrow(); expect(() => decodeStockKeyUnits(value, id, [key], '3')).toThrow(); });
it('rejects sparse or accessor-bearing read arrays without evaluating getters', () => { const rows: any[] = [{ customerId: id, stockKeyId: key, state: 'unknown', declaration: null }]; let called = false; Object.defineProperty(rows, '0', { get() { called = true; return { customerId: id, stockKeyId: key, state: 'unknown', declaration: null }; }, enumerable: true }); expect(() => decodeStockKeyUnits({ customerVersion: '2', rows }, id, [key], '2')).toThrow(); expect(called).toBe(false); const keys: string[] = new Array(1); expect(() => decodeStockKeyUnits({ customerVersion: '2', rows: [] }, id, keys, '2')).toThrow(); });
it('validates requested-key descriptors before Set iteration', () => { let called = false; const keys = [key]; Object.defineProperty(keys, '0', { get() { called = true; return key; }, enumerable: true }); expect(() => decodeStockKeyUnits({ customerVersion: '2', rows: [] }, id, keys, '2')).toThrow(); expect(called).toBe(false); });
it.each([
    ['64 supplementary characters', '😀'.repeat(64), 'reason', true],
    ['65 supplementary characters', '😀'.repeat(65), 'reason', false],
    ['full reason length overflow', 'PCS', ' '.repeat(2000) + 'x', false],
    ['full reason boundary', 'PCS', ' '.repeat(1999) + 'x', true],
    ['NBSP unit', '\u00a0', 'reason', false],
    ['NBSP unit padding', '\u00a0PCS', 'reason', false],
    ['tab-only reason', 'PCS', '\t', false],
    ['BOM-only reason', 'PCS', '\ufeff', false],
    ['unpaired surrogate', 'PCS', '\ud800', false],
])('shared immutable unit domain: %s', (_name, unit, reason, accepted) => { const p = { customer_id: id, stock_key_id: key, expected_customer_version: '2', expected_unit_version: null, unit, reason, confirmed: true }; if (accepted)
    expect(decodeUnitDeclaration(p)).toEqual(p);
else
    expect(() => decodeUnitDeclaration(p)).toThrow(); });
