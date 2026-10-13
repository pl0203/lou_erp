import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { createTransactionSender } from '../orderTransactions';
import type { Recovery } from '../orderTransactions';

import { CO_BACKEND } from './queryKeys';
import { invalid, record, parseUUID, parseHash, parseBoolean, oneOf } from './validation';
import { parseVersion, parseMonth, parseText, parseSafeCount } from './validation';
import { coError } from './rpc';

export const evidenceOperations=['register_evidence','finalize_evidence'] as const;
export type EvidenceOperation=typeof evidenceOperations[number];
export type EvidenceReceipt={id:string;operation:EvidenceOperation;version:string;customer_id:string;customer_version:string};
export type EvidenceRecovery={status:'committed';operation:EvidenceOperation;receipt:EvidenceReceipt}|{status:'unknown'|'abandoned'};
const exact=(o:Record<string,unknown>,keys:string[])=>{if(Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))invalid('evidence response fields');};
export function parseEvidenceReceipt(raw:unknown):EvidenceReceipt{const v=record(raw);exact(v,['id','operation','version','customer_id','customer_version']);return {id:parseUUID(v.id),operation:oneOf(evidenceOperations)(v.operation),version:parseVersion(v.version),customer_id:parseUUID(v.customer_id),customer_version:parseVersion(v.customer_version)};}
export type EvidenceRecord={id:string;version:string;customer_id:string;customer_version:string;draft_id:string;draft_version:string;report_month:string;filename:string;mime_type:'application/pdf'|'image/png'|'image/jpeg';byte_size:number;state:'pending'|'verified'|'finalized';finalized_draft_version:string|null};
export function parseEvidenceRecord(raw:unknown):EvidenceRecord{
 const v=record(raw);exact(v,['id','version','customer_id','customer_version','draft_id','draft_version','report_month','filename','mime_type','byte_size','state','finalized_draft_version']);
 const mime_type=oneOf(['application/pdf','image/png','image/jpeg'] as const)(v.mime_type), id=parseUUID(v.id),filename=parseText(v.filename),byte_size=parseSafeCount(v.byte_size),state=oneOf(['pending','verified','finalized'] as const)(v.state),version=parseVersion(v.version),draft_version=parseVersion(v.draft_version),finalized_draft_version=v.finalized_draft_version===null?null:parseVersion(v.finalized_draft_version);
 if(byte_size<1||byte_size>10485760||filename!==`evidence-${id}.${mime_type==='application/pdf'?'pdf':mime_type==='image/png'?'png':'jpg'}`||(state==='finalized'?(version!=='2'||finalized_draft_version!==(BigInt(draft_version)+1n).toString()):(version!=='1'||finalized_draft_version!==null)))invalid('evidence metadata');
 return {id,version,customer_id:parseUUID(v.customer_id),customer_version:parseVersion(v.customer_version),draft_id:parseUUID(v.draft_id),draft_version,report_month:parseMonth(v.report_month),filename,mime_type,byte_size,state,finalized_draft_version};
}
function stillCurrent(current?:()=>boolean){if(current&&!current())invalid('evidence owner changed');}
async function evidenceRead(name:string,args:Record<string,unknown>,current?:()=>boolean){stillCurrent(current);const {data,error}=await supabase.rpc(name,args);stillCurrent(current);if(error)throw coError(error);return data;}
export async function fetchEvidence(id:string,current?:()=>boolean){const r=parseEvidenceRecord(await evidenceRead('pilot_co_evidence_v1',{p_evidence_id:parseUUID(id)},current));if(r.id!==id)invalid('evidence identity');return r;}
export type EvidenceSelection={customerId:string;draftId?:string;draftVersion?:string;revisionId?:string};
export async function fetchEvidenceSelection(binding:EvidenceSelection,current?:()=>boolean):Promise<EvidenceRecord|null>{
 parseUUID(binding.customerId);if(!!binding.draftId===!!binding.revisionId)invalid('evidence selection');
 const draft=binding.draftId?parseUUID(binding.draftId):null,revision=binding.revisionId?parseUUID(binding.revisionId):null,version=draft?parseVersion(binding.draftVersion):null;
 const r=record(await evidenceRead('pilot_co_evidence_selection_v1',{p_draft_id:draft,p_revision_id:revision,p_expected_draft_version:version},current));exact(r,['version','customer_id','draft_id','draft_version','revision_id','evidence']);
 if(r.version!=='1'||r.customer_id!==binding.customerId||r.draft_id!==draft||r.draft_version!==version||r.revision_id!==revision)invalid('evidence selection binding');
 const e=r.evidence===null?null:parseEvidenceRecord(r.evidence);if(e&&(e.customer_id!==binding.customerId||e.state!=='finalized'||draft&&(e.draft_id!==draft||BigInt(e.finalized_draft_version!)>BigInt(version!))))invalid('selected evidence');return e;
}
async function invokeEvidence(name:string,body:unknown,headers:Record<string,string>,current:()=>boolean){
 stillCurrent(current);const {data,error}=await supabase.functions.invoke(name,{body,headers});stillCurrent(current);
 if(error){let detail:unknown=error;try{if(error.context instanceof Response)detail=await error.context.json();}catch{}stillCurrent(current);throw coError(detail);}return data;
}
export async function uploadEvidence(id:string,bytes:Uint8Array,current:()=>boolean){const v=record(await invokeEvidence('co-evidence-upload',new Uint8Array(bytes).buffer,{'x-evidence-id':parseUUID(id),'Content-Type':'application/octet-stream'},current));exact(v,['id','state']);if(v.id!==id||!['verified','finalized'].includes(v.state))invalid('evidence verification');}
export async function downloadEvidence(e:EvidenceRecord,current:()=>boolean):Promise<Blob>{const blob=await invokeEvidence('co-evidence-download',{evidence_id:e.id},{},current);if(!(blob instanceof Blob)||blob.size!==e.byte_size||blob.size>10485760)invalid('evidence download');return blob;}

export type EvidenceRequestIdentity = {
    operation: EvidenceOperation;
    customer_id: string;
    co_id?: string;
    draft_id?: string;
    target_id?: string;
};
function target(operation: string,p: Record<string, any>) { return operation === 'finalize_evidence' ? p.evidence_id : undefined; }
/** Known targets only. New head IDs are established by actor/request reconciliation. */
export function validateEvidenceReceipt(value: unknown, operation?: string, payload?: unknown): boolean { try {
    const r = parseEvidenceReceipt(value), p = payload == null ? {} : record(payload), expected = operation ?? p.operation;
    if (expected && r.operation !== expected)
        return false;
    if (p.customer_id && r.customer_id !== p.customer_id)
        return false;
    const id = p.target_id ?? target(r.operation, p);
    if (id !== undefined && r.id !== id)
        return false;
    return true;
}
catch {
    return false;
} }
function identity(v: unknown): EvidenceRequestIdentity { const o = record(v), r: EvidenceRequestIdentity = { operation: oneOf(evidenceOperations)(o.operation) as EvidenceOperation, customer_id: parseUUID(o.customer_id) }; for (const k of ['co_id', 'draft_id', 'target_id'] as const)
    if (o[k] !== undefined)
        r[k] = parseUUID(o[k]); if (Object.keys(o).some(k => !['operation', 'customer_id', 'co_id', 'draft_id', 'target_id'].includes(k)))
    invalid('request identity'); return r; }
export type EvidenceSenderOptions = {
    actorId: string;
    role: string;
    scope: string;
    customerId: string;
    coId?: string;
    storage: () => Storage;
    retainCommitted?: boolean;
    authorize?: () => Promise<void>;
    isCurrent?: () => boolean;
};
export type EvidenceSender = ((operation: EvidenceOperation, payload: unknown) => Promise<EvidenceReceipt>) & {
    hasUnresolved: () => boolean;
    reconcile: () => Promise<EvidenceRecovery>;
    acknowledgeRecovered: (isCurrent?: () => boolean) => Promise<void>;
    getCommittedIdentity: (receipt: EvidenceReceipt) => EvidenceRequestIdentity;
};
export function createEvidenceSender(options: EvidenceSenderOptions): EvidenceSender {
    parseUUID(options.actorId);
    parseUUID(options.customerId);
    if (options.coId)
        parseUUID(options.coId);
    if (!options.scope || !['co_admin', 'executive'].includes(options.role))
        invalid('sender scope');
    const key = `co-evidence-request:${encodeURIComponent(CO_BACKEND)}:${options.actorId}:${options.customerId}:${encodeURIComponent(options.scope)}`;
    let active: EvidenceRequestIdentity | undefined, canonical: EvidenceReceipt | undefined, inFlight = false;
    function readRaw() { const raw = options.storage().getItem(key); if (raw === null)
        return null; const v = record(JSON.parse(raw)); parseUUID(v.id); parseHash(v.key); parseBoolean(v.uncertain); const binding = identity(v.binding); if (binding.customer_id !== options.customerId || (options.coId && binding.co_id !== options.coId))
        invalid('recovery scope'); return { id: v.id as string, key: v.key as string, uncertain: v.uncertain as boolean, binding, ...(v.committed === undefined ? {} : { committed: parseEvidenceReceipt(v.committed) }) }; }
    function current() { if (options.isCurrent && !options.isCurrent())
        invalid('identity changed'); }
    async function authorize() { current(); if (options.authorize)
        await options.authorize();
    else {
        const { data, error } = await supabase.rpc('pilot_my_profile');
        current();
        if (error)
            throw coError(error);
        if (!Array.isArray(data) || data.length !== 1 || data[0].id !== options.actorId || data[0].role !== options.role || data[0].is_active !== true)
            throw Object.assign(new Error('CO authority required'), {code:'42501'});
    } current(); }
    const sameReceipt = (a: EvidenceReceipt, b: EvidenceReceipt) => (['id','operation','version','customer_id','customer_version'] as const).every(k => a[k] === b[k]);
    const storage: Storage = { get length() { return options.storage().length; }, clear() { invalid('unscoped recovery clear'); }, key: i => options.storage().key(i), getItem: k => { if (k !== key)
            invalid('storage scope'); const r = readRaw(); return r === null ? null : JSON.stringify(r); }, setItem: (k, raw) => { current(); if (k !== key)
            invalid('storage scope'); const v = record(JSON.parse(raw)), old = readRaw(), binding = old?.id === v.id ? old.binding : active; if (!binding)
            invalid('missing request identity'); const saved = { id: parseUUID(v.id), key: parseHash(v.key), uncertain: parseBoolean(v.uncertain), binding: identity(binding), ...(v.committed === undefined ? {} : { committed: parseEvidenceReceipt(v.committed) }) }; // Shared validation can report uncertainty after rejecting a response. A previously
        // confirmed receipt stays pinned until this domain explicitly acknowledges it.
        if (old?.id === saved.id && old.committed) {
            if (saved.key !== old.key || saved.committed && !sameReceipt(saved.committed, old.committed)) invalid('changed committed recovery');
            saved.committed = old.committed;
            saved.uncertain = false;
        }
        options.storage().setItem(key, JSON.stringify(saved)); }, removeItem: k => { if (k !== key)
            invalid('storage scope'); current(); options.storage().removeItem(key); } };
    function decodeRecovery(raw: unknown): Recovery { const v = record(raw), pending = readRaw(); if (!pending)
        invalid('missing recovery'); if (pending.committed && v.status !== 'committed') invalid('changed committed recovery'); if (v.status === 'committed') {
        exact(v,['status','operation','receipt']); const receipt = parseEvidenceReceipt(v.receipt);
        if (v.operation !== receipt.operation || v.operation !== pending.binding.operation || !validateEvidenceReceipt(receipt, pending.binding.operation, pending.binding) || pending.committed && !sameReceipt(receipt,pending.committed))
            invalid('recovery receipt');
        canonical = receipt;
        return { state: 'committed', operation: receipt.operation, result: receipt };
    } if (v.status === 'abandoned') {
        if (Object.keys(v).length !== 1)
            invalid('abandonment');
        return { state: 'abandoned' };
    } if (v.status === 'unknown') { exact(v,['status']); return { state: 'unknown' }; } return invalid('recovery status'); }
    const sender = createTransactionSender({ retainCommitted: options.retainCommitted, rpcName: 'pilot_co_evidence_transaction_v1', recoveryRpcName: 'pilot_reconcile_co_evidence_v1', storage: () => storage, storageKey: key, decodeRecovery, mapError: coError, validateResult: async (value, op, payload) => {
            current();
            const pending = readRaw();
            if (!pending || !validateEvidenceReceipt(value, pending.binding.operation, pending.binding) || op && op !== pending.binding.operation || op && !validateEvidenceReceipt(value, op, payload))
                return false;
            if (!canonical) {
                const { data, error } = await supabase.rpc('pilot_reconcile_co_evidence_v1', { p_request_id: pending.id, p_abandon: false });
                if (error)
                    throw coError(error);
                const recovered = decodeRecovery(data);
                if (recovered.state !== 'committed')
                    return false;
            }
            current();
            const r = parseEvidenceReceipt(value), expected = canonical!;
            return ['id', 'operation', 'version', 'customer_id', 'customer_version'].every(k => r[k as keyof EvidenceReceipt] === expected[k as keyof EvidenceReceipt]);
        } });
    async function reconcile(): Promise<EvidenceRecovery> { await authorize(); canonical = undefined; try {
        const r = await sender.reconcile();
        current();
        if (r.state === 'committed')
            return { status: 'committed', operation: r.operation as EvidenceOperation, receipt: parseEvidenceReceipt(r.result) };
        return { status: r.state };
    }
    catch (e) {
        throw coError(e);
    } }
    const send = async (operation: EvidenceOperation, payload: unknown): Promise<EvidenceReceipt> => { if (inFlight)
        throw new Error('Penyimpanan CO masih berjalan.'); inFlight = true; try {
        await authorize();
        const p = record(payload);
        active = identity({ operation, customer_id: options.customerId, ...(options.coId ? { co_id: options.coId } : {}), ...(typeof p.draft_id === 'string' ? { draft_id: p.draft_id } : {}), ...(target(operation, p) !== undefined ? { target_id: target(operation, p) } : {}) });
        if (p.customer_id && p.customer_id !== options.customerId || p.co_id && p.co_id !== options.coId)
            invalid('command scope');
        const existing = readRaw();
        if (existing?.uncertain)
            await reconcile();
        canonical = undefined;
        return parseEvidenceReceipt(await sender(operation, payload));
    }
    catch (e) {
        throw coError(e);
    }
    finally {
        inFlight = false;
        active = undefined;
        canonical = undefined;
    } };
    function getCommittedIdentity(receipt: EvidenceReceipt): EvidenceRequestIdentity {
        current();
        const pending = readRaw();
        if (!pending?.committed || !sameReceipt(pending.committed, receipt)) invalid('unconfirmed original receipt');
        return { ...pending.binding };
    }
    return Object.assign(send, {
        hasUnresolved: sender.hasUnresolved, reconcile, getCommittedIdentity,
        async acknowledgeRecovered(isCurrent: () => boolean = () => true) {
            if (!isCurrent()) invalid('recovery owner changed');
            await authorize();
            const before = readRaw();
            if (!before?.committed) invalid('unconfirmed recovery');
            const recovered = await reconcile();
            if (recovered.status !== 'committed' || readRaw()?.id !== before.id) invalid('changed recovery');
            current();
            if (!isCurrent()) invalid('recovery owner changed');
            sender.acknowledgeRecovered();
        },
    });
}
export type EvidenceFormScope = {
    formScope: string;
    customerId: string;
    coId?: string;
    /** Ephemeral owner/version binding; never included in persisted request data. */
    ownerKey?: string;
    isCurrent?: () => boolean;
};
export function useEvidenceSender(scope: EvidenceFormScope): EvidenceSender {
    const { user, profile, loading, error } = useAuth();
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const latest = useRef({ user, profile, loading, error, scope });
    latest.current = { user, profile, loading, error, scope };
    return useMemo(() => {
        const actor = user?.id, role = profile?.role, ownerKey = scope.ownerKey;
        const isCurrent = () => {
            const s = latest.current;
            return mounted.current && !!actor && s.user?.id === actor && s.profile?.id === actor
                && s.profile?.role === role && s.profile.is_active && !s.loading && !s.error
                && s.scope.ownerKey === ownerKey && (!s.scope.isCurrent || s.scope.isCurrent());
        };
        if (!actor || profile?.id !== actor || !role || !profile.is_active || loading || error || !['co_admin','executive'].includes(role)) {
            const blocked = async () => { throw Object.assign(new Error('CO authority required'), { code:'42501' }); };
            return Object.assign(blocked, { hasUnresolved: () => true, reconcile: blocked, acknowledgeRecovered: blocked, getCommittedIdentity: () => invalid('CO authority required') });
        }
        return createEvidenceSender({ actorId:actor, role, scope:scope.formScope, customerId:scope.customerId, coId:scope.coId, storage:()=>window.localStorage, isCurrent, retainCommitted: true });
    }, [user?.id,profile?.role,profile?.is_active,loading,error,scope.formScope,scope.customerId,scope.coId,scope.ownerKey]);
}

/** Convenience checks only; the authenticated verifier validates actual bytes again. */
export async function prepareEvidenceFile(file: File, current: () => boolean) {
    const extension = file.type === 'application/pdf' ? /\.pdf$/i : file.type === 'image/png' ? /\.png$/i : file.type === 'image/jpeg' ? /\.jpe?g$/i : null;
    if (!extension || !extension.test(file.name) || !file.name || file.name.length > 200 || /^[.]/.test(file.name) || /[\x00-\x1f\x7f/\\]/.test(file.name) || file.size < 1 || file.size > 10485760)
        throw new Error('Pilih PDF, PNG, atau JPEG, maksimum 10 MiB, dengan nama berkas yang sesuai.');
    stillCurrent(current);
    const bytes = new Uint8Array(await file.arrayBuffer());
    stillCurrent(current);
    if (bytes.length !== file.size) invalid('evidence file size');
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    stillCurrent(current);
    return { bytes, filename: file.name, mime_type: file.type, byte_size: bytes.length, sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') };
}
