import { useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { COSourceAuthorityContext, isCOAuthorityError } from '../../lib/co/authority';
import { coKeys } from '../../lib/co/queryKeys';
import type { COReadOptions } from '../../lib/co/rpc';
import { COFailure, useCOActor } from './COShared';

type Props<T> = {
    source: string;
    check: (options: COReadOptions) => Promise<T>;
    children: ReactNode | ((checked: T | null) => ReactNode);
    onAuthorityFailure?: (error: unknown) => void;
};
/** The owner key prevents a departed source's reads, failures or retry from affecting its replacement. */
export default function COSourceBoundary<T>(props: Props<T>) {
    const actor = useCOActor(`authority:${props.source}`);
    return actor.enabled ? <SourceOwner key={actor.scope} {...props} actor={actor}/> : null;
}
function SourceOwner<T>({ actor, check, children, onAuthorityFailure }: Props<T> & { actor: ReturnType<typeof useCOActor> }) {
    const parent = useContext(COSourceAuthorityContext);
    const [failure, setFailure] = useState<unknown>(null);
    const [checked, setChecked] = useState<T | null>(null);
    const [retrying, setRetrying] = useState(false);
    const mounted = useRef(true), denied = useRef(false), epoch = useRef(0), lock = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
    const ownerCurrent = () => mounted.current && actor.isCurrent();
    const current = () => ownerCurrent() && !denied.current;
    function reject(error: unknown) {
        if (!current() || !isCOAuthorityError(error)) return;
        denied.current = true;
        epoch.current++;
        setFailure(error);
        setChecked(null);
        const queryKey = coKeys.identity(actor.identity);
        void actor.client.cancelQueries({ queryKey });
        actor.client.removeQueries({ queryKey });
        parent?.reject(error);
        onAuthorityFailure?.(error);
    }
    async function retry() {
        if (lock.current || !ownerCurrent()) return;
        lock.current = true;
        setRetrying(true);
        const captured = epoch.current;
        const live = () => ownerCurrent() && captured === epoch.current;
        try {
            const value = await check({ isCurrent: live });
            if (!live()) return;
            setChecked(value);
            denied.current = false;
            setFailure(null);
        } catch (error) {
            if (live()) setFailure(error);
        } finally {
            lock.current = false;
            if (live()) setRetrying(false);
        }
    }
    if (failure) return <COFailure error={failure} retry={retrying ? undefined : () => void retry()}/>;
    return <COSourceAuthorityContext.Provider value={{ current, reject }}>
        {typeof children === 'function' ? children(checked) : children}
    </COSourceAuthorityContext.Provider>;
}
