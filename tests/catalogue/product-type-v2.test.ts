import { describe, expect, test } from 'vitest'
import * as v2 from '../../src/lib/catalogue/validation'
import { decodeCataloguePage, parseCataloguePayload } from '../../src/lib/catalogue/validation'

const labels = ['Bonbon','Bak Cuci Piring','Wastafel','Batu Taman','Granite','Closet','Listello','Mosaic','Meja','Andesit','Pola','House Plint','Rumput Sintetis','Teracotta','Gentong','Air Mancur','Step Nosing']
const actor = '00000000-0000-4000-8000-000000000001'
const id = '00000000-0000-4000-8000-000000000002'
const args = {kind:'product',purpose:'catalogue',status:'all',search:'',page:1,page_size:10} as const
const identity = {backend:'synthetic',actorId:actor,role:'co_admin'} as const
const values = {name:'Product',sku:'SKU',size:null,harga_pokok:null,luar_kota:null,dalam_kota:null,depo_bangunan:null}
const product = {id,...values,unit_price:null,is_enabled:true,catalog_version:'1'}
const page = {version:2,actor_id:actor,role:'co_admin',...args,total_count:'1',rows:[{...product,product_type:'Mosaic'}]}

describe('required product Tipe v2 contracts', () => {
  test('uses all seventeen exact labels with Mosaic once', () => expect(v2.PRODUCT_TYPES).toEqual(labels))
  test.each(labels)('accepts exact type %s', value => expect(v2.parseProductType(value)).toBe(value))
  test.each([null,undefined,'','mosaic',' Mosaic','Mosaic ',1,{},[]])('rejects missing or unsupported selection %#', value => expect(() => v2.parseProductType(value)).toThrow())
  test('strict v2 page retains nullable legacy metadata, actor binding and exact count', () => {
    expect(v2.decodeCataloguePageV2(page,identity,args)).toEqual(page)
    const legacy={...page,rows:[{...product,product_type:null}]}
    expect(v2.decodeCataloguePageV2(legacy,identity,args)).toEqual(legacy)
    for(const bad of [{...page,version:1},{...page,rows:[product]},{...page,rows:[{...product,product_type:'other'}]},{...page,actor_id:id},{...page,total_count:'2'},{...page,extra:1}]) expect(() => v2.decodeCataloguePageV2(bad,identity,args)).toThrow()
  })
  test('leaves unchanged v1 shapes strict', () => {
    const old={...page,version:1,rows:[product]}
    expect(decodeCataloguePage(old,identity,args)).toEqual(old)
    expect(() => decodeCataloguePage({...old,rows:page.rows},identity,args)).toThrow()
    expect(() => parseCataloguePayload('create',{kind:'product',values:{...values,product_type:'Mosaic'}})).toThrow()
  })
  test('requires valid type on every create and edit, not only when changed', () => {
    const create={kind:'product',values:{...values,product_type:'Mosaic'}}
    expect(v2.parseProductPayloadV2('create',create)).toEqual(create)
    const edit={kind:'product',id,expected_version:'1',values:{name:'Changed',product_type:'Granite'}}
    expect(v2.parseProductPayloadV2('edit',edit)).toEqual(edit)
    for(const value of [null,undefined,'Unknown']) {
      expect(() => v2.parseProductPayloadV2('create',{...create,values:{...values,product_type:value}})).toThrow()
      expect(() => v2.parseProductPayloadV2('edit',{...edit,values:{name:'Changed',product_type:value}})).toThrow()
    }
    expect(() => v2.parseProductPayloadV2('edit',{...edit,values:{name:'Changed'}})).toThrow()
    expect(() => v2.parseProductPayloadV2('edit',{...edit,values:{product_type:'Mosaic',is_enabled:false}})).toThrow()
    expect(() => v2.parseProductPayloadV2('edit',{...edit,kind:'customer'})).toThrow()
  })
})
