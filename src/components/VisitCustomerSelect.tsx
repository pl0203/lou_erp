import { useState } from 'react'

type CustomerChoice = { id: string; name: string; city?: string | null; address?: string | null }
export default function VisitCustomerSelect({ customers, value, onChange, disabled, label = 'Pelanggan' }: { customers: CustomerChoice[]; value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const [search, setSearch] = useState('')
  const text = (customer: CustomerChoice) => [customer.name, customer.city, customer.address].filter(Boolean).join(' · ')
  const matches = customers.filter(customer => text(customer).toLocaleLowerCase('id-ID').includes(search.trim().toLocaleLowerCase('id-ID')))
  const selected = customers.find(customer => customer.id === value)
  // Keep the selected value present while searching, so filtering never changes a draft implicitly.
  const choices = selected && !matches.some(customer => customer.id === value) ? [selected, ...matches] : matches
  return <div className="space-y-2">
    <label className="block text-sm text-gray-700">Cari pelanggan<input type="search" aria-label="Cari pelanggan" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} placeholder="Nama perusahaan, kota, atau cabang" className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" /></label>
    <label className="block text-sm text-gray-700">{label}<select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2">
      <option value="">Pilih pelanggan...</option>
      {choices.map(customer => <option key={customer.id} value={customer.id}>{text(customer)}</option>)}
    </select></label>
    {search && <p className="text-xs text-gray-600">{matches.length} pelanggan cocok. {selected && !matches.includes(selected) ? 'Pilihan sebelumnya tetap tersimpan.' : ''}</p>}
  </div>
}
