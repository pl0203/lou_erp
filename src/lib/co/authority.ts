import { createContext } from 'react';

/** An owning source can revoke every mounted reader and command synchronously. */
export type COSourceAuthority = {
    current: () => boolean;
    reject: (error: unknown) => void;
};
export const COSourceAuthorityContext = createContext<COSourceAuthority | null>(null);
export function isCOAuthorityError(error: unknown) {
    return ['42501', '28000', '28P01', 'PT401', 'PT403', 'PGRST301', 'PGRST302', 'PGRST303'].includes(
        (error as { code?: string } | null)?.code ?? '',
    );
}
