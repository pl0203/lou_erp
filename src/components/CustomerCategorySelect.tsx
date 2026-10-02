import { useId } from 'react'
import { CUSTOMER_CATEGORIES, type CustomerCategory } from '../lib/customerCategory'

type Props = {
  value: CustomerCategory | null | ''
  allowUnclassified: boolean
  onChange: (value: CustomerCategory | null | '') => void
}

export default function CustomerCategorySelect({ value, allowUnclassified, onChange }: Props) {
  const id = useId()
  return <div>
    <label htmlFor={id} className="block text-sm text-gray-600 mb-1">Kategori Pelanggan{!allowUnclassified && ' *'}</label>
    <select id={id} required={!allowUnclassified} value={value === null ? 'unclassified' : value}
      onChange={event => onChange(event.target.value === 'unclassified' ? null : event.target.value as CustomerCategory | '')}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
      <option value="" disabled>Pilih kategori...</option>
      {allowUnclassified && <option value="unclassified">Unclassified</option>}
      {CUSTOMER_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
    </select>
  </div>
}
