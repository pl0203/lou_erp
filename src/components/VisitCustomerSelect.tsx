import { useId, useState } from 'react'
import { Field } from './ui/Field'

type CustomerChoice = { id: string; name: string; city?: string | null; address?: string | null }
export default function VisitCustomerSelect({ customers, value, onChange, disabled, label = 'Pelanggan' }: { customers: CustomerChoice[]; value: string; onChange: (value: string) => void; disabled?: boolean; label?: string }) {
  const [search, setSearch] = useState('')
  const fieldId = useId()
  const text = (customer: CustomerChoice) => [customer.name, customer.city, customer.address].filter(Boolean).join(' · ')
  const matches = customers.filter(customer => text(customer).toLocaleLowerCase('id-ID').includes(search.trim().toLocaleLowerCase('id-ID')))
  const selected = customers.find(customer => customer.id === value)
  // Keep the selected value present while searching, so filtering never changes a draft implicitly.
  const choices = selected && !matches.some(customer => customer.id === value) ? [selected, ...matches] : matches
  return <div className="space-y-2">
    <Field id={`${fieldId}-search`} label="Cari pelanggan">{control => <input {...control} type="search" value={search} onChange={event => setSearch(event.target.value)} disabled={disabled} placeholder="Nama perusahaan, kota, atau cabang" />}</Field>
    <Field id={`${fieldId}-customer`} label={label}>{control => <select {...control} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">Pilih pelanggan...</option>
      {choices.map(customer => <option key={customer.id} value={customer.id}>{text(customer)}</option>)}
    </select>}</Field>
    {search && <p className="text-[13px] text-brand-secondary">{matches.length} pelanggan cocok. {selected && !matches.includes(selected) ? 'Pilihan sebelumnya tetap tersimpan.' : ''}</p>}
  </div>
}
