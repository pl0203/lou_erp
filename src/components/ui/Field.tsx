import type { HTMLAttributes, ReactNode } from 'react'

type Control = { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true }
type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> & {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string
  children: (control: Control) => ReactNode
}

export function Field({ id, label, hint, error, children, className, ...props }: Props) {
  const hintId = hint != null ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return <div {...props} className={`ui-field${className ? ` ${className}` : ''}`}>
    <label htmlFor={id} className="ui-field__label">{label}</label>
    {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
    {hintId && <div id={hintId} className="ui-field__hint">{hint}</div>}
    {errorId && <p id={errorId} className="ui-field__error">{error}</p>}
  </div>
}
