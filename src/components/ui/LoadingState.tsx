import type { HTMLAttributes, ReactNode } from 'react'

type Shape = 'compact' | 'list' | 'detail' | 'form' | 'dashboard'
type Props = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> & {
  title: ReactNode
  shape?: Shape
  children?: ReactNode
  actions?: ReactNode
}

/** Presentation only: the caller still owns readiness, errors and authorization.
 * No retained data, timers, focus changes or synthetic minimum loading time.
 * Decorative shapes are static, so a paused/offline read never looks like progress.
 */
export function LoadingState({ title, shape = 'compact', children, actions, className, ...props }: Props) {
  const count = shape === 'compact' ? 2 : shape === 'dashboard' ? 4 : 3
  return <div {...props} role="status" className={`ui-loading-state${className ? ` ${className}` : ''}`}>
    <p className="ui-loading-state__title">{title}</p>
    {children != null && <div className="ui-loading-state__description">{children}</div>}
    <div aria-hidden="true" data-loading-shape={shape} className={`ui-loading-state__geometry ui-loading-state__geometry--${shape}`}>
      {Array.from({ length: count }, (_, index) => <div key={index} className="ui-loading-state__item">
        <span className="ui-skeleton ui-loading-state__line" />
        {shape !== 'compact' && <span className="ui-skeleton ui-loading-state__line ui-loading-state__line--secondary" />}
        {(shape === 'form' || shape === 'dashboard') && <span className="ui-skeleton ui-loading-state__block" />}
      </div>)}
    </div>
    {actions != null && <div className="ui-loading-state__actions">{actions}</div>}
  </div>
}
