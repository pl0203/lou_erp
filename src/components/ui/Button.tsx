import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger'
  pending?: boolean
}

export function Button({ variant = 'primary', pending = false, type = 'button', disabled, className, children, ...props }: Props) {
  return <button
    {...props}
    type={type}
    className={`ui-action ui-action--${variant}${className ? ` ${className}` : ''}`}
    disabled={disabled || pending}
    aria-busy={pending ? true : props['aria-busy']}
  >
    {pending && <span className="ui-action__pending" aria-hidden="true" />}
    {children}
  </button>
}
