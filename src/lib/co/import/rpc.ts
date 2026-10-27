import {decodeReturnCandidates} from './returnCandidates';
import { assertNoOtherCORequest, hasScopedCORecovery } from './recoveryScope';
import { supabase } from '../../supabase';
import { createTransactionSender, type Recovery } from '../../orderTransactions';
import { coError, completeCORead, type COReadOptions } from '../rpc';
import { CO_BACKEND } from '../queryKeys';
import { decodeCORead, invalid, record, parseSafeCount, parseUUID, parseMonth, parseHash, parseBoolean, parseVersion, parseCOReceipt } from '../validation';
import type { COReceipt } from '../contracts';
import type { ImportBinding, ImportPost, ImportScope, ReviewInput, ImportReopenAcknowledgment } from './types';
import { canonicalManifestValue, decodeImportCommitCommand, decodeImportBinding, decodeImportPost, decodeImportPrepare, decodeImportPrepareRecovery, decodeImportPreview, decodeImportRead, decodeImportRecovery, decodeImportReviewRecovery, decodeImportReviewResult, decodeImportSelection, manifestDigest, type ImportPrepare, type ImportReviewResult } from './manifest';
import { decodeUnitDeclaration, decodeUnitReceipt, decodeStockKeyUnits, type UnitDeclaration, type UnitReceipt } from './units';
export const IMPORT_RECOVERY_LABEL = 'Periksa hasil pencatatan';
export type ImportCommitCommand = Omit<ImportPost, 'requestId'>;
export type ImportReviewCommand = {
    draft_id: string;
    expected_draft_version: string;
    expected_customer_version: string;
    expected_selection_id: string | null;
    original_revision_id: string | null;
    expected_report_version: string | null;
    action: 'open' | 'abandon';
    reason: string;
};
export function decodeImportReviewCommand(value: unknown): ImportReviewCommand {
    canonicalManifestValue(value);
    const v = record(value), fields = ['draft_id', 'expected_draft_version', 'expected_customer_version', 'expected_selection_id', 'original_revision_id', 'expected_report_version', 'action', 'reason'];
    if (Object.keys(v).length !== fields.length || fields.some(k => !Object.hasOwn(v, k)))
        invalid('review command fields');
    parseUUID(v.draft_id);
    parseVersion(v.expected_draft_version);
    parseVersion(v.expected_customer_version);
    for (const k of ['expected_selection_id', 'original_revision_id'])
        if (v[k] !== null)
            parseUUID(v[k]);
    if (v.expected_report_version !== null)
        parseVersion(v.expected_report_version);
    if ((v.original_revision_id === null) !== (v.expected_report_version === null) || !['open', 'abandon'].includes(v.action) || typeof v.reason !== 'string' || !v.reason.trim() || v.reason.length > 2000 || v.reason.includes('\0'))
        invalid('review command');
    return structuredClone(v) as ImportReviewCommand;
}
export type ImportFamily = 'prepare' | 'commit' | 'review' | 'unit';
type Result = ImportBinding | COReceipt | ImportReviewResult | UnitReceipt;
export type ImportRecovered = {
    family: ImportFamily;
    status: 'committed';
    result: Result;
} | {
    family: ImportFamily;
    status: 'unknown' | 'abandoned';
};
export type ImportCommandOptions = {
    scope: ImportScope;
    role: string;
    storage: () => Storage;
    isCurrent: () => boolean;
    authorize?: () => Promise<void>;
};
function guard(o: COReadOptions) { o.signal?.throwIfAborted(); if (o.isCurrent && !o.isCurrent())
    invalid('import owner changed'); }
async function read(name: string, args: Record<string, unknown>, o: COReadOptions) {
    guard(o);
    let request = supabase.rpc(name, args);
    if (o.signal)
        request = request.abortSignal(o.signal);
    const { data, error } = await request;
    guard(o);
    if (error)
        throw coError(error);
    return data;
}
const same = (a: unknown, b: unknown) => canonicalManifestValue(a) === canonicalManifestValue(b);
export async function previewImport(binding: ImportBinding, o: COReadOptions = {}, acknowledgedReopenOrders: ImportReopenAcknowledgment[] = []) {
    const b = decodeImportBinding(binding);
    const result = decodeImportPreview(await read('pilot_co_import_preview_v1', { p_import_id: b.importId, p_expected_version: b.importVersion, p_acknowledged_reopen_orders: acknowledgedReopenOrders }, o));
    if (!same(result.binding, b))
        invalid('preview immutable binding');
    return result;
}
/** Low-level already-bound transport. Only createImportCommands supplies its saved UUID. */
export async function commitImport(input: ImportPost, o: COReadOptions = {}) {
    const p = decodeImportPost(input);
    return parseCOReceipt(await read('pilot_co_import_commit_v1', { p_request_id: p.requestId, p_payload: p }, o));
}
export async function recoverImport(requestId: string, o: COReadOptions = {}, abandon = false) { return decodeImportRecovery(await read('pilot_co_import_reconcile_v1', { p_request_id: parseUUID(requestId), p_abandon: abandon }, o)); }
export async function recoverPrepare(requestId: string, o: COReadOptions = {}, abandon = false) { return decodeImportPrepareRecovery(await read('pilot_reconcile_co_import_prepare_v1', { p_request_id: parseUUID(requestId), p_abandon: abandon }, o)); }
export async function readImport(binding: ImportBinding, o: COReadOptions = {}) {
    const b = decodeImportBinding(binding), v = decodeImportRead(await read('pilot_co_import_read_v1', { p_import_id: b.importId, p_expected_version: b.importVersion }, o));
    if (!same(v.binding, b))
        invalid('historical binding');
    return v;
}
export async function readImportSelection(draftId: string, o: COReadOptions = {}) { const v = decodeImportSelection(await read('pilot_co_import_selection_v1', { p_draft_id: parseUUID(draftId) }, o)); if (v.draftId !== draftId)
    invalid('selection draft'); return v; }
export async function readStockKeyUnits(customerId: string, ids: string[], version: string, o: COReadOptions = {}) { return decodeStockKeyUnits(await read('pilot_co_stock_key_units_v1', { p_customer_id: customerId, p_stock_key_ids: ids, p_expected_customer_version: version }, o), customerId, ids, version); }
export type ImportEligibleContext = {
    draftId: string;
    draftVersion: string;
    customerId: string;
    customerVersion: string;
    reportMonth: string;
    selectionId: string | null;
};
export async function readImportEligible(c: ImportEligibleContext, page: number, o: COReadOptions = {}) {
    parseUUID(c.draftId);
    parseUUID(c.customerId);
    parseVersion(c.draftVersion);
    parseVersion(c.customerVersion);
    parseMonth(c.reportMonth);
    if (c.selectionId !== null)
        parseUUID(c.selectionId);
    parseSafeCount(page);
    if (page < 1)
        invalid('eligible page');
    const v = record(await read('pilot_co_import_eligible_v1', { p_draft_id: c.draftId, p_expected_draft_version: c.draftVersion, p_expected_customer_version: c.customerVersion, p_expected_selection_id: c.selectionId, p_page: page, p_page_size: 100 }, o));
    const fields = ['version', 'as_of', 'page', 'page_size', 'total', 'rows', 'customer_id', 'customer_version', 'report_month', 'view', 'generation_id', 'source_context_link', 'draft_id', 'draft_version', 'revision_id', 'eligible_set_fingerprint', 'source_context_fingerprint', 'context_issue', 'selection_id'];
    if (Object.keys(v).length !== fields.length || Object.keys(v).some(k => !fields.includes(k)) || v.selection_id !== c.selectionId || v.draft_id !== c.draftId || v.context_issue !== null)
        invalid('eligible selection scope');
    return decodeCORead('pilot_co_report_rows_v1', { p_customer_id: c.customerId, p_month: c.reportMonth, p_view: 'draft', p_revision_id: null, p_expected_draft_version: c.draftVersion, p_expected_customer_version: c.customerVersion, p_page: page, p_page_size: 100 }, v);
}
export async function readAllImportEligible(c: ImportEligibleContext, o: COReadOptions = {}) {
    let fingerprint: string | undefined;
    return completeCORead(async (page) => { if (page > 100)
        invalid('eligible row limit'); const result = await readImportEligible(c, page, o), pin = canonicalManifestValue([result.selection_id, result.eligible_set_fingerprint, result.source_context_fingerprint]); if (fingerprint !== undefined && fingerprint !== pin)
        invalid('changed eligible snapshot'); fingerprint = pin; return result; });
}
const names = { prepare: ['pilot_co_import_prepare_v1', 'pilot_reconcile_co_import_prepare_v1', 'prepare_import'], commit: ['pilot_co_import_commit_v1', 'pilot_co_import_reconcile_v1', 'post_report'], review: ['pilot_co_import_review_v1', 'pilot_co_import_review_reconcile_v1', 'review_import'], unit: ['pilot_co_declare_stock_key_unit_v1', 'pilot_reconcile_co_unit_v1', 'declare_stock_key_unit'] } as const;
// This identity deliberately excludes all source rows, filenames, reasons and raw payloads.
type Identity = {
    family: ImportFamily;
    customerId: string;
    month: string;
    operation: string;
    draftId?: string;
    stockKeyId?: string;
    digest?: string;
    customerVersion?: string;
    draftVersion?: string;
    binding?: ImportBinding;
    action?: 'open' | 'abandon';
    targetId?: string;
};
function identity(raw: unknown, family: ImportFamily, scope: ImportScope): Identity {
    const v = record(raw);
    if (Object.keys(v).some(k => !['family', 'customerId', 'month', 'operation', 'draftId', 'stockKeyId', 'digest', 'customerVersion', 'draftVersion', 'binding', 'action', 'targetId'].includes(k)))
        invalid('private recovery fields');
    if (v.family !== family || v.customerId !== scope.customerId || v.month !== scope.reportMonth)
        invalid('recovery scope');
    parseUUID(v.customerId);
    parseMonth(v.month);
    for (const key of ['draftId', 'stockKeyId', 'targetId'])
        if (v[key] !== undefined)
            parseUUID(v[key]);
    for (const key of ['customerVersion', 'draftVersion'])
        if (v[key] !== undefined)
            parseVersion(v[key]);
    if (v.digest !== undefined)
        parseHash(v.digest);
    if (v.binding !== undefined)
        decodeImportBinding(v.binding);
    if (v.operation !== (family === 'commit' ? (v.operation === 'correct_report' ? 'correct_report' : 'post_report') : names[family][2]))
        invalid('recovery operation');
    if (family === 'prepare' && (!v.draftId || !v.digest || !v.customerVersion || !v.draftVersion) || family === 'commit' && !v.binding || family === 'unit' && (!v.stockKeyId || !v.customerVersion) || family === 'review' && (!v.draftId || !v.draftVersion || !v.customerVersion || !['open', 'abandon'].includes(v.action)))
        invalid('recovery identity');
    return v as Identity;
}
function decodeResult(f: ImportFamily, v: unknown): Result { return f === 'prepare' ? decodeImportBinding(v) : f === 'review' ? decodeImportReviewResult(v) : f === 'unit' ? decodeUnitReceipt(v) : parseCOReceipt(v); }
function decodeRecovery(f: ImportFamily, v: unknown): Recovery<Result> {
    if (f === 'prepare') {
        const r = decodeImportPrepareRecovery(v);
        return r.status === 'committed' ? { state: 'committed', operation: r.operation, result: r.binding } : { state: r.status };
    }
    if (f === 'review') {
        const r = decodeImportReviewRecovery(v);
        return r.status === 'committed' ? { state: 'committed', operation: r.operation, result: r.review } : { state: r.status };
    }
    if (f === 'commit') {
        const r = decodeImportRecovery(v);
        return r.status === 'committed' ? { state: 'committed', operation: r.operation, result: r.receipt } : { state: r.status };
    }
    const r = record(v);
    if (r.status === 'committed') {
        if (Object.keys(r).length !== 3 || r.operation !== 'declare_stock_key_unit')
            invalid('unit recovery');
        return { state: 'committed', operation: r.operation, result: decodeUnitReceipt(r.receipt) };
    }
    if (Object.keys(r).length !== 1 || !['unknown', 'abandoned'].includes(r.status))
        invalid('unit recovery');
    return { state: r.status };
}
/** Family-specific typed results with the existing generic UUID/hash/save-before-send mechanism. */
export function createImportCommands(options: ImportCommandOptions) {
    const scope = { ...options.scope };
    parseUUID(scope.actorId);
    parseUUID(scope.customerId);
    parseMonth(scope.reportMonth);
    if (!['co_admin', 'executive'].includes(options.role))
        invalid('import authority');
    const suffix = `${encodeURIComponent(CO_BACKEND)}:${scope.actorId}:${scope.customerId}:`;
    const keys = Object.fromEntries((Object.keys(names) as ImportFamily[]).map(f => [f, `co-import-request:${suffix}${encodeURIComponent(`report:${scope.reportMonth}:${f}`)}`])) as Record<ImportFamily, string>;
    let busy = false;
    const current = () => guard({ isCurrent: options.isCurrent });
    async function authorize() { current(); if (options.authorize)
        await options.authorize();
    else {
        const { data, error } = await supabase.rpc('pilot_my_profile');
        current();
        if (error)
            throw coError(error);
        if (!Array.isArray(data) || data.length !== 1 || data[0].id !== scope.actorId || data[0].role !== options.role || data[0].is_active !== true)
            throw Object.assign(new Error('CO authority required'), { code: '42501' });
    } current(); }
    type Saved = {
        id: string;
        key: string;
        uncertain: boolean;
        binding: Identity;
        committed?: Result;
    };
    function saved(f: ImportFamily): Saved | null { const raw = options.storage().getItem(keys[f]); if (raw === null)
        return null; const v = record(JSON.parse(raw)); if (Object.keys(v).some(k => !['id', 'key', 'uncertain', 'binding', 'committed'].includes(k)))
        invalid('recovery fields'); return { id: parseUUID(v.id), key: parseHash(v.key), uncertain: parseBoolean(v.uncertain), binding: identity(v.binding, f, scope), ...(v.committed === undefined ? {} : { committed: decodeResult(f, v.committed) }) }; }
    const unresolved = () => hasScopedCORecovery(options.storage(),scope.actorId,scope.customerId,`report:${scope.reportMonth}`);
    const families = Object.fromEntries((Object.keys(names) as ImportFamily[]).map(f => {
        let active: Identity | undefined;
        const storage: Storage = { get length() { return options.storage().length; }, key: i => options.storage().key(i), clear: () => invalid('unscoped clear'), getItem: k => { if (k !== keys[f])
                invalid('storage key'); const s = saved(f); return s ? JSON.stringify(s) : null; }, setItem: (k, raw) => {
                // Persist late command outcomes even after owner loss: never erase uncertainty on cleanup.
                if (k !== keys[f])
                    invalid('storage key');
                const v = record(JSON.parse(raw)), old = saved(f), pin = old?.id === v.id ? old.binding : active;
                if (!pin)
                    invalid('request identity');
                if (!old || old.id !== v.id) {
                    current();
                    assertNoOtherCORequest(options.storage(), scope.actorId, scope.customerId, `report:${scope.reportMonth}`, keys[f]);
                }
                const next: Saved = { id: parseUUID(v.id), key: parseHash(v.key), uncertain: parseBoolean(v.uncertain), binding: identity(pin, f, scope), ...(v.committed === undefined ? {} : { committed: decodeResult(f, v.committed) }) };
                if (old?.id === next.id && old.committed) {
                    if (next.key !== old.key || next.committed && !same(next.committed, old.committed))
                        invalid('changed original result');
                    next.committed = old.committed;
                    next.uncertain = false;
                }
                options.storage().setItem(k, JSON.stringify(next));
            }, removeItem: k => { current(); if (k !== keys[f])
                invalid('storage key'); options.storage().removeItem(k); } };
        async function matches(value: Result) {
            current();
            const s = saved(f);
            if (!s)
                return false;
            const v = decodeResult(f, value), p = s.binding;
            if (s.committed && !same(s.committed, v))
                return false;
            if (f === 'prepare') {
                const b = v as ImportBinding;
                if (b.draftId !== p.draftId || b.manifestDigest !== p.digest || b.customerVersion !== p.customerVersion || BigInt(b.draftVersion) !== BigInt(p.draftVersion!) + 1n)
                    return false;
            }
            else if (f === 'review') {
                const r = v as ImportReviewResult;
                if (r.draftId !== p.draftId || r.state !== (p.action === 'open' ? 'review_open' : 'abandoned') || r.customerVersion !== p.customerVersion || BigInt(r.draftVersion) !== BigInt(p.draftVersion!) + (p.action === 'open' ? 1n : 0n))
                    return false;
            }
            else {
                const r = v as COReceipt | UnitReceipt;
                if (r.customer_id !== scope.customerId || r.operation !== p.operation || p.targetId && r.id !== p.targetId)
                    return false;
                if (p.customerVersion && BigInt(r.customer_version) !== BigInt(p.customerVersion) + 1n)
                    return false;
            }
            const response = await supabase.rpc(names[f][1], { p_request_id: s.id, p_abandon: false });
            current();
            if (response.error)
                throw coError(response.error);
            const canonical = decodeRecovery(f, response.data);
            return canonical.state === 'committed' && same(canonical.result, v);
        }
        const sender = createTransactionSender<Result>({ storage: () => storage, storageKey: keys[f], retainCommitted: true, mapError: coError, resultIdentity: v => f === 'prepare' ? (decodeResult(f, v) as ImportBinding).importId : f === 'review' ? (decodeResult(f, v) as ImportReviewResult).selectionId : (decodeResult(f, v) as COReceipt).id, decodeRecovery: v => decodeRecovery(f, v), validateResult: matches, transport: { send: async (id, _operation, payload) => { current(); const wire = f === 'commit' ? decodeImportPost({ ...record(payload), requestId: id }) : payload; return await supabase.rpc(names[f][0], { p_request_id: id, p_payload: wire }); }, reconcile: async (id, abandon) => { current(); return await supabase.rpc(names[f][1], { p_request_id: id, p_abandon: abandon }); } } });
        return [f, { sender, async send(payload: unknown, pin: Identity) { active = identity(pin, f, scope); try {
                    return await sender(pin.operation, payload);
                }
                finally {
                    active = undefined;
                } } }];
    })) as Record<ImportFamily, {
        sender: ReturnType<typeof createTransactionSender<Result>>;
        send: (p: unknown, i: Identity) => Promise<Result>;
    }>;
    async function run<T>(fn: () => Promise<T>, capture: () => void = () => { }): Promise<T> { if (busy || unresolved())
        throw new Error(IMPORT_RECOVERY_LABEL); busy = true; try {
        capture();
        await authorize();
        if (unresolved())
            throw new Error(IMPORT_RECOVERY_LABEL);
        return await fn();
    }
    finally {
        busy = false;
    } }
    const base = (family: ImportFamily): Identity => ({ family, customerId: scope.customerId, month: scope.reportMonth, operation: names[family][2] });
    return {
        hasUnresolved: unresolved,
        prepare: (input: ImportPrepare, draftId: string) => run(async () => { const p = decodeImportPrepare(input); if (!same(p.manifest.input.scope, { ...scope, epoch: p.manifest.input.scope.epoch }))
            invalid('manifest scope'); return await families.prepare.send(p, { ...base('prepare'), draftId: parseUUID(draftId), digest: p.manifest.digest, customerVersion: p.expected_customer_version, draftVersion: p.expected_draft_version }) as ImportBinding; }, () => { input = decodeImportPrepare(input); }),
        commit: (input: ImportCommitCommand, targetId?: string) => run(async () => { if (Object.hasOwn(input, 'requestId'))
            invalid('sender owns request identity'); const b = decodeImportBinding(input.binding); return await families.commit.send(input, { ...base('commit'), operation: input.mode === 'edit' ? 'correct_report' : 'post_report', binding: b, customerVersion: b.customerVersion, ...(targetId ? { targetId: parseUUID(targetId) } : {}) }) as COReceipt; }, () => { input = decodeImportCommitCommand(input); }),
        review: (input: ImportReviewCommand) => run(async () => { const p = record(input); if (!['open', 'abandon'].includes(p.action) || !p.reason?.trim())
            invalid('review command'); return await families.review.send(input, { ...base('review'), draftId: parseUUID(input.draft_id), action: input.action, draftVersion: parseVersion(input.expected_draft_version), customerVersion: parseVersion(input.expected_customer_version) }) as ImportReviewResult; }, () => { input = decodeImportReviewCommand(input); }),
        declareUnit: (input: UnitDeclaration) => run(async () => { const p = decodeUnitDeclaration(input); if (p.customer_id !== scope.customerId)
            invalid('unit customer'); return await families.unit.send(p, { ...base('unit'), stockKeyId: p.stock_key_id, customerVersion: p.expected_customer_version }) as UnitReceipt; }, () => { input = decodeUnitDeclaration(input); }),
        async recover(): Promise<ImportRecovered> { if (busy)
            throw new Error(IMPORT_RECOVERY_LABEL); busy = true; try {
            await authorize();
            const f = (Object.keys(names) as ImportFamily[]).find(f => { const s = saved(f); return s?.uncertain || s?.committed; });
            if (!f)
                throw new Error(IMPORT_RECOVERY_LABEL);
            const r = await families[f].sender.reconcile();
            current();
            return r.state === 'committed' ? { family: f, status: 'committed', result: r.result! } : { family: f, status: r.state };
        }
        finally {
            busy = false;
        } },
        identity(f: ImportFamily) { current(); const s = saved(f); if (!s?.committed)
            invalid('unconfirmed result'); return { ...s.binding }; },
        async acknowledge(f: ImportFamily, result: Result, live: () => boolean = () => true) { await authorize(); if (!live())
            invalid('owner changed'); const before = saved(f); if (!before?.committed || !same(before.committed, result))
            invalid('unconfirmed original result'); const r = await families[f].sender.reconcile(); current(); if (!live() || r.state !== 'committed' || !same(r.result, result) || saved(f)?.id !== before.id)
            invalid('changed result'); families[f].sender.acknowledgeRecovered(); },
    };
}
export type ImportCommands = ReturnType<typeof createImportCommands>;
export type PrepareImportOptions = COReadOptions & {
    commands: ImportCommands;
    draftId: string;
    customerVersion: string;
    draftVersion: string;
    expectedSelectionId?: string;
};
/** Required owner/version context extends the brief's read options; never guess current versions. */
export async function prepareImport(input: ReviewInput, evidenceId: string, o: PrepareImportOptions) {
    guard(o);
    const manifest = { schemaVersion: 1 as const, evidenceId: parseUUID(evidenceId), input: structuredClone(input), digest: '0'.repeat(64) };
    manifest.digest = await manifestDigest(manifest);
    guard(o);
    const binding = await o.commands.prepare({ manifest, expected_customer_version: o.customerVersion, expected_draft_version: o.draftVersion, expected_evidence_version: '2', ...(o.expectedSelectionId ? { expected_selection_id: o.expectedSelectionId } : {}) }, o.draftId);
    guard(o);
    return binding;
}

export async function readReturnCandidates(customerId:string,stockKeyId:string,customerVersion:string,page:number,o:COReadOptions={}) { return decodeReturnCandidates(await read('pilot_co_import_return_candidates_v1',{p_customer_id:parseUUID(customerId),p_stock_key_id:parseUUID(stockKeyId),p_expected_customer_version:parseVersion(customerVersion),p_page:page,p_page_size:25},o),customerId,stockKeyId,customerVersion,page); }
