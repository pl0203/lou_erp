import { useLayoutEffect, useRef, type ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet' | 'danger-quiet'
  size?: 'default' | 'compact'
  pending?: boolean
}

export function Button({ variant = 'primary', size = 'default', pending, type = 'button', disabled, className, children, style, ...props }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const footprint = useRef<{ width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const button = buttonRef.current
    // Ordinary buttons need no measurement or observer. Async callers opt in
    // with pending={false} before their first operation.
    if (!button || pending === undefined || pending) return
    const measure = () => {
      // Computed border-box dimensions exclude the temporary pressed transform.
      // Keep the last idle size even when the caller changes its pending label.
      const computed = window.getComputedStyle(button)
      const width = parseFloat(computed.width), height = parseFloat(computed.height)
      if (width > 0 && height > 0) {
        footprint.current = { width, height }
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    return () => observer.disconnect()
  }, [pending, children, className, size, style])

  return <button
    {...props}
    ref={buttonRef}
    type={type}
    className={`ui-action ui-action--${variant} ui-button${size === 'compact' ? ' ui-action--compact' : ''}${pending ? ' ui-button--pending' : ''}${className ? ` ${className}` : ''}`}
    style={pending && footprint.current ? { ...style, ...footprint.current } : style}
    disabled={disabled || pending}
    aria-busy={pending ? true : props['aria-busy']}
  >
    <span className="ui-button__content">{children}</span>
    <span className="ui-action__pending" aria-hidden="true" />
  </button>
}
