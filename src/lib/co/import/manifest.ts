import { manualPhysicalIssues } from './sourceControls';
import { isManualTranscription } from './manualPolicy';
import type { ImportManifest, ImportBinding, ImportPost, ImportPreview } from './types';
import type { CORecovery } from '../contracts';
import { parseCOReceipt, decodeCORead } from '../validation';
import { ResultBudget } from './resultBudget';
import { invalid, record, parseUUID, parseHash, parseDate, parseMonth, parseVersion, parseQuantity, parseBoolean, parseSafeCount, oneOf } from '../validation';
type Decoder = (value: unknown) => unknown;
/** Reject shapes JSON transport cannot preserve; inspect descriptors before reading. */
function assertJSON(value: unknown, depth = 0, budget = { work: 100000 }): void {
    // Bound expanded traversal even for tiny shared DAGs. This is intentionally
    // before the value-reading ResultBudget, so accessors are never evaluated.
    if (--budget.work < 0) invalid('JSON work budget');
    if (depth > 32)
        invalid('JSON depth');
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return;
    if (typeof value === 'number') {
        parseSafeCount(value);
        return;
    }
    if (!value || typeof value !== 'object')
        invalid('JSON value');
    const isArray = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
        invalid('JSON prototype');
    const keys = Reflect.ownKeys(value);
    budget.work -= keys.length;
    if (budget.work < 0) invalid('JSON work budget');
    if (isArray && (value.length > 10000 || keys.length !== value.length + 1))
        invalid('dense JSON array required');
    for (const key of keys) {
        if (typeof key !== 'string')
            invalid('JSON symbol key');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!Object.hasOwn(descriptor, 'value'))
            invalid('JSON accessor');
        if (isArray && key === 'length')
            continue;
        if (!descriptor.enumerable)
            invalid('JSON hidden key');
        if (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
            invalid('JSON array side property');
        assertJSON(descriptor.value, depth + 1, budget);
    }
    if (isArray)
        for (let i = 0; i < value.length; i++)
            if (!Object.hasOwn(value, i))
                invalid('dense JSON array required');
}
function date(value: unknown): string {
    const parsed = parseDate(value);
    if (parsed.startsWith('0000-'))
        invalid('date year');
    return parsed;
}
function month(value: unknown): string {
    date(value);
    return parseMonth(value);
}
const nullable = (parse: Decoder): Decoder => value => value === null ? null : parse(value);
function text(value: unknown, max = 4096): string {
    if (typeof value !== 'string' || value.length > max || /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
        invalid('manifest text');
    return value;
}
const label: Decoder = value => {
    const s = text(value, 256);
    if (!s.trim()) invalid('manifest label');
    return s;
};
const note: Decoder = value => {
    const s = text(value, 2000);
    if (!s.trim()) invalid('confirmation note');
    return s;
};
const array = (parse: Decoder, max = 10000): Decoder => value => {
    if (!Array.isArray(value) || value.length > max) invalid('manifest array');
    value.forEach(parse);
    return value;
};
function exact(fields: Record<string, Decoder>, optional: Record<string, Decoder> = {}): Decoder {
    return value => {
        const o = record(value);
        if (Object.keys(fields).some(k => !Object.hasOwn(o, k))) invalid('own manifest fields');
        if (Object.keys(o).some(k => !Object.hasOwn(fields, k) && !Object.hasOwn(optional, k))) invalid('manifest fields');
        for (const [k, parse] of Object.entries(fields)) parse(o[k]);
        for (const [k, parse] of Object.entries(optional)) {
            if (Object.hasOwn(o, k)) parse(o[k]);
        }
        return o;
    };
}
const sourceNumber = exact({ raw: v => text(v, 512), decimal: nullable(v => { const s = text(v, 128); if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(s))
        invalid('source decimal'); return s; }) }, { convention: nullable(oneOf(['decimal_dot', 'decimal_comma', 'canonical_integer_text', 'dash_zero'])) });
const quantity: Decoder = v => { const s = parseQuantity(v); if (s.length > 128)
    invalid('quantity limit'); return s; };
const sourceRef = exact({ fileSha256: parseHash, page: nullable(v => { const n = parseSafeCount(v); if (n < 1)
        invalid('source page'); return n; }), sheet: nullable(label), row: label, section: label });
const sourceRow = exact({ id: label, ref: sourceRef, sourceSku: nullable(v => text(v, 512)), name: v => text(v, 1024), transactionDate: nullable(date), transactionReference: nullable(v => text(v, 512)), quantity: sourceNumber, returned: nullable(sourceNumber), unit: nullable(v => text(v, 128)), unitPrice: nullable(sourceNumber), discount: nullable(sourceNumber), discountBasis: nullable(oneOf(['line_amount', 'unit_amount', 'percent', 'unknown'])), netUnitPrice: nullable(sourceNumber), amount: nullable(sourceNumber), currency: nullable(v => text(v, 16)), priceBasisLabel: nullable(v => text(v, 512)), flags: array(v => text(v, 512), 100) }, { physicalReturnDate: exact({ date: date, ref: sourceRef, raw: v => text(v, 512) }) });
const manualWorkbook = exact({
    version: v => { if (v !== 1) invalid('workbook version'); },
    policy: oneOf(['co-manual-xlsx-values-1']),
    sheets: array(exact({ name: label, rows: array(v => {
        const n = parseSafeCount(v); if (n < 1 || n > 10000) invalid('physical row'); return n;
    }) }), 20),
});
const manualPrintedControls = exact({
    version: v => { if (v !== 2) invalid('manual controls version'); },
    reviewedSheets: array(label, 20), confirmed: v => { if (v !== true) invalid('controls confirmation'); },
    controls: array(exact({ ref: sourceRef, rowIds: array(label), count: nullable(sourceNumber),
        quantity: nullable(sourceNumber), returned: nullable(sourceNumber), amount: nullable(sourceNumber) }), 1000),
});
const extracted = exact({
    sha256: parseHash, format: oneOf(['pdf', 'xlsx']), parserVersion: label, sourceRows: array(sourceRow),
    sections: array(exact({ id: label, label: v => text(v, 1024), rowIds: array(label), printedTotal: nullable(sourceNumber) }), 1000),
    periodCandidates: array(month, 1000), customerCandidates: array(v => text(v, 1024), 1000), warnings: array(v => text(v, 1024), 1000),
}, {
    manualWorkbook, manualPrintedControls,
    printedControls: array(exact({ kind: oneOf(['section', 'sheet']), ref: sourceRef, rowIds: array(label), count: sourceNumber, quantity: sourceNumber, returned: sourceNumber, amount: sourceNumber }), 1000),
    manualTranscription: exact({ mode: oneOf(['human_transcribed']), version: v => { if (v !== 1 && v !== 2) invalid('transcription version'); return v; },
        originalParserVersion: label, originalWarnings: array(v => text(v, 1024), 1000), reason: note,
        confirmed: v => { if (v !== true) invalid('transcription confirmation'); return v; } }),
});
const mapping = exact({ rowId: label, stockKeyId: nullable(parseUUID), ledgerUnit: nullable(v => text(v, 128)), quantity: nullable(quantity), conversion: nullable(exact({ numerator: quantity, denominator: quantity, reason: note })), included: parseBoolean, exclusionReason: nullable(v => text(v, 2000)), confirmed: parseBoolean });
// An explicit physical-return-date source reference is required for source basis.
// Existing parsers leave it absent; never infer it from the sale date.
const returnConfirmation = exact({ physicalReturnDate: date, basis: oneOf(['source_return_date', 'selected_existing_return_evidence']), confirmed: v => { if (v !== true)
        invalid('return confirmation'); return v; }, note });
const returns = exact({ rowId: label, state: oneOf(['none', 'linked', 'unresolved']), links: array(exact({ returnRevisionId: parseUUID, quantity, confirmation: returnConfirmation }), 1000), stockImpact: oneOf(['clear', 'uncertain']), note: v => text(v, 2000) });
const review = exact({ scope: exact({ actorId: parseUUID, customerId: parseUUID, reportMonth: month, epoch: parseSafeCount }), extracted, mappings: array(mapping), returns: array(returns), includedSectionIds: array(label, 1000), completenessConfirmed: parseBoolean, omittedZeroStockKeyIds: array(parseUUID), currency: nullable(v => text(v, 16)), reason: nullable(v => text(v, 2000)) }, { sourceConfirmations: array(exact({ rowId: label, flag: oneOf(['formula_cache_requires_confirmation', 'source_sku_format_requires_confirmation']), confirmed: parseBoolean, reason: note })) });
const manifest = exact({ schemaVersion: v => { if (v !== 1)
        invalid('manifest schema'); return v; }, evidenceId: parseUUID, input: review, digest: parseHash });
/** Wire decoding only: not arithmetic readiness, server authority, or digest verification. */
export function decodeImportManifest(value: unknown): ImportManifest {
    assertJSON(value);
    new ResultBudget().reserve(value);
    manifest(value);
    const v = value as ImportManifest;
    if (v.input.extracted.manualTranscription && !isManualTranscription(v.input.extracted)) invalid("manual provenance");
    if (/^co-human-transcribed-[12]$/.test(v.input.extracted.parserVersion) && !isManualTranscription(v.input.extracted)) invalid("manual provenance required");
    const manualXlsx=v.input.extracted.manualTranscription?.version===2;
    if(!manualXlsx && v.input.extracted.manualPrintedControls!==undefined)invalid('manual controls format');
    if(manualXlsx && manualPhysicalIssues(v.input.extracted).length)invalid('manual workbook physical controls');
    if(v.input.extracted.manualTranscription && !manualXlsx){
      const source=v.input.extracted, refs=new Set<string>();
      if(!source.sourceRows.length||!source.sections.length)invalid('manual physical rows');
      for(const row of source.sourceRows){const ref=row.ref,key=canonicalManifestValue(ref);if(ref.fileSha256!==source.sha256||ref.page===null||ref.page>50||ref.sheet!==null||refs.has(key))invalid('manual physical reference');refs.add(key)}
    }
    for (const row of v.input.extracted.sourceRows) {
        const source = row.physicalReturnDate;
        if (source && (source.ref.fileSha256 !== v.input.extracted.sha256 || canonicalManifestValue(source.ref) !== canonicalManifestValue(row.ref)))
            invalid('return source identity');
    }
    for (const decision of v.input.returns)
        for (const link of decision.links)
            if (link.confirmation?.basis === 'source_return_date') {
                const source = v.input.extracted.sourceRows.find(row => row.id === decision.rowId)?.physicalReturnDate;
                if (!source || source.date !== link.confirmation.physicalReturnDate)
                    invalid('physical return source required');
            }
    return structuredClone(value) as ImportManifest;
}
export type ImportPrepare = {
    manifest: ImportManifest;
    expected_customer_version: string;
    expected_draft_version: string;
    expected_evidence_version: '2';
    expected_selection_id?: string;
};
export function decodeImportPrepare(value: unknown): ImportPrepare {
    assertJSON(value);
    new ResultBudget().reserve(value);
    exact({ manifest: decodeImportManifest, expected_customer_version: parseVersion, expected_draft_version: parseVersion, expected_evidence_version: v => { if (v !== '2')
            invalid('finalized evidence version'); return v; } }, {expected_selection_id:parseUUID})(value);
    return structuredClone(value) as ImportPrepare;
}
export function decodeImportBinding(value: unknown): ImportBinding {
    assertJSON(value);
    exact({ importId: parseUUID, importVersion: parseVersion, customerVersion: parseVersion, draftId: parseUUID, draftVersion: parseVersion, manifestDigest: parseHash })(value);
    return structuredClone(value) as ImportBinding;
}
/** CO-CV1: n/t/f; i<safe nonnegative integer>; ; s<UTF8 length>:<bytes>;
 * a<count>:<values>; o<count>:<key,value pairs sorted by UTF8 bytes>.
 * No whitespace, Unicode normalization, decimal coercion, or JSON escape dependency.
 * Null bytes/unpaired surrogates are rejected (PostgreSQL JSONB cannot represent them).
 */
export function canonicalManifestValue(value: unknown): string {
    assertJSON(value);
    new ResultBudget().reserve(value);
    const utf8 = new TextEncoder();
    const encode = (v: unknown, depth: number): string => {
        if (depth > 32)
            invalid('canonical depth');
        if (v === null)
            return 'n';
        if (v === true)
            return 't';
        if (v === false)
            return 'f';
        if (typeof v === 'number') {
            parseSafeCount(v);
            return `i${v};`;
        }
        if (typeof v === 'string') {
            text(v, 1048576);
            return `s${utf8.encode(v).length}:${v}`;
        }
        if (Array.isArray(v)) {
            if (v.length > 10000)
                invalid('canonical array');
            return `a${v.length}:${v.map(x => encode(x, depth + 1)).join('')}`;
        }
        const o = record(v);
        if (Object.getPrototypeOf(o) !== Object.prototype && Object.getPrototypeOf(o) !== null)
            invalid('canonical object');
        const keys = Object.keys(o).sort((a, b) => { const x = utf8.encode(a), y = utf8.encode(b); for (let i = 0; i < Math.min(x.length, y.length); i++)
            if (x[i] !== y[i])
                return x[i] - y[i]; return x.length - y.length; });
        if (keys.length > 10000)
            invalid('canonical keys');
        return `o${keys.length}:${keys.map(k => encode(k, depth + 1) + encode(o[k], depth + 1)).join('')}`;
    };
    return encode(value, 0);
}
export async function manifestDigest(value: ImportManifest): Promise<string> {
    const { digest: _, ...body } = decodeImportManifest(value);
    const bytes = new TextEncoder().encode('co-import-manifest-v1\n' + canonicalManifestValue(body));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

const reopenOrders: Decoder = value => {
    array(exact({coId:parseUUID, expectedCoVersion:parseVersion}), 1000)(value);
    const rows = value as {coId:string}[];
    if (new Set(rows.map(row=>row.coId)).size !== rows.length) invalid('duplicate reopen acknowledgement');
    return value;
};
/** Publication codecs do not confer server authority or freshness. */
export function decodeImportCommitCommand(value: unknown): Omit<ImportPost,'requestId'> {
    assertJSON(value);
    exact({ binding: decodeImportBinding, previewFingerprint: parseHash, mode: oneOf(['post','edit']), reason: nullable(note) }, {acknowledgedReopenOrders:reopenOrders})(value);
    const v=value as Omit<ImportPost,'requestId'>;
    if(v.mode==='edit'&&v.reason===null)invalid('edit reason');
    return structuredClone(v);
}
export function decodeImportPost(value: unknown): ImportPost {
    assertJSON(value);
    exact({ binding: decodeImportBinding, previewFingerprint: parseHash, requestId: parseUUID, mode: oneOf(['post', 'edit']), reason: nullable(note) }, {acknowledgedReopenOrders:reopenOrders})(value);
    const v = value as ImportPost;
    if (v.mode === 'edit' && v.reason === null) invalid('edit reason');
    return structuredClone(v);
}
export function decodeImportPreview(value: unknown): ImportPreview {
    assertJSON(value); new ResultBudget().reserve(value);
    exact({ binding: decodeImportBinding, previewFingerprint: parseHash,
        existingPreview: v => decodeCORead('pilot_co_preview_v1', {p_payload:{draft_id:record(value).binding.draftId,expected_customer_version:record(value).binding.customerVersion,expected_draft_version:record(value).binding.draftVersion}}, v),
        issues: array(exact({code: label, rowId: nullable(label), message: v => text(v, 2000), blocking: parseBoolean}), 10000) }, {requiredReopenOrders:reopenOrders})(value);
    const v = value as ImportPreview;
    if (v.existingPreview.draft_version !== v.binding.draftVersion || v.existingPreview.customer_version !== v.binding.customerVersion || !['post_report', 'correct_report'].includes(v.existingPreview.operation)) invalid('import preview binding');
    return structuredClone(v);
}
export function decodeImportRecovery(value: unknown): CORecovery {
    assertJSON(value);
    const v = record(value);
    if (v.status === 'committed') {
        exact({ status: oneOf(['committed']), operation: oneOf(['post_report', 'correct_report']), receipt: parseCOReceipt })(v);
        const receipt = parseCOReceipt(v.receipt);
        if (receipt.operation !== v.operation) invalid('import recovery family');
        return { status: 'committed', operation: receipt.operation, receipt };
    }
    exact({ status: oneOf(['unknown', 'abandoned']) })(v);
    return { status: v.status };
}
export type ImportPrepareRecovery = {status:'committed'; operation:'prepare_import'; binding:ImportBinding} | {status:'unknown'|'abandoned'};
export function decodeImportPrepareRecovery(value: unknown): ImportPrepareRecovery {
    assertJSON(value); const v = record(value);
    if (v.status === 'committed') {
        exact({status:oneOf(['committed']), operation:oneOf(['prepare_import']), binding:decodeImportBinding})(v);
        return {status:'committed', operation:'prepare_import', binding:decodeImportBinding(v.binding)};
    }
    exact({status:oneOf(['unknown','abandoned'])})(v);
    return {status:v.status};
}

export type ImportReviewResult = {version:'1';selectionId:string;state:'review_open'|'abandoned';draftId:string;draftVersion:import('../contracts').Version;customerVersion:import('../contracts').Version};
const reviewResult = exact({version:oneOf(['1']),selectionId:parseUUID,state:oneOf(['review_open','abandoned']),draftId:parseUUID,draftVersion:parseVersion,customerVersion:parseVersion});
export function decodeImportReviewResult(value:unknown):ImportReviewResult {
    assertJSON(value);reviewResult(value);return structuredClone(value) as ImportReviewResult;
}
export type ImportReviewRecovery = {status:'committed';operation:'review_import';review:ImportReviewResult}|{status:'unknown'|'abandoned'};
export function decodeImportReviewRecovery(value:unknown):ImportReviewRecovery {
    assertJSON(value);const v=record(value);
    if(v.status==='committed') {
        exact({status:oneOf(['committed']),operation:oneOf(['review_import']),review:reviewResult})(v);
        return {status:'committed',operation:'review_import',review:decodeImportReviewResult(v.review)};
    }
    exact({status:oneOf(['unknown','abandoned'])})(v);return {status:v.status};
}
export type ImportSelection = {version:'1';selectionId:string|null;state:'selected'|'review_open'|'abandoned'|null;importId:string|null;draftId:string;draftVersion:import('../contracts').Version;customerVersion:import('../contracts').Version;reportHeadId:string|null;originalRevisionId:string|null;reportVersion:import('../contracts').Version|null};
export function decodeImportSelection(value:unknown):ImportSelection {
    assertJSON(value);
    exact({version:oneOf(['1']),selectionId:nullable(parseUUID),state:nullable(oneOf(['selected','review_open','abandoned'])),importId:nullable(parseUUID),draftId:parseUUID,draftVersion:parseVersion,customerVersion:parseVersion,reportHeadId:nullable(parseUUID),originalRevisionId:nullable(parseUUID),reportVersion:nullable(parseVersion)})(value);
    const v=value as ImportSelection;
    if((v.selectionId===null)!==(v.state===null)||(v.state==='selected')!==(v.importId!==null)||(v.reportHeadId===null)!==(v.originalRevisionId===null)||(v.reportHeadId===null)!==(v.reportVersion===null)) invalid('selection identity');
    return structuredClone(v);
}
export function decodeImportRead(value:unknown):{manifest:ImportManifest;binding:ImportBinding} {
    assertJSON(value);new ResultBudget().reserve(value);
    exact({manifest:decodeImportManifest,binding:decodeImportBinding})(value);
    const v=value as {manifest:ImportManifest;binding:ImportBinding};
    if(v.manifest.digest!==v.binding.manifestDigest) invalid('historical import binding');
    return structuredClone(v);
}
