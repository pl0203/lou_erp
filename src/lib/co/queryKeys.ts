import type { ImportScope, ImportBinding } from './import/types';
import type { QueryClient } from '@tanstack/react-query';
export type COIdentity = {
    actorId: string;
    role: string;
};
export const CO_BACKEND = import.meta.env.VITE_SUPABASE_URL ?? 'unconfigured';
export const coKeys = { importRead: (s: COIdentity, scope: ImportScope, resource: string, binding: ImportBinding | null = null, previewFingerprint: string | null = null) => ['co', CO_BACKEND, s.actorId, s.role, 'import', resource, scope.customerId, scope.reportMonth, scope.epoch, binding?.importId ?? null, binding?.importVersion ?? null, binding?.customerVersion ?? null, binding?.draftId ?? null, binding?.draftVersion ?? null, binding?.manifestDigest ?? null, previewFingerprint] as const, all: ['co'] as const, identity: (s: COIdentity) => ['co', CO_BACKEND, s.actorId, s.role] as const, read: (s: COIdentity, resource: string, args: unknown) => ['co', CO_BACKEND, s.actorId, s.role, resource, args] as const };
export function isCOIdentity(s: COIdentity | null | undefined): s is COIdentity { return !!s?.actorId && ['co_admin', 'executive'].includes(s.role); }
export function synchronizeCOIdentity(client: QueryClient, identity: COIdentity | null) {
    const predicate = (q: {
        queryKey: readonly unknown[];
    }) => !identity || q.queryKey[1] !== CO_BACKEND || q.queryKey[2] !== identity.actorId || q.queryKey[3] !== identity.role;
    void client.cancelQueries({ queryKey: coKeys.all, predicate });
    client.removeQueries({ queryKey: coKeys.all, predicate });
}
/** Never expose cached private rows from a different identity or semantic request. */
export function sameCOScope(a: readonly unknown[], b: readonly unknown[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }
