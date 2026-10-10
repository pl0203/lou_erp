import type { QueryClient } from '@tanstack/react-query'

/** Only customer projections, never PO/line/catalog queries or every query. */
export async function refreshCustomerCaches(client: QueryClient, assignments = false) {
  const prefixes = ['athel_customers', 'all_customers', 'customers', 'girard_customer', 'manager_customers', 'my_customers']
  if (assignments) prefixes.push('assignments', 'managers_data')
  await Promise.all(prefixes.map(prefix => client.invalidateQueries({ queryKey: [prefix] })))
}

/** A successful transport alone does not confirm which intended row was written. */
export async function confirmCustomerWrite(
  write: () => PromiseLike<{ data: unknown; error: unknown }>,
  expected: Record<string, string>,
  subject = 'Penyimpanan pelanggan',
) {
  try {
    const { data, error } = await write()
    if (error) throw error
    if (!Array.isArray(data) || data.length !== 1 || !data[0] ||
      !Object.entries(expected).every(([key, value]) => data[0][key] === value)) {
      throw new Error('Respons tidak mengonfirmasi baris yang dituju.')
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message
      : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'Respons tidak tersedia.'
    throw new Error(`${subject} belum terkonfirmasi. ${detail} Periksa data sebelum mencoba lagi; perubahan mungkin sudah tersimpan.`)
  }
}
