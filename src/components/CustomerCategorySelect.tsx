import { useId } from 'react'
import { Field } from './ui/Field'
import { CUSTOMER_CATEGORIES, type CustomerCategory } from '../lib/customerCategory'

type Props = {
  value: CustomerCategory | null | ''
  allowUnclassified: boolean
  onChange: (value: CustomerCategory | null | '') => void
}

export default function CustomerCategorySelect({ value, allowUnclassified, onChange }: Props) {
  const id = useId()
  return <Field id={id} label={<>Kategori Pelanggan{!allowUnclassified && ' *'}</>} hint="Pilih menurut jenis dan skala usaha pelanggan: supermarket besar/sedang/kecil, pasar tradisional, atau perorangan. Kategori tidak mengubah tier harga; pilih tier sesuai kesepakatan harga pelanggan.">
    {control => <select {...control} required={!allowUnclassified} value={value === null ? 'unclassified' : value}
      onChange={event => onChange(event.target.value === 'unclassified' ? null : event.target.value as CustomerCategory | '')}>
      <option value="" disabled>Pilih kategori...</option>
      {allowUnclassified && <option value="unclassified">Unclassified</option>}
      {CUSTOMER_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}
    </select>}
  </Field>
}
