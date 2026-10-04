import { useId, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'

type Option = { id: string; name: string }
export type POCustomerOption = Option & { pricing_tier: string }
export type POProductOption = Option & { sku: string; size: string | null }
const normalize = (value: string) => value.trim().toLocaleLowerCase()
const VISIBLE_OPTIONS = 6

/** Search the complete, authorized collection; the limit is presentation only. */
function Picker<T extends Option>({ items, label, placeholder, selectedLabel = '', disabled = false, inputRef, match, exact, describe, onSelect }: {
  items: T[]; label: string; placeholder: string; selectedLabel?: string; disabled?: boolean; inputRef?: Ref<HTMLInputElement>
  match: (item: T, query: string) => boolean; exact?: (item: T, query: string) => boolean
  describe: (item: T) => string; onSelect: (item: T) => void
}) {
  const id = useId()
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<{ id: string; source: T[]; query: string } | null>(null)
  const composing = useRef(false)
  const consumed = useRef(false)
  const normalized = normalize(query ?? '')
  const matches = useMemo(() => {
    if (!normalized) return []
    const found = items.filter(item => match(item, normalized))
    if (!exact) return found
    return [...found.filter(item => exact(item, normalized)), ...found.filter(item => !exact(item, normalized))]
  }, [items, normalized, match, exact])
  const results = matches.slice(0, VISIBLE_OPTIONS)
  const expanded = open && !disabled && !!normalized
  const activeId = !disabled && active?.source === items && active.query === normalized ? active.id : null
  const activeItem = results.find(item => item.id === activeId)
  const select = (item: T) => {
    if (disabled || consumed.current) return
    consumed.current = true
    setQuery(null); setOpen(false); setActive(null)
    onSelect(item)
  }
  return <div className="relative min-w-0" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setOpen(false); setQuery(null); setActive(null) }
  }}>
    <input
      ref={inputRef} role="combobox" aria-label={label} aria-autocomplete="list"
      aria-expanded={expanded} aria-controls={`${id}-list`}
      aria-activedescendant={expanded && activeItem ? `${id}-${activeItem.id}` : undefined}
      autoComplete="off" type="text" placeholder={placeholder} disabled={disabled}
      value={query ?? selectedLabel}
      onFocus={() => { consumed.current = false; setOpen(true) }}
      onChange={event => { consumed.current = false; setQuery(event.target.value); setActive(null); setOpen(true) }}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false }}
      onKeyDown={event => {
        if (!['Enter', 'ArrowDown', 'ArrowUp', 'Escape'].includes(event.key)) return
        // These controls always consume Enter, including IME and held keys.
        event.preventDefault()
        if (disabled || composing.current || event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return
        if (event.key === 'Escape') { setOpen(false); setActive(null); setQuery(null); return }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!results.length) return
          setOpen(true)
          const index = results.findIndex(item => item.id === activeId)
          const next = event.key === 'ArrowDown' ? (index + 1) % results.length : (index <= 0 ? results.length - 1 : index - 1)
          setActive({ id: results[next].id, source: items, query: normalized })
          return
        }
        if (!expanded) return
        if (activeItem) { select(activeItem); return }
        const exactMatches = exact ? matches.filter(item => exact(item, normalized)) : []
        if (exactMatches.length === 1) select(exactMatches[0])
      }}
      className="min-w-0 max-w-full w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50 disabled:bg-gray-50 disabled:text-gray-500"
    />
    {expanded && <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
      <div id={`${id}-list`} role="listbox" aria-label={label}>
        {results.map(item => <button
          key={item.id} id={`${id}-${item.id}`} type="button" role="option" tabIndex={-1} aria-selected={activeId === item.id}
          onPointerDown={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onClick={() => select(item)}
          className={`w-full text-left px-4 py-3 transition-colors border-b border-gray-50 last:border-0 [overflow-wrap:anywhere] ${activeId === item.id ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
        >
          <span className="block text-sm text-gray-900">{item.name}</span>
          <span className="block text-xs text-gray-500 mt-0.5">{describe(item)}</span>
        </button>)}
      </div>
      {!results.length && <p className="px-4 py-3 text-sm text-gray-500">Tidak ditemukan. Coba kata pencarian lain.</p>}
      {matches.length > VISIBLE_OPTIONS && <p className="px-4 py-2 text-xs text-gray-500">Menampilkan {VISIBLE_OPTIONS} dari {matches.length} hasil. Perjelas pencarian.</p>}
      {exact && !activeItem && matches.filter(item => exact(item, normalized)).length > 1 && <p className="px-4 py-2 text-xs text-amber-700">SKU cocok dengan beberapa produk. Pilih produk yang dimaksud.</p>}
    </div>}
  </div>
}

export function POCustomerLookup({ customers, selectedId, selectedLabel, disabled, onSelect }: {
  customers: POCustomerOption[]; selectedId: string; selectedLabel?: string; disabled?: boolean; onSelect: (customer: POCustomerOption) => void
}) {
  const selected = customers.find(customer => customer.id === selectedId)
  const knownLabels = useRef<Record<string, string>>({})
  if (selected) knownLabels.current[selected.id] = selected.name
  return <Picker items={customers} label="Pelanggan" placeholder="Cari nama pelanggan..." selectedLabel={selected?.name ?? knownLabels.current[selectedId] ?? selectedLabel} disabled={disabled}
    match={(customer, query) => normalize(customer.name).includes(query) || normalize(customer.id).includes(query)}
    describe={customer => customers.some(other => other.id !== customer.id && normalize(other.name) === normalize(customer.name)) ? `ID ${customer.id.slice(0, 8)}` : ''}
    onSelect={onSelect} />
}

export function POProductLookup<T extends POProductOption>({ products, onSelect, disabled, inputRef, label = 'Cari SKU atau nama barang' }: {
  products: T[]; onSelect: (product: T) => void; disabled?: boolean; inputRef?: Ref<HTMLInputElement>; label?: string
}) {
  return <Picker items={products} label={label} placeholder="Cari SKU atau nama barang..." disabled={disabled} inputRef={inputRef}
    match={(product, query) => normalize(product.sku).includes(query) || normalize(product.name).includes(query)}
    exact={(product, query) => normalize(product.sku) === query}
    describe={product => [product.sku, product.size].filter(Boolean).join(' · ')} onSelect={onSelect} />
}
