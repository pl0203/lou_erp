import type { CatalogueKind, CatalogueReceipt, CatalogueRow } from './contracts'
import type { CatalogueTransactionSender } from './transactions'
import { parseCataloguePayload } from './validation'

/** A form never acknowledges an HTTP success or dispatches through a legacy path.
 * The stable page owner retains the durable request until canonical recovery. */
export async function sendCatalogueForm<K extends CatalogueKind>(
  sender: CatalogueTransactionSender,
  kind: K,
  values: Record<string, unknown>,
  original: CatalogueRow<K> | null,
): Promise<CatalogueReceipt | null> {
  if (original && !Object.keys(values).length) return null
  if (original) {
    const payload = parseCataloguePayload('edit', { kind, id: original.id, expected_version: original.catalog_version, values })
    return sender('edit', payload)
  }
  return sender('create', parseCataloguePayload('create', { kind, values }))
}
