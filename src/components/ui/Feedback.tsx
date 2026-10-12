import { useId } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'

type ContentProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title: ReactNode
  children?: ReactNode
  actions?: ReactNode
}
type NoticeProps = ContentProps & { tone: 'info' | 'success' | 'warning' | 'error' }

export function Notice({ tone, title, children, actions, className, ...props }: NoticeProps) {
  return <div {...props} role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'} className={`ui-notice ui-notice--${tone}${className ? ` ${className}` : ''}`}>
    <p className="ui-notice__title">{title}</p>
    {children != null && <div className="ui-notice__content">{children}</div>}
    {actions != null && <div className="ui-notice__actions">{actions}</div>}
  </div>
}

export function EmptyState({ title, children, actions, className, ...props }: ContentProps) {
  const titleId = useId()
  return <section aria-labelledby={titleId} {...props} className={`ui-empty-state${className ? ` ${className}` : ''}`}>
    <h2 id={titleId} className="ui-empty-state__title">{title}</h2>
    {children != null && <div className="ui-empty-state__content">{children}</div>}
    {actions != null && <div className="ui-empty-state__actions">{actions}</div>}
  </section>
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone: 'neutral' | 'success' | 'warning' | 'error' }

export function StatusBadge({ tone, children, className, ...props }: BadgeProps) {
  return <span {...props} className={`ui-status-badge ui-status-badge--${tone}${className ? ` ${className}` : ''}`}>{children}</span>
}
