import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet' | 'danger-quiet'
  size?: 'default' | 'compact'
  pending?: boolean
}

export function Button({ variant = 'primary', size = 'default', pending = false, type = 'button', disabled, className, children, ...props }: Props) {
  return <button
    {...props}
    type={type}
    className={`ui-action ui-action--${variant}${size === 'compact' ? ' ui-action--compact' : ''}${className ? ` ${className}` : ''}`}
    disabled={disabled || pending}
    aria-busy={pending ? true : props['aria-busy']}
  >
    {pending && <span className="ui-action__pending" aria-hidden="true" />}
    {children}
  </button>
}
