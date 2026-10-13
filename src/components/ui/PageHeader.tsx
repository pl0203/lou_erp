import type { HTMLAttributes, ReactNode } from 'react'

type Props = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}

export function PageHeader({ title, description, actions, className, ...props }: Props) {
  return <header {...props} className={`ui-page-header${className ? ` ${className}` : ''}`}>
    <div className="ui-page-header__content">
      <h1 className="ui-page-header__title">{title}</h1>
      {description != null && <div className="ui-page-header__description">{description}</div>}
    </div>
    {actions != null && <div className="ui-page-header__actions">{actions}</div>}
  </header>
}
