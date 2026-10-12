import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLUListElement> & { label: string; children: ReactNode }

export function RecordList({ label, children, className, ...props }: Props) {
  return <ul role="list" aria-label={label} {...props} className={`ui-record-list${className ? ` ${className}` : ''}`}>{children}</ul>
}
