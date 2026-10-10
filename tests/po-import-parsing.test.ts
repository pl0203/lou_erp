import { describe, expect, test } from 'vitest'
import { parsePODocument } from '../src/lib/poImport/parse'
import { normalizeNumber } from '../src/lib/poImport/numbers'
import { depotTable, page, photoGrid, pricedIndent, token, unpricedIndent } from './fixtures/po-import-layouts'

const replace = (pages: ReturnType<typeof photoGrid>, from: string, to: string) => {
  const found = pages.flatMap(p=>p.tokens).find(t=>t.text===from)
  if (!found) throw new Error(`Synthetic token not found: ${from}`)
  found.text = to
  return pages
}
describe('strict decimal normalization', () => {
  test.each([
    ['1.000,0','comma-decimal','1000'],['1,080.00','dot-decimal','1080'],['1,234','unknown',null],
    ['1.234','unknown',null],['12,34','unknown','12.34'],['12.34','unknown','12.34'],['1,234.50','unknown','1234.5'],
    ['00012','unknown','12'],['0','unknown','0'],['1.000.000','comma-decimal','1000000'],['4.125,25','comma-decimal','4125.25'],
    ['1,234','comma-decimal','1.234'],['1.234','dot-decimal','1.234'],['12,34','dot-decimal',null],['1,00,000','dot-decimal',null],
    ['1e3','unknown',null],['-1','unknown',null],['NaN','unknown',null],['1O0','unknown',null],['','unknown',null],['Rp 1.000','comma-decimal',null],
  ] as const)('%s / %s -> %s', (raw, convention, value) => expect(normalizeNumber(raw,convention)).toBe(value))
})
describe('four structural layouts', () => {
  test('keeps photo stacked SKU/barcode and paired price cells as three rows', () => {
    const p=parsePODocument(photoGrid())
    expect(p.layout).toBe('photo-grid');expect(p.complete).toBe(true);expect(p.rows).toHaveLength(3)
    expect(p.buyer.value).toBe('PT. LANTERN MATERIALS');expect(p.supplier.value).toBe('GLASS PINE SUPPLY')
    expect(p.supplier.raw).toContain('V-00999');expect(p.poNumber.value).toBe('O1/LT01-28010401')
    expect(p.orderDate.value).toBe('2028-01-12');expect(p.delivery.value).toBe('2028-01-15');expect(p.paymentTerms.raw).toContain('40 Hari')
    expect(p.rows[0].sku.value).toBe('000710001');expect(p.rows[0].barcode.value).toBe('880010001')
    expect(p.rows[0].quantity).toMatchObject({raw:'1.000,0',value:'1000',page:1})
    expect(p.rows.map(r=>r.unitPrice.value)).toEqual(['4000','5000','7000']);expect(p.printedTotal.value).toBe('16000000')
  })
  test('unpriced indent preserves wrapped names, buyer header, barcode identity and missing prices', () => {
    const p=parsePODocument(unpricedIndent())
    expect(p.layout).toBe('unpriced-indent');expect(p.complete).toBe(true);expect(p.rows).toHaveLength(3)
    expect(p.buyer.value).toBe('LANTERN BUILDING');expect(p.poNumber.value).toBe('O1/LB1-28020105')
    expect(p.orderDate.value).toBe('2028-02-03');expect(p.delivery.value).toBe('2028-02-09');expect(p.paymentTerms.raw).toContain('50 Hari')
    expect(p.rows[0].name.value).toBe('GLASS WASH BOWL MODEL A BLUE');expect(p.rows[0].sku.value).toBeNull();expect(p.rows[0].barcode.value).toBe('900020001')
    expect(p.rows.every(r=>r.unitPrice.value===null)).toBe(true);expect(p.rows.map(r=>r.quantity.value)).toEqual(['1','2','50'])
  })
  test('priced indent uses header PO rather than note references and retains VAT price basis', () => {
    const p=parsePODocument(pricedIndent())
    expect(p.layout).toBe('priced-indent');expect(p.complete).toBe(true);expect(p.rows).toHaveLength(2)
    expect(p.buyer.value).toBe('PT. LANTERN RETAIL GROUP');expect(p.supplier.value).toBe('GLASS PINE SUPPLY');expect(p.poNumber.value).toBe('POZ1.2803.00421')
    expect(p.orderDate.value).toBe('2028-03-07');expect(p.notes).toContain('POSZ1.280306.00555')
    expect(p.rows.map(r=>r.unitPrice.value)).toEqual(['120000','42500']);expect(p.printedTotal.value).toBe('1300000');expect(p.priceBasis).toBe('gross')
    expect(p.issues.some(i=>i.code==='tax-review')).toBe(true)
  })
  test('depot headerless continuation keeps all 22 rows including wrapped text and excludes footer', () => {
    const p=parsePODocument(depotTable())
    expect(p.layout).toBe('depot-table');expect(p.complete).toBe(true);expect(p.rows).toHaveLength(22)
    expect(p.orderDate.value).toBeNull();expect(p.buyer.value).toBe('PT. LANTERN DEPOT, Tbk');expect(p.poNumber.value).toBe('PODEP280411-0042')
    expect(p.supplier.value).toBe('GLASS PINE SUPPLY');expect(p.rows[11].sku.value).toBe('GLS0000012');expect(p.rows[17].name.value).toBe('DISPLAY TRIM MODEL 18 BLUE')
    expect(p.rows[21].quantity.value).toBe('20');expect(p.rows[21].unitPrice.value).toBe('1200');expect(p.printedTotal.value).toBe('528000');expect(p.priceBasis).toBe('gross')
    expect(p.currency.value).toBeNull();expect(p.issues.some(i=>i.code==='order-date-missing')).toBe(true)
  })
  test('none invent expiry from payment terms or printed dates',()=>{
    const allFour=[photoGrid(),unpricedIndent(),pricedIndent(),depotTable()].map(parsePODocument)
    expect(allFour.every(p=>p.expiry.value===null)).toBe(true)
  })
  test('shuffled word fragments join by geometry rather than extraction array order',()=>{
    const input=pricedIndent();input[0].tokens.push(token('GLASS',93,168,26,14))
    input[0].tokens=input[0].tokens.filter(t=>t.text!=='GLASS 20X60 STEP BLUE')
    input[0].tokens.push(token('20X60',122,168,27,14),token('STEP',153,168,22,14),token('BLUE',178,168,22,14));input[0].tokens.reverse()
    expect(parsePODocument(input).rows[0].name.value).toBe('GLASS 20X60 STEP BLUE')
  })
  test('keeps genuinely duplicated source SKUs separate',()=>{
    const p=parsePODocument(replace(depotTable(),'GLS0000022','GLS0000021'))
    expect(p.rows).toHaveLength(22);expect(p.rows[21].sku.value).toBe(p.rows[20].sku.value);expect(p.rows[21].id).not.toBe(p.rows[20].id)
  })
  test('O versus zero in a low confidence photo PO stays raw and requires review',()=>{
    const input=photoGrid();input[0].tokens.find(t=>t.text.includes('O1/LT01'))!.confidence=50
    const p=parsePODocument(input);expect(p.poNumber.value).toBe('O1/LT01-28010401');expect(p.poNumber.raw).toContain('O1/LT01');expect(p.issues.some(i=>i.field==='poNumber' && i.code==='low-confidence')).toBe(true)
  })
  test('paired gross/net prices that disagree remain unresolved rather than silently netting',()=>{
    const input=photoGrid();input[0].tokens.find(t=>t.text==='4.000' && t.y===350)!.text='3.500'
    const row=parsePODocument(input).rows[0];expect(row.unitPrice.value).toBeNull();expect(row.unitPrice.raw).toContain('3.500');expect(row.issues.some(i=>i.code==='ambiguous-price')).toBe(true)
  })
  test('fractional source quantity is preserved and flagged without conversion',()=>{
    const p=parsePODocument(replace(depotTable(),'20.00','20.50'))
    expect(p.rows[0].quantity.value).toBe('20.5');expect(p.rows[0].issues.some(i=>i.code==='fractional-quantity')).toBe(true)
  })
  test('malformed source numbers retain text and resolve to null with issue',()=>{
    const row=parsePODocument(replace(pricedIndent(),'120,000','12O,000')).rows[0]
    expect(row.unitPrice.raw).toBe('12O,000');expect(row.unitPrice.value).toBeNull();expect(row.issues.some(i=>i.code==='unknown-number')).toBe(true)
  })
  test('flags a totals mismatch without adjusting prices or tax',()=>{
    const p=parsePODocument(replace(pricedIndent(),'Jumlah Bersih : 1,300,000','Jumlah Bersih : 1,300,001'))
    expect(p.rows[0].unitPrice.value).toBe('120000');expect(p.issues.some(i=>i.code==='total-mismatch')).toBe(true)
  })
  test('foreign currency is explicit and implicit currency stays unknown',()=>{
    expect(parsePODocument(photoGrid()).currency.value).toBeNull()
    expect(parsePODocument(replace(depotTable(),'Currency :','Currency : USD')).currency.value).toBe('USD')
  })
  test('documented zero price emits an explicit review issue',()=>{
    const p=parsePODocument(replace(pricedIndent(),'120,000','0'));expect(p.rows[0].unitPrice.value).toBe('0');expect(p.rows[0].issues.some(i=>i.code==='zero-price')).toBe(true)
  })
  test('invalid real calendar dates never normalize',()=>{
    const p=parsePODocument(replace(unpricedIndent(),'TGL. NOTA : 03-02-2028','TGL. NOTA : 31-02-2028'));expect(p.orderDate.value).toBeNull();expect(p.orderDate.raw).toContain('31-02-2028')
  })
  test('101 source rows are rejected, not truncated to 100',()=>{
    const p=parsePODocument(depotTable(101));expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='row-limit' && i.blocking)).toBe(true);expect(p.rows).not.toHaveLength(100)
  })
  test('unrecognized geometry returns honest unsupported fallback',()=>{
    const p=parsePODocument([page([token('PURCHASE ORDER',50,50),token('UNRECOGNIZED LIST',60,90)])]);expect(p.complete).toBe(false);expect(p.layout).toBeNull();expect(p.issues.some(i=>i.code==='unsupported-layout')).toBe(true)
  })
  test('two independent POs cannot be merged',()=>{
    const input=unpricedIndent();input.push({...unpricedIndent()[0],page:2,tokens:unpricedIndent()[0].tokens.map(t=>({...t,text:t.text.replace('O1/LB1-28020105','O1/LB1-28020106')}))})
    const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='multiple-po')).toBe(true)
  })
  test('a missing depot page is an incomplete extraction',()=>{
    const p=parsePODocument(depotTable().slice(0,1));expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='incomplete-extraction')).toBe(true)
  })
  test('a missing numbered source row cannot disappear silently',()=>{
    const input=depotTable();input[0].tokens=input[0].tokens.filter(t=>!(t.y===438))
    const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='incomplete-extraction')).toBe(true)
  })
  test('an orphan item-like fragment without a row number cannot merge into previous row',()=>{
    const input=pricedIndent();input[0].tokens=input[0].tokens.filter(t=>!(t.text==='2' && t.x===22))
    const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='incomplete-extraction')).toBe(true)
  })
})

test('photo structural evidence survives a degraded quantity heading and slanted columns',()=>{
 const input=photoGrid();input[0].tokens.find(t=>t.text==='QTY. ORDER')!.text='TY. ORDE'
 for(const t of input[0].tokens) t.y-=.024*(t.x-110)
 const p=parsePODocument(input);expect(p.layout).toBe('photo-grid');expect(p.complete).toBe(true);expect(p.rows).toHaveLength(3)
 expect(p.rows[0].quantity.value).toBe('1000');expect(p.rows[0].unitPrice.value).toBe('4000');expect(p.rows[0].name.value).toBe('LANTERN PLINT 8X40 BLUE');expect(p.printedTotal.value).toBe('16000000')
})
test('depot combined supplier/address token retains evidence without assigning address to supplier name',()=>{
 const input=depotTable();input[0].tokens.find(t=>t.text==='GLASS PINE SUPPLY')!.text='GLASS PINE SUPPLY  KP. TEST INDUSTRIAL ROAD RT 01'
 const p=parsePODocument(input);expect(p.supplier.raw).toContain('KP. TEST INDUSTRIAL ROAD');expect(p.supplier.value).toBe('GLASS PINE SUPPLY')
})
test('small OCR baseline differences cannot copy a price into adjacent source rows',()=>{
 const input=photoGrid();input[0].tokens.find(t=>t.text==='7.000' && t.y===480)!.y-=6
 const p=parsePODocument(input);expect(p.complete).toBe(true);expect(p.rows.map(r=>r.unitPrice.value)).toEqual(['4000','5000','7000'])
})
test('supplier header fragments with modest baseline variation stay together',()=>{
 const input=photoGrid();input[0].tokens.push(token('(TILES AND WALL)',720,173,85,18,98))
 expect(parsePODocument(input).supplier.value).toBe('GLASS PINE SUPPLY (TILES AND WALL)')
})
test('depot quantity and purchase-price units remain visible when they disagree',()=>{
 const input=depotTable();input[0].tokens.find(t=>t.text==='PC' && t.x===438 && t.y===360)!.text='BOX'
 const p=parsePODocument(input);expect(p.rows[0].uom.value).toBe('PC');expect(p.rows[0].issues.some(i=>i.code==='unit-mismatch')).toBe(true);expect(p.rows[0].quantity.value).toBe('20')
})
test('quantity order versus total quantity disagreement needs review without conversion',()=>{
 const input=photoGrid();input[0].tokens.find(t=>t.text==='1.000,0' && t.x===1050 && t.y===350)!.text='2.000,0'
 const row=parsePODocument(input).rows[0];expect(row.quantity.value).toBe('1000');expect(row.issues.some(i=>i.code==='quantity-mismatch')).toBe(true)
})
test('tax labels alone cannot decide gross versus net price basis',()=>{
 const input=pricedIndent();input[0].tokens.find(t=>t.text==='Jumlah Bersih : 1,300,000')!.text='Jumlah Bersih : 1,443,000'
 expect(parsePODocument(input).priceBasis).toBe('unknown')
})
test('multiple explicit PO headers on one page require separate import',()=>{
 const input=pricedIndent();input[0].tokens.push(token('No. PO : POZ1.2803.00422',434,70,137,18))
 const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='multiple-po')).toBe(true)
})
test('a date with an unrecognized month name stays unknown',()=>{
 const input=pricedIndent();input[0].tokens.find(t=>t.text==='Tanggal : 07 Mar 2028')!.text='Tanggal : 07 Marching 2028'
 const p=parsePODocument(input);expect(p.orderDate.value).toBeNull();expect(p.orderDate.raw).toBe('07 Marching 2028')
})
test('explicit foreign currency in a price column header cannot become implicit IDR',()=>{
 const input=pricedIndent();input[0].tokens.find(t=>t.text==='Harga')!.text='Harga (USD)'
 const p=parsePODocument(input);expect(p.currency.value).toBe('USD');expect(p.currency.raw).toContain('Harga (USD)');expect(p.issues.some(i=>i.code==='foreign-currency' && i.blocking)).toBe(true)
})
test('photo textual description continuation is retained in raw evidence and normalized name',()=>{
 const input=photoGrid();input[0].tokens.push(token('WRAPPED DESCRIPTION TAIL',590,350,350,18,98))
 const p=parsePODocument(input);expect(p.rows[0].name.raw).toContain('WRAPPED DESCRIPTION TAIL');expect(p.rows[0].name.value).toBe('LANTERN PLINT 8X40 BLUE WRAPPED DESCRIPTION TAIL')
})
test('photo mixed-token description continuation retains its numeric model fragment',()=>{
 const input=photoGrid();input[0].tokens.push(token('MODEL',590,350,60,18,98),token('900',670,350,30,18,98),token('WHITE',730,350,60,18,98))
 const p=parsePODocument(input);expect(p.complete).toBe(true);expect(p.rows[0].name.raw).toContain('MODEL 900 WHITE');expect(p.rows[0].name.value).toBe('LANTERN PLINT 8X40 BLUE MODEL 900 WHITE')
})
test('photo indented description continuation stays inside its attributable source row',()=>{
 const input=photoGrid();input[0].tokens.push(token('WRAPPED DESCRIPTION TAIL',710,350,350,18,98))
 const p=parsePODocument(input);expect(p.complete).toBe(true);expect(p.rows[0].name.raw).toContain('WRAPPED DESCRIPTION TAIL');expect(p.rows[0].name.value).toBe('LANTERN PLINT 8X40 BLUE WRAPPED DESCRIPTION TAIL')
})
test('unclassifiable numeric-only photo continuation retains raw evidence and blocks completeness',()=>{
 const input=photoGrid();input[0].tokens.push(token('900',710,350,30,18,98))
 const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.rows[0].name.raw).toContain('900');expect(p.issues.some(i=>i.code==='incomplete-extraction' && i.blocking)).toBe(true)
})
test('recognized stacked summary cells retain OCR evidence without becoming the product description',()=>{
 const input=photoGrid();input[0].tokens=input[0].tokens.filter(t=>!(t.text==='- - - - 1' && t.y===350))
 input[0].tokens.push(token('-',645,350,8,18,80),token('=',740,350,8,18,20),token(':',834,350,8,18,15),token('xl',927,350,65,18,10))
 const p=parsePODocument(input);expect(p.complete).toBe(true);expect(p.rows[0].name.value).toBe('LANTERN PLINT 8X40 BLUE');expect(p.rows[0].issues.some(i=>i.code==='stacked-summary-evidence' && i.message.includes('xl') && i.message.includes('Halaman 1'))).toBe(true)
})
test.each([
 [950,1050,1100,365,'900'],[940,1045,1090,360,'00900'],[970,1080,1120,375,'900'],[950,1050,1100,380,'1.000,0'],
] as const)('textual photo continuation across overlapping columns retains its whole run (%s/%s/%s/%s)',(left,number,right,y,numeral)=>{
 const input=photoGrid();input[0].tokens.push(token('MODEL',left,y,60,18,98),token(numeral,number,y,30,18,98),token('WHITE',right,y,60,18,98))
 const p=parsePODocument(input);expect(p.complete).toBe(true);expect(p.rows[0].name.raw).toContain(`MODEL ${numeral} WHITE`);expect(p.rows[0].name.value).toBe(`LANTERN PLINT 8X40 BLUE MODEL ${numeral} WHITE`)
})
test.each([[1050,365],[1080,375],[1045,380],[1050,350]] as const)('numeric-only continuation in overlapping columns requires integrity fallback (%s/%s)',(x,y)=>{
 const input=photoGrid();input[0].tokens.push(token('900',x,y,30,18,98))
 const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.rows[0].name.raw).toContain('900');expect(p.issues.some(i=>i.code==='incomplete-extraction' && i.blocking)).toBe(true)
})
test('two numeric cells competing in an anchored summary band retain evidence and block attribution',()=>{
 const input=photoGrid();input[0].tokens.push(token('MODEL',950,350,60,18,98),token('900',1050,350,30,18,98),token('WHITE',1100,350,60,18,98))
 const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.rows[0].name.raw).toContain('900');expect(p.issues.some(i=>i.code==='incomplete-extraction' && i.blocking)).toBe(true)
})
test('uncoded unnumbered photo item with remaining quantity and price groups is incomplete',()=>{
 const input=photoGrid();input[0].tokens=input[0].tokens.filter(t=>!((t.text==='3' && t.x===108) || t.text==='000710003' || t.text==='880010003'))
 const p=parsePODocument(input);expect(p.complete).toBe(false);expect(p.issues.some(i=>i.code==='incomplete-extraction' && i.blocking)).toBe(true)
})
test.each([
 ['depot',depotTable,'Transportation Cost : 100.00',360,580,1],
 ['priced',pricedIndent,'(+)Biaya Kirim : 125,000',352,267,0],
 ['photo',photoGrid,'Shipping Fee : 10.000',80,620,0],
] as const)('%s unsupported charge preserves raw label/amount and page evidence',(_label,make,text,x,y,pageIndex)=>{
 const input=make();input[pageIndex].tokens.push(token(text,x,y,210,15,98))
 const p=parsePODocument(input);expect(p.notes).toContain(text);expect(p.notes).toContain(`Halaman ${pageIndex+1}`)
 expect(p.issues.some(i=>i.code==='unsupported-charge' && i.message.includes(text) && i.field.includes(`page-${pageIndex+1}`))).toBe(true)
})
