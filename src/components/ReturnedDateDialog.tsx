import type { ReactNode } from 'react'
import { Dialog } from './ui/Dialog'

/** Compatibility adapter; the PO owner retains its date, pending lock and focus targets. */
export default function ReturnedDateDialog({ children, pending, onClose, returnFocus, fallbackFocus, labelledBy = 'returned-date-title' }: {
  labelledBy?: string; children: ReactNode; pending: boolean; onClose: () => void; returnFocus: HTMLElement | null; fallbackFocus: () => HTMLElement | null
}) {
  return <Dialog labelledBy={labelledBy} pending={pending} onClose={onClose} returnFocus={returnFocus} fallbackFocus={fallbackFocus}>{children}</Dialog>
}
