import { useContext, useEffect, useMemo, useRef } from 'react';
import { COSourceAuthorityContext } from './authority';
import { useAuth } from '../AuthContext';
import { supabase } from '../supabase';
import { createTransactionSender } from '../orderTransactions';
import type { Recovery } from '../orderTransactions';
import type { COOperation, COOperationPayloads, COReceipt, CORecovery } from './contracts';
import { CO_BACKEND } from './queryKeys';
import { invalid, record, parseUUID, parseHash, parseBoolean, parseCOReceipt, operations, oneOf } from './validation';
import { coError } from './rpc';
export type CORequestIdentity = {
    operation: COOperation;
    customer_id: string;
    co_id?: string;
    draft_id?: string;
    target_id?: string;
};
function target(operation: string, p: Record<string, any>): unknown { if (['edit_co', 'cancel_co', 'resolve_undelivered', 'close_co'].includes(operation))
    return p.co_id; if (operation.startsWith('save_'))
    return p.draft_id; if (operation === 'correct_sj')
    return p.delivery_head_id; if (operation === 'correct_report')
    return p.report_head_id; if (operation === 'correct_return')
    return p.return_head_id; return undefined; }
/** Known targets only. New head IDs are established by actor/request reconciliation. */
export function validateCOReceipt(value: unknown, operation?: string, payload?: unknown): boolean { try {
    const r = parseCOReceipt(value), p = payload == null ? {} : record(payload), expected = operation ?? p.operation;
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
function identity(v: unknown): CORequestIdentity { const o = record(v), r: CORequestIdentity = { operation: oneOf(operations)(o.operation) as COOperation, customer_id: parseUUID(o.customer_id) }; for (const k of ['co_id', 'draft_id', 'target_id'] as const)
    if (o[k] !== undefined)
        r[k] = parseUUID(o[k]); if (Object.keys(o).some(k => !['operation', 'customer_id', 'co_id', 'draft_id', 'target_id'].includes(k)))
    invalid('request identity'); return r; }
export type COSenderOptions = {
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
export type COTransactionSender = ((operation: COOperation, payload: unknown) => Promise<COReceipt>) & {
    hasUnresolved: () => boolean;
    reconcile: () => Promise<CORecovery>;
    acknowledgeRecovered: (isCurrent?: () => boolean) => Promise<void>;
    getCommittedIdentity: (receipt: COReceipt) => CORequestIdentity;
};
export function createCOTransactionSender(options: COSenderOptions): COTransactionSender {
    parseUUID(options.actorId);
    parseUUID(options.customerId);
    if (options.coId)
        parseUUID(options.coId);
    if (!options.scope || !['co_admin', 'executive'].includes(options.role))
        invalid('sender scope');
    const key = `co-request:${encodeURIComponent(CO_BACKEND)}:${options.actorId}:${options.customerId}:${encodeURIComponent(options.scope)}`;
    let active: CORequestIdentity | undefined, canonical: COReceipt | undefined, inFlight = false;
    function readRaw() { const raw = options.storage().getItem(key); if (raw === null)
        return null; const v = record(JSON.parse(raw)); parseUUID(v.id); parseHash(v.key); parseBoolean(v.uncertain); const binding = identity(v.binding); if (binding.customer_id !== options.customerId || (options.coId && binding.co_id !== options.coId))
        invalid('recovery scope'); return { id: v.id as string, key: v.key as string, uncertain: v.uncertain as boolean, binding, ...(v.committed === undefined ? {} : { committed: parseCOReceipt(v.committed) }) }; }
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
    const sameReceipt = (a: COReceipt, b: COReceipt) => (['id','operation','version','customer_id','customer_version'] as const).every(k => a[k] === b[k]);
    const storage: Storage = { get length() { return options.storage().length; }, clear() { invalid('unscoped recovery clear'); }, key: i => options.storage().key(i), getItem: k => { if (k !== key)
            invalid('storage scope'); const r = readRaw(); return r === null ? null : JSON.stringify(r); }, setItem: (k, raw) => { current(); if (k !== key)
            invalid('storage scope'); const v = record(JSON.parse(raw)), old = readRaw(), binding = old?.id === v.id ? old.binding : active; if (!binding)
            invalid('missing request identity'); const saved = { id: parseUUID(v.id), key: parseHash(v.key), uncertain: parseBoolean(v.uncertain), binding: identity(binding), ...(v.committed === undefined ? {} : { committed: parseCOReceipt(v.committed) }) }; // Shared validation can report uncertainty after rejecting a response. A previously
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
        const receipt = parseCOReceipt(v.receipt);
        if (v.operation !== receipt.operation || v.operation !== pending.binding.operation || !validateCOReceipt(receipt, pending.binding.operation, pending.binding) || pending.committed && !sameReceipt(receipt,pending.committed))
            invalid('recovery receipt');
        canonical = receipt;
        return { state: 'committed', operation: receipt.operation, result: receipt };
    } if (v.status === 'abandoned') {
        if (Object.keys(v).length !== 1)
            invalid('abandonment');
        return { state: 'abandoned' };
    } if (v.status === 'unknown')
        return { state: 'unknown' }; return invalid('recovery status'); }
    const sender = createTransactionSender({ retainCommitted: options.retainCommitted, rpcName: 'pilot_co_transaction_v1', recoveryRpcName: 'pilot_reconcile_co_v1', storage: () => storage, storageKey: key, decodeRecovery, mapError: coError, validateResult: async (value, op, payload) => {
            current();
            const pending = readRaw();
            if (!pending || !validateCOReceipt(value, pending.binding.operation, pending.binding) || op && op !== pending.binding.operation || op && !validateCOReceipt(value, op, payload))
                return false;
            if (!canonical) {
                const { data, error } = await supabase.rpc('pilot_reconcile_co_v1', { p_request_id: pending.id, p_abandon: false });
                if (error)
                    throw coError(error);
                const recovered = decodeRecovery(data);
                if (recovered.state !== 'committed')
                    return false;
            }
            current();
            const r = parseCOReceipt(value), expected = canonical!;
            return ['id', 'operation', 'version', 'customer_id', 'customer_version'].every(k => r[k as keyof COReceipt] === expected[k as keyof COReceipt]);
        } });
    async function reconcile(): Promise<CORecovery> { await authorize(); canonical = undefined; try {
        const r = await sender.reconcile();
        current();
        if (r.state === 'committed')
            return { status: 'committed', operation: r.operation as COOperation, receipt: parseCOReceipt(r.result) };
        return { status: r.state };
    }
    catch (e) {
        throw coError(e);
    } }
    const send = async (operation: COOperation, payload: unknown): Promise<COReceipt> => { if (inFlight)
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
        return parseCOReceipt(await sender(operation, payload));
    }
    catch (e) {
        throw coError(e);
    }
    finally {
        inFlight = false;
        active = undefined;
        canonical = undefined;
    } };
    function getCommittedIdentity(receipt: COReceipt): CORequestIdentity {
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
export type COFormScope = {
    retainCommitted?: boolean;
    formScope: string;
    customerId: string;
    coId?: string;
};
export function useCOTransactionSender(scope: COFormScope): COTransactionSender {
    const { user, profile, loading, error } = useAuth();
    const authority = useContext(COSourceAuthorityContext);
    const scopeKey = JSON.stringify([scope.formScope, scope.customerId, scope.coId, scope.retainCommitted]);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const latest = useRef({ user, profile, loading, error, authority, scopeKey });
    latest.current = { user, profile, loading, error, authority, scopeKey };
    return useMemo(() => {
        const actor = user?.id, role = profile?.role;
        const isCurrent = () => {
            const s = latest.current;
            return mounted.current && s.scopeKey === scopeKey && !!actor && s.user?.id === actor
                && s.profile?.id === actor && s.profile?.role === role && s.profile.is_active
                && !s.loading && !s.error && (!s.authority || s.authority.current());
        };
        if (!actor || !role || !isCurrent() || !['co_admin', 'executive'].includes(role)) {
            const blocked = async () => { throw Object.assign(new Error('CO authority required'), { code: '42501' }); };
            return Object.assign(blocked, { hasUnresolved: () => true, reconcile: blocked, acknowledgeRecovered: blocked, getCommittedIdentity: () => invalid('CO authority required') });
        }
        const raw = createCOTransactionSender({ actorId: actor, role, scope: scope.formScope,
            customerId: scope.customerId, coId: scope.coId, storage: () => window.localStorage, isCurrent, retainCommitted: scope.retainCommitted });
        async function protect<T>(run: () => Promise<T>): Promise<T> {
            try { return await run(); }
            catch (value) { if (isCurrent()) latest.current.authority?.reject(value); throw value; }
        }
        return Object.assign((operation: COOperation, payload: unknown) => protect(() => raw(operation, payload)), {
            hasUnresolved: raw.hasUnresolved,
            reconcile: () => protect(raw.reconcile),
            acknowledgeRecovered: (live?: () => boolean) => protect(() => raw.acknowledgeRecovered(live)),
            getCommittedIdentity: raw.getCommittedIdentity,
        });
    }, [user?.id, profile?.role, profile?.is_active, loading, error, scopeKey]);
}
export async function sendCOCommand<K extends keyof COOperationPayloads>(sender: COTransactionSender, operation: K, payload: COOperationPayloads[K]) { return sender(operation, payload); }
