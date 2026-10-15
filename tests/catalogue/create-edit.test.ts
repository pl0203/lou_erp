import { expect, test, vi } from 'vitest'
import { sendCatalogueForm } from '../../src/lib/catalogue/formCommands'
import type { CatalogueTransactionSender } from '../../src/lib/catalogue/transactions'
const original = { id: '22222222-2222-4222-8222-222222222222', catalog_version: '9007199254740993', is_enabled: false,
  name: 'Saved', sku: 'SAVED', size: null, harga_pokok: null, luar_kota: 0, dalam_kota: 1, depo_bangunan: 2, unit_price: 17 } as const
const values = { name: 'New', sku: 'NEW', size: null, harga_pokok: null, luar_kota: 0, dalam_kota: 1, depo_bangunan: 2 }
test('form edits use captured identity/version rather than a number or current list replacement', async () => {
 const send=vi.fn(async()=>({}))
 await sendCatalogueForm(send as unknown as CatalogueTransactionSender,'product',{ name: 'Changed' },original as any)
 expect(send).toHaveBeenCalledWith('edit',{ kind:'product',id:original.id,expected_version:'9007199254740993',values:{name:'Changed'} })
})
test('form creation excludes client UUID and server/legacy fields', async()=>{
 const send=vi.fn(async()=>({}))
 await sendCatalogueForm(send as unknown as CatalogueTransactionSender,'product',values,null)
 expect(send).toHaveBeenCalledWith('create',{kind:'product',values})
 await expect(sendCatalogueForm(send as unknown as CatalogueTransactionSender,'product',{...values,unit_price:0},null)).rejects.toThrow()
 expect(send).toHaveBeenCalledTimes(1)
})
test('customer no intended change does not produce a request or success receipt',async()=>{
 const send=vi.fn()
 expect(await sendCatalogueForm(send as unknown as CatalogueTransactionSender,'product',{},original as any)).toBeNull()
 expect(send).not.toHaveBeenCalled()
})
