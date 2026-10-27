import type { HTMLAttributes } from 'react'

export function FormActions({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-form-actions${className ? ` ${className}` : ''}`}>{children}</div>
}
