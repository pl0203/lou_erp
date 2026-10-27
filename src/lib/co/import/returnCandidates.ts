import { canonicalManifestValue } from './manifest';
import { invalid, parseUUID, parseVersion, parseDate, parseQuantity, parseText, record, parseSafeCount } from '../validation';
export type ReturnCandidate = {
    headId: string;
    revisionId: string;
    version: string;
    date: string;
    reference: string | null;
    displaySku: string;
    productName: string;
    quantity: string;
    unit: string | null;
};
export type ReturnCandidates = {
    customerId: string;
    stockKeyId: string;
    customerVersion: string;
    page: number;
    pageSize: number;
    total: string;
    rows: ReturnCandidate[];
};
function exact(v: unknown, keys: string[]) { const o = record(v); if (Object.keys(o).length !== keys.length || keys.some(k => !Object.hasOwn(o, k)))
    invalid('return candidate fields'); return o; }
export function decodeReturnCandidates(value: unknown, customerId: string, stockKeyId: string, customerVersion: string, page: number): ReturnCandidates { canonicalManifestValue(value); const v = exact(value, ['customerId', 'stockKeyId', 'customerVersion', 'page', 'pageSize', 'total', 'rows']); parseUUID(v.customerId); parseUUID(v.stockKeyId); parseVersion(v.customerVersion); parseSafeCount(v.page); parseSafeCount(v.pageSize); parseQuantity(v.total); if (v.customerId !== customerId || v.stockKeyId !== stockKeyId || v.customerVersion !== customerVersion || v.page !== page || v.pageSize !== 25 || !Array.isArray(v.rows) || v.rows.length > 25)
    invalid('return candidate snapshot'); const ids = new Set<string>(); for (const row of v.rows) {
    const r = exact(row, ['headId', 'revisionId', 'version', 'date', 'reference', 'displaySku', 'productName', 'quantity', 'unit']);
    parseUUID(r.headId);
    parseUUID(r.revisionId);
    parseVersion(r.version);
    parseDate(r.date);
    parseQuantity(r.quantity);
    for (const k of ['reference', 'displaySku', 'productName', 'unit']) {
        if (r[k] === null && ['reference', 'unit'].includes(k))
            continue;
        const text = parseText(r[k]);
        if (text.length > 2000)
            invalid('return candidate text');
    }
    ;
    if (r.quantity === '0' || ids.has(r.revisionId))
        invalid('return candidate capacity');
    ids.add(r.revisionId);
} if (BigInt(v.rows.length) > BigInt(v.total) || BigInt(v.total) > 10000n)
    invalid('return candidate total'); return structuredClone(v) as ReturnCandidates; }
