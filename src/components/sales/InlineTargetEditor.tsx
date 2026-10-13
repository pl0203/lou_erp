import { useId } from 'react'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import type { TargetEditorLayout } from '../ui/useTargetEditorLock'
import { formatMoney } from '../../lib/reads/money'
import type { TargetDraftSession } from './useTargetDraftSession'

export function InlineTargetEditor({ recordId, currentTarget, canEdit, targetEditors, layout, compact = false }: {
  recordId: string
  currentTarget: string | null
  canEdit: boolean
  targetEditors: TargetDraftSession
  layout: TargetEditorLayout
  compact?: boolean
}) {
  const fieldId = useId()
  const draft = targetEditors.draft?.recordId === recordId && targetEditors.draft.layout === layout ? targetEditors.draft : null
  if (!canEdit) return <span className={`text-brand-secondary ${compact ? 'text-sm' : 'text-base'}`}>
    {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'full')}` : '—'}
  </span>

  if (draft) return <div className="flex flex-wrap items-end justify-end gap-2">
    <Field id={fieldId} label="Target penjualan (Rp)" className="w-40 max-w-full">
      {control => <input {...control}
        type="number"
        value={draft.value}
        disabled={draft.pending}
        onChange={event => targetEditors.change(draft.token, event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); targetEditors.save(draft.token) }
          if (event.key === 'Escape') { event.preventDefault(); targetEditors.cancel(draft.token) }
        }}
        placeholder="0"
        autoFocus
        className="text-right focus:outline-none focus:ring-2 focus:ring-brand-primary"
      />}
    </Field>
    <Button onClick={() => targetEditors.save(draft.token)} pending={draft.pending}>Simpan target</Button>
    <Button variant="quiet" onClick={() => targetEditors.cancel(draft.token)} disabled={draft.pending}>Batal</Button>
    {draft.error && <p role="alert" className="basis-full text-sm text-red-700">Penyimpanan target mengalami kendala. Coba simpan lagi atau pilih Batal.</p>}
  </div>

  return <Button size="compact" variant="quiet" className="w-full" disabled={targetEditors.busy}
    aria-describedby={targetEditors.busy ? targetEditors.descriptionId : undefined}
    onClick={() => targetEditors.open(recordId, layout, currentTarget?.toString() ?? '')}>
    {currentTarget != null ? `Rp ${formatMoney(currentTarget, 'full')}` : '+ Atur target'}
  </Button>
}
