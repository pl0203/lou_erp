import { useEffect, useRef } from 'react'
import type { DialogHTMLAttributes, ReactNode } from 'react'

type Props = Omit<DialogHTMLAttributes<HTMLDialogElement>, 'children' | 'open' | 'onClose' | 'onCancel' | 'onKeyDown'> & {
  labelledBy: string
  children: ReactNode
  pending: boolean
  onClose: () => void
  returnFocus: HTMLElement | null
  fallbackFocus: () => HTMLElement | null
}

/** Mount only while open. The owner keeps dismissal and transaction decisions. */
export function Dialog({ labelledBy, children, pending, onClose, returnFocus, fallbackFocus, className, ...props }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const nativeModal = useRef(false)
  const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') ?? [])
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true' && element.getAttribute('aria-disabled') !== 'true')
  const focusInside = () => (controls()[0] ?? dialog.current)?.focus()
  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (typeof node.showModal === 'function') { nativeModal.current = true; node.showModal() }
    else node.setAttribute('open', '')
    focusInside()
    const contain = (event: FocusEvent) => { if (!node.contains(event.target as Node)) focusInside() }
    document.addEventListener('focusin', contain)
    return () => {
      document.removeEventListener('focusin', contain)
      if (node.open && typeof node.close === 'function') node.close()
      else node.removeAttribute('open')
      const target = returnFocus?.isConnected ? returnFocus : fallbackFocus()
      target?.focus()
    }
  }, [])
  return <dialog {...props} ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); if (!pending) onClose() }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!pending) onClose(); return }
      if (event.key !== 'Tab') return
      const targets = controls(), first = targets[0], last = targets.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus(); return }
      // Native modal navigation owns date-input segments and its Tab boundary.
      if (nativeModal.current) return
      if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}
    className={`ui-dialog${className ? ` ${className}` : ''}`}>
    {children}
  </dialog>
}
