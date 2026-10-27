import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalManifestValue, decodeImportManifest, decodeImportPrepare, decodeImportBinding, manifestDigest } from '../../../src/lib/co/import/manifest';
import { input } from './reviewFixture';
const uuid = '11111111-1111-1111-1111-111111111111';
function manifest() { const review = input(); review.scope.actorId = uuid; review.scope.customerId = uuid; review.mappings[0].stockKeyId = uuid; return { schemaVersion: 1, evidenceId: uuid, input: review, digest: 'a'.repeat(64) }; }
describe('nonempty SQL shape-regression fixture client contract (not SQL execution)', () => {
    function sqlFixture() {
        const sql = readFileSync('tests/database/co/import-manifest.sql', 'utf8');
        const fixture = JSON.parse(sql.split('$nonempty_shape_manifest$')[1]);
        // SQL computes its digest at execution time. This decoder checks shape,
        // not digest authenticity; the placeholder must have the hash wire shape.
        fixture.digest = 'a'.repeat(64);
        return fixture;
    }

    it('preserves nonempty sections, rows and nested optional decisions', () => {
        const fixture = sqlFixture();
        expect(decodeImportManifest(fixture)).toEqual(fixture);
    });

    it.each([
        ['missing section field', (v: any) => { delete v.input.extracted.sections[0].id; }],
        ['extra section field', (v: any) => { v.input.extracted.sections[0].extra = true; }],
        ['non-text row id in second section', (v: any) => { v.input.extracted.sections[1].rowIds[0] = 7; }],
        ['non-array row ids', (v: any) => { v.input.extracted.sections[0].rowIds = 'row-1'; }],
        ['non-text printed-total raw', (v: any) => { v.input.extracted.sections[0].printedTotal.raw = 2; }],
        ['non-text return-link quantity', (v: any) => { v.input.returns[0].links[0].quantity = 1; }],
        ['non-text optional confirmation reason', (v: any) => { v.input.sourceConfirmations[0].reason = false; }],
    ] as const)('rejects %s in the shared fixture', (_name, change) => {
        const fixture = sqlFixture();
        change(fixture);
        expect(() => decodeImportManifest(fixture)).toThrow();
    });
});
describe('immutable manifest wire contract', () => {
    it('preserves original evidence and explicit source confirmations without mutating it', () => { const value = manifest(); value.input.sourceConfirmations = [{ rowId: 'r1', flag: 'formula_cache_requires_confirmation', confirmed: true, reason: 'Checked original' }]; expect(decodeImportManifest(value)).toEqual(value); });
    it.each([
        (v: any) => { v.extra = true; }, (v: any) => { v.input.scope.extra = true; }, (v: any) => { v.input.extracted.sourceRows[0].quantity.decimal = 2; },
        (v: any) => { v.input.extracted.sourceRows[0].transactionDate = '2026-02-30'; }, (v: any) => { v.input.scope.reportMonth = '2026-08-02'; },
        (v: any) => { v.input.mappings[0].quantity = 2; }, (v: any) => { v.input.scope.actorId = 'actor'; }, (v: any) => { v.digest = 'ABC'; },
        (v: any) => { v.input.completenessConfirmed = 'true'; }, (v: any) => { delete v.input.extracted.sourceRows[0].returned; },
        (v: any) => { v.input.sourceConfirmations = [{ rowId: 'r1', flag: 'anything', confirmed: true, reason: 'no' }]; },
    ])('rejects malformed/extra/missing fields', change => { const value = manifest(); change(value); expect(() => decodeImportManifest(value)).toThrow(); });
    it('permits unresolved source evidence but not invented numeric values', () => { const v = manifest(); v.input.extracted.sourceRows[0].quantity = { raw: '?', decimal: null }; expect(decodeImportManifest(v).input.extracted.sourceRows[0].quantity.decimal).toBeNull(); });
    it('requires explicit per-link physical return confirmation, not sale date inference', () => { const v: any = manifest(); v.input.returns = [{ rowId: 'r1', state: 'linked', links: [{ returnRevisionId: uuid, quantity: '1' }], stockImpact: 'clear', note: '' }]; expect(() => decodeImportManifest(v)).toThrow(); v.input.returns[0].links[0].confirmation = { physicalReturnDate: '2026-07-31', basis: 'selected_existing_return_evidence', confirmed: true, note: 'Matched warehouse evidence' }; expect(decodeImportManifest(v)).toEqual(v); v.input.returns[0].links[0].confirmation.note = ''; expect(() => decodeImportManifest(v)).toThrow(); });
    it('does not pretend sale transactionDate identifies a source return-date field', () => { const v: any = manifest(); v.input.returns = [{ rowId: 'r1', state: 'linked', links: [{ returnRevisionId: uuid, quantity: '1', confirmation: { physicalReturnDate: '2026-07-31', basis: 'source_return_date', confirmed: true, note: 'sale date' } }], stockImpact: 'clear', note: '' }]; expect(() => decodeImportManifest(v)).toThrow(); });
    it('strictly binds finalized evidence and optimistic versions in prepare', () => { const value = { manifest: manifest(), expected_customer_version: '4', expected_draft_version: '3', expected_evidence_version: '2' }; expect(decodeImportPrepare(value)).toEqual(value); expect(() => decodeImportPrepare({ ...value, expected_evidence_version: '1' })).toThrow(); expect(() => decodeImportPrepare({ ...value, expected_draft_version: 3 })).toThrow(); });
    it('decodes a six-field private result without weakening ordinary receipts', () => { const v = { importId: uuid, importVersion: '1', customerVersion: '4', draftId: uuid, draftVersion: '4', manifestDigest: 'a'.repeat(64) }; expect(decodeImportBinding(v)).toEqual(v); expect(() => decodeImportBinding({ ...v, receipt: {} })).toThrow(); });
});
describe('CO canonical value v1 (UTF-8 length-tagged, not JSON.stringify)', () => {
    it.each([[null, 'n'], [true, 't'], [false, 'f'], [12, 'i12;'], ['é', 's2:é'], [['0', null], 'a2:s1:0n'], [{ b: '02', a: '1.00' }, 'o2:s1:as4:1.00s1:bs2:02']])('has shared SQL/TS vector %j', (value, expected) => expect(canonicalManifestValue(value)).toBe(expected));
    it('sorts keys by UTF-8 bytes and preserves decimal strings', () => { expect(canonicalManifestValue({ '😀': 1, '\ue000': 2 })).toBe('o2:s3:\ue000i2;s4:😀i1;'); expect(canonicalManifestValue('1.00')).not.toBe(canonicalManifestValue('1')); });
    it.each([NaN, Infinity, 1.1, -1, undefined, '\ud800', '\0'])('rejects nonportable values %j', value => expect(() => canonicalManifestValue(value)).toThrow());
    it('hashes the envelope without digest and with domain separation', async () => { const value = manifest(); const { digest: _, ...body } = value; const expected = createHash('sha256').update('co-import-manifest-v1\n' + canonicalManifestValue(body)).digest('hex'); expect(await manifestDigest(value)).toBe(expected); expect(await manifestDigest({ ...value, digest: 'b'.repeat(64) })).toBe(expected); });
});
describe('canonical hardening', () => {
    it('refuses deep/cyclic input rather than overflowing', () => { const cycle: any = {}; cycle.self = cycle; expect(() => canonicalManifestValue(cycle)).toThrow(); let deep: any = null; for (let i = 0; i < 34; i++)
        deep = [deep]; expect(() => canonicalManifestValue(deep)).toThrow(); });
    it('returns an independent immutable-history snapshot', () => { const value = manifest(), decoded = decodeImportManifest(value); value.input.extracted.sourceRows[0].quantity.raw = 'changed'; expect(decoded.input.extracted.sourceRows[0].quantity.raw).toBe('2'); });
});
it('bounds aggregate manifest input before cloning or hashing', () => { const v = manifest(); v.input.extracted.sourceRows = Array.from({ length: 10000 }, () => ({ ...v.input.extracted.sourceRows[0], name: 'x'.repeat(1024) })); expect(() => decodeImportManifest(v)).toThrow(); });
it('accepts an explicitly identified source return date, never a sale-date substitute', () => { const v: any = manifest(), row = v.input.extracted.sourceRows[0]; row.physicalReturnDate = { date: '2026-07-31', raw: '31 Jul 2026 returned', ref: { ...row.ref } }; v.input.returns = [{ rowId: 'r1', state: 'linked', links: [{ returnRevisionId: uuid, quantity: '1', confirmation: { physicalReturnDate: '2026-07-31', basis: 'source_return_date', confirmed: true, note: 'Read return field' } }], stockImpact: 'clear', note: '' }]; expect(decodeImportManifest(v)).toEqual(v); row.physicalReturnDate.ref.fileSha256 = 'b'.repeat(64); expect(() => decodeImportManifest(v)).toThrow(); row.physicalReturnDate.ref.fileSha256 = v.input.extracted.sha256; row.physicalReturnDate.date = '2026-07-30'; expect(() => decodeImportManifest(v)).toThrow(); });
it.each([[null, 'aefc719815fb4f53cdad443be146bac1fe5a8a3c2ded917a07ed2b7cdde004f3'], ['é', 'b7b83cb422f768b0b94c52da2386a00fb79e35cf7e1b26569f2c5460b6983d06'], [{ b: '02', a: '1.00' }, '42330bf18dfe89880f9e456780e71e0f3de8da68f0989c7828a635a5c55ce8d8']])('pins portable SHA-256 vector %j', (value, expected) => { expect(createHash('sha256').update('co-import-manifest-v1\n' + canonicalManifestValue(value)).digest('hex')).toBe(expected); });
describe('JSON-only manifest domain regressions', () => {
    it('rejects sparse arrays without changing or filling their holes', async () => {
        const left: any[] = [, 'a'], right: any[] = ['a', ,];
        for (const sparse of [left, right]) {
            expect(() => canonicalManifestValue(sparse)).toThrow();
            const value = manifest();
            value.input.extracted.warnings = sparse;
            expect(() => decodeImportManifest(value)).toThrow();
            await expect(manifestDigest(value)).rejects.toThrow();
        }
        expect(Object.hasOwn(left, 0)).toBe(false);
        expect(Object.hasOwn(right, 1)).toBe(false);
    });
    it('rejects array side-properties, symbols and accessors', () => {
        for (const change of [(a: any[]) => { (a as any).extra = 'x'; }, (a: any[]) => { (a as any)[Symbol('hidden')] = 'x'; }, (a: any[]) => { Object.defineProperty(a, '0', { get: () => 'a', enumerable: true }); }]) {
            const array = ['a'];
            change(array);
            expect(() => canonicalManifestValue(array)).toThrow();
            const value = manifest();
            value.input.extracted.warnings = array;
            expect(() => decodeImportManifest(value)).toThrow();
        }
    });
    it('requires own fields and JSON objects for manifest, prepare and binding', () => {
        const value = manifest();
        value.input.scope = Object.create(value.input.scope);
        expect(() => decodeImportManifest(value)).toThrow();
        expect(() => decodeImportPrepare(Object.create({ manifest: manifest(), expected_customer_version: '4', expected_draft_version: '3', expected_evidence_version: '2' }))).toThrow();
        expect(() => decodeImportBinding(Object.create({ importId: uuid, importVersion: '1', customerVersion: '4', draftId: uuid, draftVersion: '4', manifestDigest: 'a'.repeat(64) }))).toThrow();
    });
    it('rejects unsupported hidden/symbol/accessor fields before cloning or encoding', () => {
        for (const change of [(v: any) => Object.defineProperty(v, 'hidden', { value: 1 }), (v: any) => { v[Symbol('hidden')] = 1; }, (v: any) => Object.defineProperty(v, 'digest', { get: () => 'a'.repeat(64), enumerable: true })]) {
            const value = manifest();
            change(value);
            expect(() => decodeImportManifest(value)).toThrow();
            expect(() => canonicalManifestValue(value)).toThrow();
        }
    });
    it('rejects year zero consistently with the SQL date domain', () => { const value = manifest(); value.input.scope.reportMonth = '0000-01-01'; expect(() => decodeImportManifest(value)).toThrow(); });
});
it('bounds descriptor work on a shared graph before expanded-value budgeting',()=>{
    let shared: unknown = null;
    for(let i=0;i<17;i++) shared=[shared,shared];
    const original=Object.getOwnPropertyDescriptor;
    let reads=0;
    Object.getOwnPropertyDescriptor=function(target:object,key:PropertyKey){reads++;return original(target,key);};
    try {
        expect(()=>canonicalManifestValue(shared)).toThrow();
        expect(reads).toBeLessThanOrEqual(100000);
    } finally {
        Object.getOwnPropertyDescriptor=original;
    }
});

it('preserves explicit numeric conventions without inventing one for legacy evidence',()=>{
 const value:any=manifest();value.input.extracted.sourceRows[0].quantity.convention='decimal_dot';expect(decodeImportManifest(value)).toEqual(value)
 value.input.extracted.sourceRows[0].quantity.convention=null;expect(decodeImportManifest(value)).toEqual(value)
 delete value.input.extracted.sourceRows[0].quantity.convention;expect(decodeImportManifest(value)).toEqual(value)
 value.input.extracted.sourceRows[0].quantity.convention='auto_detect';expect(()=>decodeImportManifest(value)).toThrow()
})
