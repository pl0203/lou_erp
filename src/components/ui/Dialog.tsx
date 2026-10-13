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

type DialogOwner = { node: HTMLDialogElement; focusInside: () => void }
// Mount order matches modal order. Only the topmost owner may contain focus.
const owners: DialogOwner[] = []
const activeOwner = () => owners.at(-1)

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
    const owner = { node, focusInside }
    owners.push(owner)
    if (typeof node.showModal === 'function') { nativeModal.current = true; node.showModal() }
    else node.setAttribute('open', '')
    focusInside()
    const contain = (event: FocusEvent) => { if (activeOwner() === owner && !node.contains(event.target as Node)) focusInside() }
    document.addEventListener('focusin', contain)
    return () => {
      const wasActive = activeOwner() === owner
      document.removeEventListener('focusin', contain)
      owners.splice(owners.indexOf(owner), 1)
      if (node.open && typeof node.close === 'function') node.close()
      else node.removeAttribute('open')
      if (!wasActive) return
      const target = returnFocus?.isConnected ? returnFocus : fallbackFocus()
      const next = activeOwner()
      if (next && (!target || !next.node.contains(target))) next.focusInside()
      else target?.focus()
    }
  }, [])
  return <dialog {...props} ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); if (activeOwner()?.node === dialog.current && !pending) onClose() }}
    onKeyDown={event => {
      if (activeOwner()?.node !== dialog.current) return
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
