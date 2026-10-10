import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { POCustomerLookup, POProductLookup } from '../src/components/POLookup'
afterEach(cleanup)
const product = (id: string, name = `Product ${id}`) => ({ id, name, sku: id, size: null })

test('lookup Enter and IME Enter never submit an enclosing form', () => {
 const submit = vi.fn(), select = vi.fn()
 render(<form onSubmit={submit}><POProductLookup products={[product('a')]} onSelect={select} /></form>)
 const input = screen.getByRole('combobox')
 fireEvent.change(input, { target: { value: 'a' } })
 expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false)
 expect(select).not.toHaveBeenCalled()
 expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)
 expect(select).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled()
})

test('complete catalog search finds the 1001st product and limits only visible options', () => {
 const products = Array.from({ length: 1001 }, (_, i) => product(`SKU-${i}`)); const select = vi.fn()
 render(<POProductLookup products={products} onSelect={select} />)
 const input = screen.getByRole('combobox')
 fireEvent.change(input, { target: { value: 'SKU' } })
 expect(screen.getAllByRole('option')).toHaveLength(6)
 expect(screen.getByText(/6 dari 1001 hasil/)).toBeTruthy()
 fireEvent.change(input, { target: { value: 'SKU-1000' } }); fireEvent.keyDown(input, { key: 'Enter' })
 expect(select).toHaveBeenCalledWith(products[1000])
})

test('refreshing results requires a new deliberate arrow selection', () => {
 const select = vi.fn(); const view = render(<POProductLookup products={[product('a'), product('b')]} onSelect={select} />)
 const input = screen.getByRole('combobox')
 fireEvent.change(input, { target: { value: 'Product' } }); fireEvent.keyDown(input, { key: 'ArrowDown' })
 view.rerender(<POProductLookup products={[product('a', 'Product refreshed'), product('c')]} onSelect={select} />)
 fireEvent.keyDown(input, { key: 'Enter' }); expect(select).not.toHaveBeenCalled()
 fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
 expect(select).toHaveBeenCalledWith(expect.objectContaining({ name: 'Product refreshed' }))
})

test('pointer selection keeps the search focus until click so touch blur cannot discard the option', () => {
 const select = vi.fn(); render(<POProductLookup products={[product('a')]} onSelect={select} />)
 const input = screen.getByRole('combobox'); input.focus(); fireEvent.change(input, { target: { value: 'a' } })
 const option = screen.getByRole('option')
 expect(fireEvent.pointerDown(option, { pointerType: 'touch' })).toBe(false)
 fireEvent.click(option); expect(select).toHaveBeenCalledTimes(1)
 expect(screen.queryByRole('listbox')).toBeNull()
})

test('duplicate customer names expose short existing identifiers and query edits leave selected label recoverable', () => {
 const select = vi.fn(), customers = [{ id: '11111111-long-id', name: 'Shop', pricing_tier: 'others' }, { id: '22222222-long-id', name: 'Shop', pricing_tier: 'others' }]
 render(<POCustomerLookup customers={customers} selectedId={customers[0].id} onSelect={select} />)
 const input = screen.getByRole('combobox'); fireEvent.change(input, { target: { value: 'sho' } })
 expect(screen.getByRole('option', { name: /11111111/ })).toBeTruthy(); expect(screen.getByRole('option', { name: /22222222/ })).toBeTruthy()
 fireEvent.keyDown(input, { key: 'Escape' }); expect((input as HTMLInputElement).value).toBe('Shop')
 expect(select).not.toHaveBeenCalled()
})

test('selected customer label survives a temporarily unavailable retry collection', () => {
 const select = vi.fn(), customers = [{ id: 'c', name: 'Selected shop', pricing_tier: 'others' }]
 const view = render(<POCustomerLookup customers={customers} selectedId="c" onSelect={select} />)
 view.rerender(<POCustomerLookup customers={[]} selectedId="c" disabled onSelect={select} />)
 expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Selected shop')
})

test('input-owned combobox options are excluded from Tab order while arrows and Escape stay on input', () => {
 render(<POProductLookup products={[product('a'), product('b')]} onSelect={vi.fn()} />)
 const input = screen.getByRole('combobox'); input.focus()
 fireEvent.change(input, { target: { value: 'Product' } })
 for (const option of screen.getAllByRole('option')) expect(option.tabIndex).toBe(-1)
 fireEvent.keyDown(input, { key: 'ArrowDown' })
 expect(document.activeElement).toBe(input)
 expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)
 fireEvent.keyDown(input, { key: 'Escape' }); expect(screen.queryByRole('listbox')).toBeNull()
 expect(document.activeElement).toBe(input)
})
