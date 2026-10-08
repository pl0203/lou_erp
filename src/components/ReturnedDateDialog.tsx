import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/** Native top-layer modal plus explicit containment for keyboard and non-native test environments. */
export default function ReturnedDateDialog({ children, pending, onClose, returnFocus, fallbackFocus, labelledBy = 'returned-date-title' }: {
  labelledBy?: string; children: ReactNode; pending: boolean; onClose: () => void; returnFocus: HTMLElement | null; fallbackFocus: () => HTMLElement | null
}) {
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
  return <dialog ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={labelledBy}
    onCancel={event => { event.preventDefault(); if (!pending) onClose() }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!pending) onClose(); return }
      if (event.key !== 'Tab') return
      const targets = controls(), first = targets[0], last = targets.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus(); return }
      // Let the native modal honor segmented date-input navigation and its own Tab boundary.
      if (nativeModal.current) return
      if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}
    className="fixed inset-0 m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-gray-200 bg-white p-6 shadow-xl backdrop:bg-black/40">
    {children}
  </dialog>
}
