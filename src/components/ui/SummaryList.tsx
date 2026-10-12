import type { HTMLAttributes, ReactNode } from 'react'

type Props = HTMLAttributes<HTMLDListElement> & { items: Array<{ label: ReactNode; value: ReactNode }> }

export function SummaryList({ items, className, ...props }: Props) {
  return <dl {...props} className={`ui-summary-list${className ? ` ${className}` : ''}`}>
    {items.map((item, index) => <div className="ui-summary-list__item" key={index}>
      <dt>{item.label}</dt><dd>{item.value}</dd>
    </div>)}
  </dl>
}
