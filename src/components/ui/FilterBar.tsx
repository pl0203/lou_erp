import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLElement> & { label: string; summary?: ReactNode; children: ReactNode }

export function FilterBar({ label, summary, children, className, ...props }: Props) {
  return <section aria-label={label} {...props} className={`ui-filter-bar${className ? ` ${className}` : ''}`}>
    <div className="ui-filter-bar__controls">{children}</div>
    {summary != null && <div className="ui-filter-bar__summary">{summary}</div>}
  </section>
}
