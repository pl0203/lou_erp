import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  boundedBytes, inspectEvidenceBytes, manualWorkbookEvidence, parseContext,
  sameObject, verifyObject,
} from '../../supabase/functions/_shared/co-evidence.ts';
import type { Context } from '../../supabase/functions/_shared/co-evidence.ts';
import { guardWorkbook } from '../../supabase/functions/_shared/workbook-guard.ts';
import {
  zip, parts, row, num, str,
} from '../co/import/fixtures/xlsx-layout.ts';

const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const id = '11111111-1111-4111-8111-111111111111';
const objectId = '22222222-2222-4222-8222-222222222222';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const signal = () => new AbortController().signal;
const workbook = (compressed = true) => zip(parts().map(p => ({ ...p, deflate: compressed })));
const unknownWorkbook = () => zip(parts(row(4, str('A4', 'Synthetic unknown layout'))
  + row(7, num('B7', '9007199254740993.0001')), '').map(p => ({ ...p, deflate: true })));
const context = (bytes: Uint8Array): Context => ({
  version: '1', id, actor_id: id, bucket: 'co-evidence', path: `${id}.xlsx`,
  filename: `evidence-${id}.xlsx`, mime_type: mime, byte_size: bytes.length,
  sha256: digest(bytes), state: 'finalized', object: { id: objectId, version: 'synthetic-v1' },
});

/** Runtime-only acceptance. No mocked fetch or claim of real Auth/Storage receipt issuance. */
export function registerEvidenceRuntimeTests(test: (name: string, run: () => Promise<void>) => void) {
  test('native raw-deflate validates original XLSX bytes without replacing their identity', async () => {
    const original = workbook(), canonical = (await guardWorkbook(original, signal())).canonicalBytes;
    assert.notEqual(digest(original), digest(canonical));
    assert.deepEqual(await inspectEvidenceBytes(original), {
      mime_type: mime, byte_size: original.length, sha256: digest(original),
    });
    assert.deepEqual((await guardWorkbook(canonical, signal())).canonicalBytes, canonical);
  });

  test('native stored XLSX and compressed XLSX have equal canonical structure but distinct evidence', async () => {
    const compressed = workbook(), stored = workbook(false);
    assert.notEqual(digest(compressed), digest(stored));
    assert.deepEqual((await guardWorkbook(compressed, signal())).canonicalBytes,
      (await guardWorkbook(stored, signal())).canonicalBytes);
    assert.equal((await inspectEvidenceBytes(stored)).sha256, digest(stored));
  });

  test('native original-byte manual facts preserve exact physical membership and policy', async () => {
    const bytes = unknownWorkbook();
    assert.deepEqual(await manualWorkbookEvidence(bytes, mime, signal()), {
      version: 1, policy: 'co-manual-xlsx-values-1', sheets: [{ name: 'Sheet', rows: [4, 7] }],
    });
    const guarded = await guardWorkbook(bytes, signal());
    assert.equal(guarded.cells.get(guarded.sheets[0].path)?.get('B7')?.raw, '9007199254740993.0001');
    assert.equal(await manualWorkbookEvidence(bytes, 'application/pdf', signal()), null);
    assert.equal(await manualWorkbookEvidence(workbook(), mime, signal()), null);
  });

  test('native values-only receipt classification rejects formulas and unsupported date semantics', async () => {
    const source = parts(row(4, str('A4', 'Synthetic unknown layout')) + row(7, num('B7', '2')), '');
    const formula = zip(source.map(p => ({ ...p, text: p.text?.replace('<v>2</v>', '<f>1+1</f><v>2</v>'), deflate: true })));
    const dates = zip(source.map(p => ({ ...p, text: p.name === 'xl/workbook.xml'
      ? p.text?.replace('<sheets>', '<workbookPr date1904="1"/><sheets>') : p.text, deflate: true })));
    // Both are valid inert evidence, but neither grants manual values-only authority.
    assert.equal((await inspectEvidenceBytes(formula)).mime_type, mime);
    assert.equal((await inspectEvidenceBytes(dates)).mime_type, mime);
    assert.equal(await manualWorkbookEvidence(formula, mime, signal()), null);
    assert.equal(await manualWorkbookEvidence(dates, mime, signal()), null);
  });

  for (const [name, build] of [
    ['deflated CRC mismatch', () => zip(parts().map((p, i) => ({ ...p, deflate: true, ...(i === 0 ? { crc: 0 } : {}) })))],
    ['declared inflated size mismatch', () => zip(parts().map((p, i) => ({ ...p, deflate: true, ...(i === 0 ? { size: 1 } : {}) })))],
    ['duplicate package entry', () => zip([...parts(), parts()[0]])],
    ['path traversal', () => zip([...parts(), { name: '../unsafe.xml', text: '<x/>' }])],
    ['external relationship', () => zip(parts().map(p => ({ ...p, text: p.text?.replace('Target="styles.xml"', 'Target="https://invalid.example/never-fetch" TargetMode="External"') })))],
    ['macro package', () => zip([...parts(), { name: 'xl/vbaProject.bin', text: 'synthetic' }])],
    ['truncated ZIP', () => workbook().slice(0, -10)],
  ] as const) {
    test(`native unsafe XLSX rejects ${name}`, async () => {
      const bytes = build();
      await assert.rejects(() => inspectEvidenceBytes(bytes));
      assert.equal(await manualWorkbookEvidence(bytes, mime, signal()), null);
    });
  }

  test('native verified download bytes bind SHA, size, MIME and canonical object identity', async () => {
    const bytes = workbook(), ctx = context(bytes);
    assert.deepEqual(parseContext(ctx, id), ctx);
    assert.deepEqual((await verifyObject(new Response(bytes), ctx)).bytes, bytes);
    await assert.rejects(() => verifyObject(new Response(workbook(false)), ctx), /Stored evidence changed/);
    assert.equal(sameObject(ctx, { ...ctx, object: { id: objectId, version: 'changed' } }), false);
    assert.equal(sameObject(ctx, { ...ctx, sha256: '0'.repeat(64) }), false);
    assert.throws(() => parseContext({ ...ctx, path: '../foreign.xlsx' }, id), /Invalid evidence authorization/);
    await assert.rejects(() => verifyObject(new Response(bytes, { status: 403 }), ctx), /Stored evidence unavailable/);
  });

  test('native streamed byte limits reject forged and streaming overflow without accepting prefixes', async () => {
    await assert.rejects(() => boundedBytes(new Response(new Uint8Array(5), { headers: { 'content-length': '5' } }), 4), /Invalid byte length/);
    await assert.rejects(() => boundedBytes(new Response(new Uint8Array(5)), 4), /Byte limit exceeded/);
    await assert.rejects(() => boundedBytes(new Response(new Uint8Array()), 4), /Missing bytes/);
    assert.deepEqual(await boundedBytes(new Response(new Uint8Array([1, 2, 3])), 4), new Uint8Array([1, 2, 3]));
  });

  test('native classification cancellation cannot mint receipt facts', async () => {
    const cancelled = new AbortController(); cancelled.abort(new Error('synthetic cancellation'));
    await assert.rejects(() => manualWorkbookEvidence(unknownWorkbook(), mime, cancelled.signal), /synthetic cancellation/);
  });
}
