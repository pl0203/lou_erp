import { useId } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'

type Props = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function Section({ title, actions, children, className, ...props }: Props) {
  const titleId = useId()
  return <section aria-labelledby={titleId} {...props} className={`ui-section${className ? ` ${className}` : ''}`}>
    <div className="ui-section__header">
      <h2 id={titleId} className="ui-section__title">{title}</h2>
      {actions != null && <div className="ui-section__actions">{actions}</div>}
    </div>
    <div className="ui-section__content">{children}</div>
  </section>
}
