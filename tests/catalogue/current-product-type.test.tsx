import {cleanup,render,screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {afterEach,expect,test} from 'vitest'
import COOrderDetailTable from '../../src/components/co/COOrderDetailTable'
afterEach(cleanup)
const line={id:'line',product_id:'product',display_sku:'SAME',product_name:'Saved name',stock_key_id:'stock',ordered_quantity:'2',delivered_quantity:'1',pending_quantity:'1',resolved_undelivered_quantity:'0',unit_price:'12.00'} as any
const rows=[{id:'product',sku:'SAME',product_type:'Mosaic'},{id:'different',sku:'SAME',product_type:'Granite'}]
test('current Tipe changes by stable product identity without changing saved order values',()=>{
 const view=render(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:rows}}/></MemoryRouter>)
 expect(screen.getByText('Tipe saat ini: Mosaic')).toBeTruthy()
 expect(screen.getByText('Saved name')).toBeTruthy()
 expect(screen.getByText('Rp 24')).toBeTruthy()
 view.rerender(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:[{...rows[0],product_type:'Wastafel'}]}}/></MemoryRouter>)
 expect(screen.getByText('Tipe saat ini: Wastafel')).toBeTruthy()
 expect(screen.getByText('Saved name')).toBeTruthy()
 expect(screen.getByText('Rp 24')).toBeTruthy()
})
test('failed or refreshing metadata never reveals an old accepted type',()=>{
 const view=render(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:rows,isError:true}}/></MemoryRouter>)
 expect(screen.getByText('Tipe saat ini: Tidak tersedia')).toBeTruthy()
 expect(screen.queryByText(/Mosaic/)).toBeNull()
 view.rerender(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:rows,isFetching:true}}/></MemoryRouter>)
 expect(screen.queryByText(/Mosaic/)).toBeNull()
 view.rerender(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:rows,isPaused:true}}/></MemoryRouter>)
 expect(screen.queryByText(/Mosaic/)).toBeNull()
})
test('unclassified differs from inaccessible product and never joins by duplicate SKU',()=>{
 const view=render(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:[{...rows[0],product_type:null}]}}/></MemoryRouter>)
 expect(screen.getByText('Tipe saat ini: —')).toBeTruthy()
 view.rerender(<MemoryRouter><COOrderDetailTable lines={[line]} customerId="customer" currentProducts={{data:[rows[1]]}}/></MemoryRouter>)
 expect(screen.getByText('Tipe saat ini: Tidak tersedia')).toBeTruthy()
 expect(screen.queryByText(/Granite/)).toBeNull()
})

test('PO and CO draft rows display current metadata without editing transaction fields', async()=>{
 const {POLineRow}=await import('../../src/components/POLineItems')
 const {COLineRow}=await import('../../src/components/co/COLineItems')
 const {vi}=await import('vitest');const change=vi.fn()
 render(<><POLineRow lineKey="po" item={{product_id:'product',sku:'SAME',product_name:'Saved PO',quantity:2,unit_price:12}} currentProducts={{data:rows}} onChange={change} onRemove={()=>{}} nameRef={null} quantityRef={null} priceRef={null}/><COLineRow line={{key:'co',id:'line',existing:false,removable:true,product_id:'product',product_name:'Saved CO',sku:'SAME',quantity:'2',agreed_price:'12',minimum:'0'}} currentProducts={{data:rows}} disabled={false} change={change} remove={()=>{}} refs={{name:null,quantity:null,price:null}}/></>)
 expect(screen.getAllByText('Tipe saat ini: Mosaic')).toHaveLength(2)
 expect(change).not.toHaveBeenCalled()
})
