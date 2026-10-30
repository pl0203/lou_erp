import { buildManualTranscription, type ManualSourceInput } from '../../lib/co/import/manual';
import { scopedCORecoveryKeys } from '../../lib/co/import/recoveryScope';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useCOActor } from './COShared';
import { extractReport } from '../../lib/co/import/workerClient';
import { createImportCommands, IMPORT_RECOVERY_LABEL, prepareImport, previewImport, readImport, readImportSelection, readStockKeyUnits, readAllImportEligible, type ImportRecovered, type ImportEligibleContext } from '../../lib/co/import/rpc';
import type { ImportBinding, ImportPreview, ImportScope, ReviewInput, ExtractedReport, ImportReopenAcknowledgment, ImportPost, ReviewValidation } from '../../lib/co/import/types';
import type { COReceipt } from '../../lib/co/contracts';
import type { COReadOptions } from '../../lib/co/rpc';
import { fetchCOReport } from '../../lib/co/rpc';
import { createCOTransactionSender } from '../../lib/co/transactions';
import { createEvidenceSender, fetchEvidence, fetchEvidenceSelection, prepareEvidenceFile, uploadEvidence, type EvidenceReceipt } from '../../lib/co/evidence';
import { invalid, parseHash, parseUUID } from '../../lib/co/validation';
import { canonicalManifestValue } from '../../lib/co/import/manifest';
import { isCOAuthorityError } from '../../lib/co/authority';
import { validateReview } from '../../lib/co/import/review';
import type { UnitDeclaration } from '../../lib/co/import/units';
import type { ImportReviewResult, ImportSelection } from '../../lib/co/import/manifest';
export type ImportContextSnapshot = {
    scope: Readonly<ImportScope>;
    context: Readonly<ImportEligibleContext>;
    selection: Readonly<ImportSelection>;
    rows: readonly import('../../lib/co/validation').COReportRow[];
    units: readonly import('../../lib/co/import/units').COStockKeyUnit[];
};
function contextEligibility(snapshot: ImportContextSnapshot) { const units = new Map(snapshot.units.map(u => [u.stockKeyId, u.declaration?.unit ?? ''])); return snapshot.rows.map(r => ({ stockKeyId: r.stock_key_id, unit: units.get(r.stock_key_id) ?? '', available: r.eligible_quantity })); }
function immutableContext(snapshot: ImportContextSnapshot): ImportContextSnapshot { const value = structuredClone(snapshot); const freeze = (v: unknown) => { if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
} }; freeze(value); return value; }
export type ImportSupportingResult = {
    family: 'prepare';
    result: ImportBinding;
    identity: Record<string, unknown>;
} | {
    family: 'review';
    result: ImportReviewResult;
    identity: Record<string, unknown>;
} | {
    family: 'unit';
    result: import('../../lib/co/import/units').UnitReceipt;
    identity: Record<string, unknown>;
} | {
    family: 'evidence';
    result: EvidenceReceipt;
    identity: Record<string, unknown>;
} | {
    family: 'ordinary';
    result: COReceipt;
    identity: Record<string, unknown>;
};
/** Raised only after canonical terminal result + immutable scope proof, never for unknown/corrupt results. */
export class ImportSupportingResultChanged extends Error {
    readonly code = 'CO_IMPORT_SUPPORTING_CHANGED';
    readonly terminal: ImportSupportingResult;
    constructor(terminal: ImportSupportingResult) { super('Hasil asli ditemukan, tetapi konteks tinjauan telah berubah. Akui hasil asli dan pilih berkas kembali untuk tinjauan baru.'); this.terminal = structuredClone(terminal); }
}
/** Editable intent only. No historical evidence ID, File, binding or preview capability. */
export type ImportEditSeed = {revisionId:string;manifestDigest:string;sourceSha256:string;input:ReviewInput};
type EditSeedProvenance = Omit<ImportEditSeed,'input'>;
function unconfirmSeed(input:ReviewInput):ReviewInput{return {...input,completenessConfirmed:false,mappings:input.mappings.map(m=>({...m,confirmed:false})),sourceConfirmations:(input.sourceConfirmations??[]).map(c=>({...c,confirmed:false})),returns:input.returns.map(r=>r.state==='none'?{...r}:({...r,state:'unresolved',stockImpact:'uncertain',links:r.links.map(({returnRevisionId,quantity})=>({returnRevisionId,quantity}))}))};}
export type ImportReviewState = {
    editSeed: EditSeedProvenance | null;
    sourceReset: boolean;
    needsFreshReview: boolean;
    preparedReviewReady:boolean;
    previewAcknowledgments:ImportReopenAcknowledgment[];
    context: ImportContextSnapshot | null;
    validation: ReviewValidation | null;
    supportingResult: ImportSupportingResult | null;
    phase: 'select' | 'processing' | 'review' | 'preview' | 'committing' | 'unknown' | 'recorded' | 'error';
    input: ReviewInput | null;
    file: File | null;
    preview: ImportPreview | null;
    receipt: COReceipt | null;
    error: unknown;
    recoveryLabel: typeof IMPORT_RECOVERY_LABEL;
    manualReviewRequired: boolean;
};
export type ImportReviewPorts = {
    isCurrent: () => boolean;
    hasUnresolved: () => boolean;
    loadContext: (reason: string | null, o: COReadOptions) => Promise<ImportContextSnapshot>;
    extract: (file: File, scope: ImportScope, signal: AbortSignal) => Promise<ExtractedReport>;
    prepare: (input: ReviewInput, file: File, o: COReadOptions) => Promise<ImportBinding>;
    preview: (binding: ImportBinding, o: COReadOptions, acks: ImportReopenAcknowledgment[]) => Promise<ImportPreview>;
    commit: (post: Omit<ImportPost, 'requestId'>, o: COReadOptions) => Promise<COReceipt>;
    acceptReceipt: (receipt: COReceipt, o: COReadOptions, acceptChanged?: boolean) => Promise<void>;
    recover: (o: COReadOptions) => Promise<{
        status: 'abandoned' | 'unknown';
    } | {
        status: 'committed';
        receipt?: COReceipt;
        input?: ReviewInput;
        binding?: ImportBinding;
    }>;
    declareUnit: (input: UnitDeclaration, o: COReadOptions) => Promise<void>;
    acknowledgeSupporting: (terminal: ImportSupportingResult, o: COReadOptions) => Promise<void>;
    abandon: (reason: string, o: COReadOptions) => Promise<void>;
};
/** Mounted-memory controller; persistence belongs exclusively to the scoped command senders. */
export function createImportReviewController(scope: ImportScope, ports: ImportReviewPorts) {
    const bound = { ...scope };
    let generation = 0, controller = new AbortController(), busy = false, disposed = false, readBlocked = false, primaryBlocked=false, seedBlocked=false;
    let pendingAttachment:{generation:number;input:ReviewInput;provenance:EditSeedProvenance;source:string}|null=null;
    let seedSource:string|null=null;
    let state: ImportReviewState = { editSeed:null, sourceReset:false, needsFreshReview:false,preparedReviewReady:false,previewAcknowledgments:[], context: null, validation: null, supportingResult: null, phase: ports.hasUnresolved() ? 'unknown' : 'select', input: null, file: null, preview: null, receipt: null, error: null, recoveryLabel: IMPORT_RECOVERY_LABEL, manualReviewRequired: false };
    let prepared: ImportBinding | null = null, acknowledgments: ImportReopenAcknowledgment[] = [];
    const listeners = new Set<() => void>();
    function publish(p: Partial<ImportReviewState>) {
        state = { ...state, ...p };
        if (Object.hasOwn(p, 'input') && p.input === null) {
            state.context = null;
            state.validation = null;
            if(p.file==null){seedSource=null;state.editSeed=null;state.sourceReset=false;state.needsFreshReview=false;}
        }
        else if (state.input && state.context)
            state.validation = validateReview(state.input, contextEligibility(state.context));
        else
            state.validation = null;
        if(Object.hasOwn(p,'preview')&&p.preview===null)state.previewAcknowledgments=[];
        state.preparedReviewReady=!!prepared&&!!state.input&&!readBlocked&&!primaryBlocked&&!ports.hasUnresolved()&&state.phase!=='unknown';
        listeners.forEach(fn => fn());
    }
    const current = () => !disposed && ports.isCurrent();
    function reset() { generation++; controller.abort(); controller = new AbortController(); prepared = null; acknowledgments = []; }
    function blocked() { return !current() || readBlocked || primaryBlocked || busy || ports.hasUnresolved() || state.phase === 'unknown'; }
    async function run(phase: ImportReviewState['phase'], action: (o: COReadOptions) => Promise<void>, recover = false) {
        if (!current() || readBlocked || busy || !recover && blocked())
            return;
        busy = true;
        const g = generation, signal = controller.signal, isCurrent = () => current() && g === generation && !signal.aborted, o = { signal, isCurrent };
        publish({ phase, error: null });
        try {
            await action(o);
        }
        catch (error) {
            if (isCurrent()) {
                if (error instanceof ImportSupportingResultChanged)
                    publish({ supportingResult: error.terminal, context: null, validation: null });
                if (isCOAuthorityError(error)) {
                    seedBlocked=true;pendingAttachment=null;reset();
                    busy = false;
                    publish({ input: null, file: null, preview: null, receipt: null, supportingResult: null });
                }
                if ((error as {
                    code?: string;
                })?.code === 'PT409')
                    prepared = null;
                publish({ phase: ports.hasUnresolved() || error instanceof ImportSupportingResultChanged || (error as {
                        code?: string;
                    })?.code === 'CO_IMPORT_CURRENT_CHANGED' ? 'unknown' : 'error', error, preview: null });
            }
        }
        finally {
            if (g === generation)
                busy = false;
        }
    }
    function check(o: COReadOptions) {
        o.signal?.throwIfAborted();
        if (!o.isCurrent?.())
            invalid('import owner changed');
    }
    function interruptAttachment():Partial<ImportReviewState>{
        const saved=pendingAttachment;pendingAttachment=null;
        if(!saved||saved.generation!==generation)return {};
        if(!current()||seedBlocked){seedSource=null;return {input:null,file:null,editSeed:null};}
        seedSource=saved.source;
        return {input:saved.input,file:null,editSeed:saved.provenance};
    }
    const api = {
        getSnapshot: () => state, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        seedEdit(seed:ImportEditSeed){
            if(seedBlocked||blocked()||state.input||state.file)return;
            parseUUID(seed.revisionId);parseHash(seed.manifestDigest);parseHash(seed.sourceSha256);
            if(seed.input.scope.customerId!==bound.customerId||seed.input.scope.reportMonth!==bound.reportMonth||seed.sourceSha256!==seed.input.extracted.sha256)invalid('Edit seed scope');
            seedSource=canonicalManifestValue(seed.input.extracted);
            const input=unconfirmSeed({...structuredClone(seed.input),scope:bound,reason:null});
            publish({phase:'review',input,file:null,preview:null,editSeed:{revisionId:seed.revisionId,manifestDigest:seed.manifestDigest,sourceSha256:seed.sourceSha256},sourceReset:false,needsFreshReview:false});
        },
        setReadBlocked(value:boolean){
            if(disposed||readBlocked===value)return;
            readBlocked=value;
            if(value){const retained=interruptAttachment();reset();busy=false;const input=Object.hasOwn(retained,'input')?retained.input:state.input;publish({...retained,preview:null,context:null,validation:null,needsFreshReview:!!input,phase:ports.hasUnresolved()||state.phase==='unknown'?'unknown':input?'review':'select'});}
        },
        setPrimaryBlocked(value:boolean){
            if(disposed||primaryBlocked===value)return;
            primaryBlocked=value;
            if(value){const retained=interruptAttachment();reset();busy=false;publish({...retained,preview:null,context:null,validation:null,needsFreshReview:!!(retained.input??state.input)});}else publish({});
        },
        invalidatePreview(fingerprint:string,error:unknown){
            if(blocked()||state.preview?.previewFingerprint!==fingerprint)return;
            reset();busy=false;publish({preview:null,context:null,validation:null,needsFreshReview:true,phase:'review',error});
        },
        async refreshReview(){await api.loadContext();if((state.validation?.canConfirm||state.validation?.canRequestServerCheck)&&!blocked())await api.review();},
        async loadContext() { await run('processing', async (o) => { prepared = null; acknowledgments = []; publish({ preview: null }); const snapshot = await ports.loadContext(state.input?.reason ?? null, o); check(o); if (snapshot.scope.actorId !== bound.actorId || snapshot.scope.customerId !== bound.customerId || snapshot.scope.reportMonth !== bound.reportMonth || snapshot.scope.epoch !== bound.epoch)
            invalid('mapping context owner');
            // Rebind only the current mounted decisions to the freshly read declarations.
            // The declaration request is not evidence of its accepted unit. Preserve raw
            // sales quantities/conversion and require confirmation again when the unit changes.
            const input = state.input;
            const declaredUnits = new Map(snapshot.units.map(row => [row.stockKeyId, row.declaration?.unit ?? null]));
            const mappings = input?.mappings.map(mapping => {
                const unit = mapping.stockKeyId ? declaredUnits.get(mapping.stockKeyId) ?? null : null;
                return mapping.ledgerUnit === unit ? mapping : { ...mapping, ledgerUnit: unit, confirmed: false };
            });
            publish({ needsFreshReview:false, context: immutableContext(snapshot), phase: input ? 'review' : 'select', ...(input ? { input: { ...input, mappings: mappings! } } : {}) }); }); },
        async loadFile(file: File, reason: string | null = null) {
            if (blocked()) return;
            const previous=state.input,provenance=state.editSeed;
            reset();const loadingGeneration=generation;
            pendingAttachment=previous&&provenance&&seedSource?{generation:loadingGeneration,input:structuredClone(previous),provenance:{...provenance},source:seedSource}:null;
            publish({ input: null, file, preview: null, receipt: null, manualReviewRequired: false });
            await run('processing', async (o) => {
                const extracted = await ports.extract(file, bound, o.signal!); check(o);
                const compatible=!!previous&&!!provenance&&seedSource===canonicalManifestValue(extracted);
                const input:ReviewInput=compatible?unconfirmSeed({...previous!,scope:bound,extracted,reason:reason?.trim()||previous!.reason}):{scope:bound,extracted,mappings:[],returns:[],includedSectionIds:extracted.sections.map(s=>s.id),completenessConfirmed:false,omittedZeroStockKeyIds:[],currency:null,reason:reason?.trim()||previous?.reason||null};
                if(!compatible)seedSource=null;
                publish({phase:'review',manualReviewRequired:extracted.warnings.some(w=>w.startsWith('manual_review:')),input,editSeed:compatible?provenance:null,sourceReset:!!provenance&&!compatible,needsFreshReview:false});
            });
            if(loadingGeneration===generation&&current()&&state.phase==='error'&&!state.input&&previous&&provenance&&!isCOAuthorityError(state.error))publish({input:previous,file:null,editSeed:provenance});
            if(pendingAttachment?.generation===loadingGeneration)pendingAttachment=null;
        },
        transcribeSource(proposal: ManualSourceInput) {
            if (blocked() || !state.file || !state.input || !state.manualReviewRequired) return;
            const extracted = buildManualTranscription(state.input.extracted, proposal);
            reset(); prepared = null; acknowledgments = [];
            seedSource=null;
            publish({editSeed:null,sourceReset:false,phase:'review', preview:null, manualReviewRequired:false, input:{...state.input,extracted,mappings:[],returns:[],sourceConfirmations:[],includedSectionIds:[],completenessConfirmed:false,omittedZeroStockKeyIds:[],currency:null,reason:null}});
        },
        updateReview(patch: Partial<Omit<ReviewInput, 'scope' | 'extracted'>>) {
            if (blocked() || !state.input)
                return;
            reset();
            publish({ phase: 'review', preview: null, error: null, input: { ...state.input, ...structuredClone(patch), scope: bound, extracted: state.input.extracted } });
        },
        async review(acks: ImportReopenAcknowledgment[] = []) {
            if (!state.input || (!state.file && !prepared) || state.manualReviewRequired)
                return;
            const input = structuredClone(state.input), file = state.file;
            await run('processing', async (o) => {
                if (!prepared) {
                    const binding = await ports.prepare(input, file!, o);
                    check(o);
                    prepared = binding;
                }
                check(o);
                acknowledgments = structuredClone(acks);
                const preview = await ports.preview(prepared, o, acknowledgments);
                check(o);
                if(input.returns.some(decision=>decision.state==='unresolved'&&!preview.issues.some(issue=>issue.code==='return_unresolved_prior_coverage_proven'&&issue.rowId===decision.rowId&&!issue.blocking)))
                    throw new Error('Cakupan retur tercatat belum dibuktikan server untuk setiap baris yang belum dicocokkan.');
                publish({ phase: 'preview', preview,previewAcknowledgments:structuredClone(acknowledgments) });
            });
        },
        async confirm() {
            const preview = state.preview, input = state.input;
            if (state.phase !== 'preview' || !preview || !input || !preview.existingPreview.can_post || preview.issues.some(i => i.blocking))
                return;
            await run('committing', async (o) => { const receipt = await ports.commit({ binding: preview.binding, previewFingerprint: preview.previewFingerprint, mode: preview.existingPreview.operation === 'correct_report' ? 'edit' : 'post', reason: input.reason, acknowledgedReopenOrders: acknowledgments }, o); check(o); publish({ receipt }); await ports.acceptReceipt(receipt, o); check(o); publish({ phase: 'recorded', preview: null, file: null, input: null }); });
        },
        cancel() {
            if (!current())
                return;
            seedBlocked=true;pendingAttachment=null;reset();
            busy = false;
            seedSource=null;
            publish({ editSeed:null,sourceReset:false,needsFreshReview:false,phase: ports.hasUnresolved() ? 'unknown' : 'select', file: null, input: null, preview: null, error: null, manualReviewRequired: false });
        },
        async recover() {
            await run('processing', async (o) => {
                const result = await ports.recover(o);
                check(o);
                if (result.status === 'committed' && result.receipt) {
                    publish({ receipt: result.receipt });
                    await ports.acceptReceipt(result.receipt, o);
                    check(o);
                    publish({ phase: 'recorded', input: null, file: null, preview: null });
                }
                else if (result.status === 'committed' && result.input && result.binding) {
                    prepared = result.binding;
                    publish({ phase: 'review', input: { ...result.input, scope: bound }, file: null, preview: null, needsFreshReview: false });
                }
                else
                    publish({ phase: ports.hasUnresolved() ? 'unknown' : state.input ? 'review' : 'select', preview: null });
            }, true);
        },
        async acknowledgeSupporting() { const terminal = state.supportingResult; if (state.phase !== 'unknown' || !terminal)
            return; await run('processing', async (o) => { try {
            await ports.acknowledgeSupporting(terminal, o);
            check(o);
            publish({ phase: ports.hasUnresolved() ? 'unknown' : 'select', supportingResult: null, file: null, input: null, preview: null, receipt: null });
            prepared = null;
            acknowledgments = [];
        }
        finally {
            if (o.isCurrent?.() && !ports.hasUnresolved())
                publish({ supportingResult: null, file: null, input: null, preview: null });
        } }, true); },
        async acceptRecovered() {
            const receipt = state.receipt;
            if (state.phase !== 'unknown' || !receipt || (state.error as {
                code?: string;
            })?.code !== 'CO_IMPORT_CURRENT_CHANGED')
                return;
            await run('processing', async (o) => { await ports.acceptReceipt(receipt, o, true); check(o); publish({ phase: 'recorded', receipt, input: null, file: null, preview: null }); }, true);
        },
        async declareUnit(input: UnitDeclaration) { await run('processing', async (o) => { prepared = null; publish({ preview: null, context: null, validation: null }); await ports.declareUnit(input, o); check(o); prepared = null; publish({ phase: state.input ? 'review' : 'select', preview: null }); }); },
        async abandonReview(reason: string) { await run('processing', async (o) => { await ports.abandon(reason, o); check(o); reset(); busy = false; publish({ phase: 'select', file: null, input: null, preview: null }); }); },
        refreshRecoveryState() {
            if (!current())
                return;
            if (ports.hasUnresolved()) {
                const retained=interruptAttachment();reset();
                busy = false;
                publish({ ...retained,phase: 'unknown', preview: null });
            }
            else if (state.phase === 'unknown')
                publish({ phase: state.input ? 'review' : 'select', supportingResult: null, error: null });
        },
        invalidate() { seedBlocked=true;pendingAttachment=null;reset(); seedSource=null; busy = false; publish({editSeed:null,sourceReset:false,needsFreshReview:false, phase: ports.hasUnresolved() ? 'unknown' : 'select', input: null, file: null, preview: null, receipt: null, supportingResult: null, error: null }); },
        // React root StrictMode replays effect setup after cleanup on the same
        // controller. Cleanup has already aborted/reset the previous generation;
        // setup may reactivate only its still-current authenticated owner.
        activate() { if (ports.isCurrent()){disposed = false;seedBlocked=false;} },
        dispose() { disposed = true; api.invalidate(); listeners.clear(); },
    };
    return api;
}
/** Production ports compose, rather than bypass, existing owner-guarded domain senders. */
export function createImportReviewPorts(scope: ImportScope, role: string, isCurrent: () => boolean, reject: (e: unknown) => void): ImportReviewPorts {
    const owner = { actorId: scope.actorId, role, customerId: scope.customerId, scope: `report:${scope.reportMonth}`, storage: () => window.localStorage, isCurrent, retainCommitted: true };
    const commands = createImportCommands({ scope, role, storage: owner.storage, isCurrent });
    const ordinary = createCOTransactionSender(owner), evidence = createEvidenceSender(owner);
    const unresolved = () => commands.hasUnresolved() || ordinary.hasUnresolved() || evidence.hasUnresolved();
    // Each command sender captures this operation's AbortSignal/generation as well as actor authority.
    // Cancellation during profile authorization/hash work cannot later send through a live new owner.
    const senders = (o: COReadOptions) => {
        const live = () => {
            try {
                check(o);
                return true;
            }
            catch {
                return false;
            }
        };
        return { commands: createImportCommands({ scope, role, storage: owner.storage, isCurrent: live }), ordinary: createCOTransactionSender({ ...owner, isCurrent: live }), evidence: createEvidenceSender({ ...owner, isCurrent: live }) };
    };
    const check = (o: COReadOptions) => {
        o.signal?.throwIfAborted();
        if (!isCurrent() || o.isCurrent && !o.isCurrent())
            invalid('import owner changed');
    };
    const readReport = async (o: COReadOptions) => { check(o); const r = await fetchCOReport(scope.customerId, scope.reportMonth, null, o); check(o); return r; };
    async function acceptOrdinary(receipt: COReceipt, o: COReadOptions, acceptChanged = false) {
        const pin = ordinary.getCommittedIdentity(receipt), r = await readReport(o);
        if (receipt.customer_id !== scope.customerId || receipt.operation !== 'save_report_draft' || r.draft?.draft_id !== receipt.id || BigInt(r.draft.draft_version) < BigInt(receipt.version) || BigInt(r.customer_version) < BigInt(receipt.customer_version))
            invalid('original draft result scope');
        if (!acceptChanged && (r.draft.draft_version !== receipt.version || r.customer_version !== receipt.customer_version))
            throw new ImportSupportingResultChanged({ family: 'ordinary', result: receipt, identity: pin });
        await ordinary.acknowledgeRecovered(o.isCurrent);
        check(o);
        return r;
    }
    async function acceptReview(result: ImportReviewResult, o: COReadOptions, acceptChanged = false) {
        const pin = commands.identity('review'), r = await readReport(o);
        if (r.draft?.draft_id !== result.draftId || pin.draftId !== result.draftId)
            invalid('review result scope');
        const s = await readImportSelection(result.draftId, o);
        check(o);
        if (!s.selectionId || BigInt(s.draftVersion) < BigInt(result.draftVersion) || BigInt(s.customerVersion) < BigInt(result.customerVersion))
            invalid('review chronology');
        if (!acceptChanged && (s.selectionId !== result.selectionId || s.state !== result.state || s.draftVersion !== result.draftVersion || s.customerVersion !== result.customerVersion))
            throw new ImportSupportingResultChanged({ family: 'review', result, identity: pin });
        await commands.acknowledge('review', result, o.isCurrent);
        check(o);
    }
    async function acceptEvidence(receipt: EvidenceReceipt, o: COReadOptions, acceptChanged = false) {
        const pin = evidence.getCommittedIdentity(receipt), e = await fetchEvidence(receipt.id, o.isCurrent);
        check(o);
        if (e.customer_id !== scope.customerId || e.report_month !== scope.reportMonth || e.customer_version !== receipt.customer_version || receipt.operation === 'register_evidence' && (pin.draft_id !== e.draft_id || receipt.version !== '1') || receipt.operation === 'finalize_evidence' && (pin.target_id !== e.id || e.state !== 'finalized' || e.version !== receipt.version))
            invalid('evidence result scope');
        const r = await readReport(o), expectedVersion = receipt.operation === 'finalize_evidence' ? e.finalized_draft_version! : e.draft_version;
        if (r.draft?.draft_id !== e.draft_id || BigInt(r.customer_version) < BigInt(e.customer_version) || BigInt(r.draft.draft_version) < BigInt(expectedVersion))
            invalid('evidence draft scope');
        let changed = r.customer_version !== e.customer_version || r.draft.draft_version !== expectedVersion;
        if (receipt.operation === 'finalize_evidence') {
            const selected = await fetchEvidenceSelection({ customerId: scope.customerId, draftId: e.draft_id, draftVersion: r.draft.draft_version }, o.isCurrent);
            check(o);
            changed = changed || selected?.id !== e.id || selected?.version !== e.version || selected?.finalized_draft_version !== e.finalized_draft_version;
        }
        if (!acceptChanged && changed)
            throw new ImportSupportingResultChanged({ family: 'evidence', result: receipt, identity: pin });
        await evidence.acknowledgeRecovered(o.isCurrent);
        check(o);
        return e;
    }
    async function acceptPrepare(binding: ImportBinding, o: COReadOptions, acceptChanged = false) {
        const pin = commands.identity('prepare'), historical = await readImport(binding, o);
        check(o);
        if (historical.manifest.input.scope.customerId !== scope.customerId || historical.manifest.input.scope.reportMonth !== scope.reportMonth || historical.manifest.input.scope.actorId !== scope.actorId)
            invalid('historical import scope');
        const r = await readReport(o);
        if (r.draft?.draft_id !== binding.draftId || pin.draftId !== binding.draftId)
            invalid('prepare draft scope');
        const selected = await readImportSelection(binding.draftId, o);
        check(o);
        if (!selected.selectionId || BigInt(selected.draftVersion) < BigInt(binding.draftVersion) || BigInt(selected.customerVersion) < BigInt(binding.customerVersion))
            invalid('prepare chronology');
        if (!acceptChanged && (selected.importId !== binding.importId || selected.draftVersion !== binding.draftVersion || selected.customerVersion !== binding.customerVersion))
            throw new ImportSupportingResultChanged({ family: 'prepare', result: binding, identity: pin });
        await commands.acknowledge('prepare', binding, o.isCurrent);
        check(o);
        return historical.manifest.input;
    }
    async function acceptUnit(receipt: import('../../lib/co/import/units').UnitReceipt, o: COReadOptions, acceptChanged = false) {
        const pin = commands.identity('unit'), r = await readReport(o);
        if (receipt.customer_id !== scope.customerId || BigInt(r.customer_version) < BigInt(receipt.customer_version))
            invalid('unit result scope');
        const units = await readStockKeyUnits(scope.customerId, [pin.stockKeyId!], r.customer_version, o);
        check(o);
        if (units.rows[0].state !== 'declared' || units.rows[0].declaration.id !== receipt.id || units.rows[0].declaration.version !== receipt.version)
            invalid('declared unit identity');
        if (!acceptChanged && r.customer_version !== receipt.customer_version)
            throw new ImportSupportingResultChanged({ family: 'unit', result: receipt, identity: pin });
        await commands.acknowledge('unit', receipt, o.isCurrent);
        check(o);
    }
    async function context(o: COReadOptions, reason: string | null, forPreparation: boolean) {
        let report = await readReport(o), draft = report.draft;
        if (!draft) {
            if (unresolved())
                throw new Error(IMPORT_RECOVERY_LABEL);
            const receipt = await senders(o).ordinary('save_report_draft', { action: 'initialize', customer_id: scope.customerId, report_month: scope.reportMonth, expected_customer_version: report.customer_version });
            check(o);
            report = await acceptOrdinary(receipt, o);
            draft = report.draft;
        }
        if (!draft?.draft_id)
            invalid('missing internal report context');
        let selection = await readImportSelection(draft.draft_id, o);
        check(o);
        if (selection.state === null && !draft.consumed && draft.context_issue) {
            const receipt = await senders(o).ordinary('save_report_draft', { action: 'initialize', customer_id: scope.customerId, report_month: scope.reportMonth, expected_customer_version: report.customer_version, draft_id: draft.draft_id, expected_draft_version: draft.draft_version });
            check(o);
            report = await acceptOrdinary(receipt, o);
            draft = report.draft;
            selection = await readImportSelection(draft.draft_id, o);
            check(o);
        }
        if (selection.state === 'selected' && (forPreparation || !!draft.context_issue) || selection.state === 'abandoned' || selection.state === 'review_open' && !!draft.context_issue || draft.consumed) {
            if (report.effective && !reason?.trim())
                throw new Error('Alasan perubahan wajib diisi.');
            const result = await senders(o).commands.review({ draft_id: selection.draftId, expected_draft_version: selection.draftVersion, expected_customer_version: report.customer_version, expected_selection_id: selection.selectionId, original_revision_id: selection.originalRevisionId, expected_report_version: selection.reportVersion, action: 'open', reason: reason?.trim() || 'Meninjau ulang berkas laporan' });
            check(o);
            await acceptReview(result, o);
            report = await readReport(o);
            draft = report.draft;
            selection = await readImportSelection(result.draftId, o);
            check(o);
        }
        if (draft.context_issue || draft.customer_version !== report.customer_version)
            throw new Error('Konteks stok berubah. Periksa laporan terkini sebelum meninjau berkas.');
        return { report, draft, selection };
    }
    async function loadContext(reason: string | null, o: COReadOptions, forPreparation = false): Promise<ImportContextSnapshot> {
        check(o);
        if (unresolved())
            throw new Error(IMPORT_RECOVERY_LABEL);
        const c = await context(o, reason, forPreparation), binding: ImportEligibleContext = { draftId: c.draft.draft_id, draftVersion: c.draft.draft_version, customerId: scope.customerId, customerVersion: c.report.customer_version, reportMonth: scope.reportMonth, selectionId: c.selection.selectionId };
        const rows = await readAllImportEligible(binding, o);
        check(o);
        const units: import('../../lib/co/import/units').COStockKeyUnit[] = [];
        for (let start = 0; start < rows.length; start += 1000) {
            units.push(...(await readStockKeyUnits(scope.customerId, rows.slice(start, start + 1000).map(r => r.stock_key_id), binding.customerVersion, o)).rows);
            check(o);
        }
        return immutableContext({ scope: { ...scope }, context: binding, selection: c.selection, rows: rows as import('../../lib/co/validation').COReportRow[], units });
    }
    const ports: ImportReviewPorts = {
        isCurrent, hasUnresolved: unresolved, extract: extractReport, loadContext,
        async prepare(input, file, o) {
            check(o);
            if (unresolved())
                throw new Error(IMPORT_RECOVERY_LABEL);
            const snapshot = await loadContext(input.reason, o, true), d = { draft_id: snapshot.context.draftId, draft_version: snapshot.context.draftVersion };
            const validation = validateReview(input, contextEligibility(snapshot));
            if (!validation.canConfirm&&!validation.canRequestServerCheck)
                throw Object.assign(new Error('Tinjauan belum lengkap.'), { issues: validation.issues });
            const original = await prepareEvidenceFile(file, () => {
                try {
                    check(o);
                    return true;
                }
                catch {
                    return false;
                }
            });
            check(o);
            if (original.sha256 !== input.extracted.sha256)
                invalid('original file hash');
            const registration = await senders(o).evidence('register_evidence', { draft_id: d.draft_id, expected_draft_version: d.draft_version, expected_customer_version: snapshot.context.customerVersion, filename: original.filename, mime_type: original.mime_type, byte_size: original.byte_size, sha256: original.sha256 });
            check(o);
            let e = await acceptEvidence(registration, o);
            if (e.draft_id !== d.draft_id || e.draft_version !== d.draft_version)
                invalid('fresh evidence registration');
            // Base verification can precede a failed optional classifier receipt.
            // Manual-v2 must retry the byte-bound Edge attestation before finalizing.
            if (e.state === 'pending' || e.state === 'verified' && input.extracted.manualTranscription?.version === 2) {
                await uploadEvidence(e.id, original.bytes, o.isCurrent!);
                check(o);
                e = await fetchEvidence(e.id, o.isCurrent);
                check(o);
            }
            if (e.state !== 'verified')
                invalid('fresh verified evidence required');
            const finalized = await senders(o).evidence('finalize_evidence', { evidence_id: e.id, expected_evidence_version: e.version, expected_draft_version: d.draft_version, expected_customer_version: snapshot.context.customerVersion });
            check(o);
            e = await acceptEvidence(finalized, o);
            const fresh = await readReport(o);
            if (fresh.draft?.draft_id !== d.draft_id || fresh.draft.draft_version !== e.finalized_draft_version)
                invalid('final evidence context');
            const binding = await prepareImport(input, e.id, { ...o, commands: senders(o).commands, draftId: d.draft_id, customerVersion: fresh.customer_version, draftVersion: fresh.draft.draft_version, ...(snapshot.selection.state === 'review_open' ? { expectedSelectionId: snapshot.selection.selectionId! } : {}) });
            check(o);
            await acceptPrepare(binding, o);
            return binding;
        },
        preview: previewImport,
        async commit(post, o) {
            check(o);
            if (unresolved())
                throw new Error(IMPORT_RECOVERY_LABEL);
            const selection = await readImportSelection(post.binding.draftId, o);
            check(o);
            if (selection.importId !== post.binding.importId || selection.draftVersion !== post.binding.draftVersion || selection.customerVersion !== post.binding.customerVersion)
                invalid('current preview selection');
            return senders(o).commands.commit(post, post.mode === 'edit' ? selection.reportHeadId ?? undefined : undefined);
        },
        async acceptReceipt(receipt, o, acceptChanged = false) {
            check(o);
            const pin = commands.identity('commit');
            if (receipt.customer_id !== scope.customerId || receipt.operation !== pin.operation)
                invalid('import receipt scope');
            const original = await readImport(pin.binding!, o);
            check(o);
            if (original.manifest.input.scope.customerId !== scope.customerId || original.manifest.input.scope.reportMonth !== scope.reportMonth)
                invalid('original import scope');
            const report = await readReport(o);
            if (report.effective?.report_head_id !== receipt.id || BigInt(report.effective.report_version) < BigInt(receipt.version) || BigInt(report.customer_version) < BigInt(receipt.customer_version))
                invalid('canonical report identity');
            if (!acceptChanged && (report.effective.report_version !== receipt.version || report.customer_version !== receipt.customer_version))
                throw Object.assign(new Error('Hasil asli ditemukan; laporan terkini telah berubah. Periksa hasil asli sebelum menerima perubahan berikutnya.'), { code: 'CO_IMPORT_CURRENT_CHANGED' });
            await commands.acknowledge('commit', receipt, o.isCurrent);
            check(o);
        },
        async recover(o) {
            check(o);
            if (ordinary.hasUnresolved()) {
                const r = await ordinary.reconcile();
                check(o);
                if (r.status === 'committed')
                    await acceptOrdinary(r.receipt, o);
                return { status: r.status };
            }
            if (evidence.hasUnresolved()) {
                const r = await evidence.reconcile();
                check(o);
                if (r.status === 'committed')
                    await acceptEvidence(r.receipt, o);
                return { status: r.status };
            }
            const r: ImportRecovered = await commands.recover();
            check(o);
            if (r.status !== 'committed')
                return { status: r.status };
            if (r.family === 'commit')
                return { status: 'committed', receipt: r.result as COReceipt };
            if (r.family === 'prepare') {
                const binding = r.result as ImportBinding, input = await acceptPrepare(binding, o);
                return { status: 'committed', input, binding };
            }
            if (r.family === 'review')
                await acceptReview(r.result as ImportReviewResult, o);
            if (r.family === 'unit')
                await acceptUnit(r.result as import('../../lib/co/import/units').UnitReceipt, o);
            return { status: 'committed' };
        },
        async acknowledgeSupporting(terminal, o) {
            check(o);
            // A caller cannot manufacture a visible result: all helpers compare retained local
            // ownership and the original canonical result again before clearing that one key.
            if (terminal.family === 'prepare')
                await acceptPrepare(terminal.result, o, true);
            else if (terminal.family === 'review')
                await acceptReview(terminal.result, o, true);
            else if (terminal.family === 'unit')
                await acceptUnit(terminal.result, o, true);
            else if (terminal.family === 'evidence')
                await acceptEvidence(terminal.result, o, true);
            else if (terminal.family === 'ordinary')
                await acceptOrdinary(terminal.result, o, true);
            else
                invalid('supporting family');
            check(o);
            await readReport(o);
            check(o);
        },
        async declareUnit(input, o) {
            check(o);
            if (unresolved())
                throw new Error(IMPORT_RECOVERY_LABEL);
            const receipt = await senders(o).commands.declareUnit(input);
            check(o);
            await acceptUnit(receipt, o);
        },
        async abandon(reason, o) {
            check(o);
            if (unresolved())
                throw new Error(IMPORT_RECOVERY_LABEL);
            const r = await readReport(o);
            if (!r.draft)
                return;
            const s = await readImportSelection(r.draft.draft_id, o);
            check(o);
            if (s.state !== 'review_open')
                return;
            const result = await senders(o).commands.review({ draft_id: s.draftId, expected_draft_version: s.draftVersion, expected_customer_version: r.customer_version, expected_selection_id: s.selectionId, original_revision_id: s.originalRevisionId, expected_report_version: s.reportVersion, action: 'abandon', reason });
            check(o);
            await acceptReview(result, o);
        },
    };
    // Existing authenticated authority rejection is propagated, not derived from scope.actorId.
    return Object.fromEntries(Object.entries(ports).map(([key, value]) => [key, ['isCurrent', 'hasUnresolved'].includes(key) ? value : async (...args: unknown[]) => {
            try {
                return await (value as (...a: unknown[]) => unknown)(...args);
            }
            catch (e) {
                if (isCurrent())
                    reject(e);
                throw e;
            }
        }])) as ImportReviewPorts;
}
export function useCOImportReview(scope: ImportScope, readBlocked=false, primaryBlocked=false) {
    const key = JSON.stringify(scope), actor = useCOActor(`import:${key}`);
    const controller = useMemo(() => {
        const live = () => actor.enabled && actor.identity.actorId === scope.actorId && actor.isCurrent();
        const ports = live() ? createImportReviewPorts(scope, actor.identity.role, live, actor.rejectAuthority) : { isCurrent: () => false, hasUnresolved: () => true } as ImportReviewPorts;
        return createImportReviewController(scope, ports);
    }, [key, actor.scope, actor.enabled]);
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
    useEffect(()=>{controller.setReadBlocked(readBlocked)},[controller,readBlocked]);
    useEffect(()=>{controller.setPrimaryBlocked(primaryBlocked)},[controller,primaryBlocked]);
    useEffect(() => { const refresh = (event: StorageEvent) => { if (event.storageArea === window.localStorage && (event.key === null || scopedCORecoveryKeys(scope.actorId, scope.customerId, `report:${scope.reportMonth}`).includes(event.key)))
        controller.refreshRecoveryState(); }; window.addEventListener('storage', refresh); return () => window.removeEventListener('storage', refresh); }, [controller]);
    useEffect(() => {
        if (!actor.enabled)
            controller.invalidate();
    }, [actor.enabled, controller]);
    useEffect(() => {
        if (!state.file && !state.input && state.phase !== 'unknown')
            return;
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [state.file, state.input, state.phase]);
    return { state, seedEdit:controller.seedEdit,setReadBlocked:controller.setReadBlocked,setPrimaryBlocked:controller.setPrimaryBlocked,invalidatePreview:controller.invalidatePreview,refreshReview:controller.refreshReview,transcribeSource: controller.transcribeSource, loadContext: controller.loadContext, loadFile: controller.loadFile, updateReview: controller.updateReview, review: controller.review, confirm: controller.confirm, cancel: controller.cancel, recover: controller.recover, acceptRecovered: controller.acceptRecovered, acknowledgeSupporting: controller.acknowledgeSupporting, dirty: !!state.file || !!state.input, unknown: state.phase === 'unknown', declareUnit: controller.declareUnit, abandonReview: controller.abandonReview };
}
