// @vitest-environment node
import { describe,it,expect,vi } from 'vitest'
import { randomBytes, createHash } from 'node:crypto'
import { extractXlsx } from '../../../src/lib/co/import/xlsx'
import { inspectWorkbook, guardWorkbook, WORKBOOK_LIMITS } from '../../../src/lib/co/import/workbookGuard'
import { zip,parts,header,group,transaction,row,str,num } from './fixtures/xlsx-layout'
const hash='a'.repeat(64), signal=()=>new AbortController().signal
const extract=(p=parts())=>extractXlsx(zip(p),hash,signal())
const rejected=async(p:ReturnType<typeof parts>,code:string)=>expect((await inspectWorkbook(zip(p))).issues.map(i=>i.code)).toContain(code)
describe('bounded XLSX extraction',()=>{
 it('preserves group, padded code, raw precision, returns, and identical rows',async()=>{
  const r=await extract(parts(header+group+transaction(6)+transaction(7)))
  expect(r.sourceRows).toHaveLength(2);expect(new Set(r.sourceRows.map(x=>x.id)).size).toBe(2)
  expect(r.sourceRows[0]).toMatchObject({name:'SYNTHETIC PRODUCT',sourceSku:'00001234',quantity:{raw:'2',decimal:'2'},returned:{raw:'1',decimal:'1'},unitPrice:{raw:'9007199254740993.125',decimal:'9007199254740993.125'},amount:{raw:'18014398509481986.250',decimal:'18014398509481986.250'},transactionDate:'2026-08-29',currency:null})
  expect(r.sourceRows[0].flags).toContain('source_sku_raw:1234');expect(r.periodCandidates).toEqual(['2026-08-01'])
 })
 it('does not treat a merged summary note as repeated unit-price cells',async()=>{
  const p=parts(header+group+transaction(6)+row(8,num('D8','1')+num('E8','2')+num('F8','1')+str('G8','ADA RETUR 1 PCS')+num('K8','10')),'A5:K5,B8:C8,G8:J8')
  const r=await extract(p);expect(r.sourceRows).toHaveLength(1);expect(r.sections[0].printedTotal?.raw).toBe('10')
 })
 it('does not propagate a previous product through a closed group',async()=>{
  const p=parts(header+group+transaction(6)+row(8,num('D8','1')+num('E8','2')+num('F8','1')+num('K8','10'))+transaction(9),'A5:K5,B8:C8,G8:J8')
  expect((await extract(p)).warnings).toContain('manual_review:transaction_outside_group')
 })
 it('keeps two product groups and summaries separate',async()=>{
  const p=parts(header+group+transaction(6)+row(8,num('D8','1')+num('E8','2')+num('F8','1')+num('K8','10'))+row(10,str('A10','Produk: SECOND'))+transaction(11),'A5:K5,B8:C8,G8:J8,A10:K10')
  const r=await extract(p);expect(r.sourceRows.map(x=>x.name)).toEqual(['SYNTHETIC PRODUCT','SECOND']);expect(r.sections).toHaveLength(2);expect(r.sections[0].printedTotal?.raw).toBe('10')
 })
 it('requires confirmation for cached formulas and leaves missing caches unresolved',async()=>{
  const p=parts(header+group+transaction(6).replace('<v>2</v>','<f>1+1</f><v>2</v>')+transaction(7).replace('<v>2</v>','<f>1+1</f>'))
  const r=await extract(p);expect(r.sourceRows[0].quantity.decimal).toBe('2');expect(r.sourceRows[0].flags).toContain('formula_cache_requires_confirmation');expect(r.sourceRows[1].quantity.decimal).toBeNull()
 })
 it('requires ZIP signature and XLSX content type rather than extension',async()=>{
  expect((await inspectWorkbook(new TextEncoder().encode('not xlsx'))).issues[0].code).toBe('zip_signature')
  const p=parts();p[0].text=p[0].text!.replace('spreadsheetml.sheet.main+xml','ms-excel.sheet.macroEnabled.main+xml');await rejected(p,'macro_content')
 })
 it.each(['xl/vbaProject.bin','xl/externalLinks/externalLink1.xml'])('rejects forbidden part %s',async name=>{await rejected([...parts(),{name,text:'x'}],name.includes('vba')?'macro_content':'external_content')})
 it('rejects external relationships',async()=>{const p=parts();p[3].text=p[3].text!.replace('Target="styles.xml"','Target="https://invalid.example/x" TargetMode="External"');await rejected(p,'external_content')})
 it('rejects encrypted CFB and ZIP entries',async()=>{
  expect((await inspectWorkbook(new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))).issues[0].code).toBe('encrypted_or_legacy')
  const p=parts();p[0].flags=1;await rejected(p,'zip_flags')
 })
 it.each(['../a.xml','/a.xml','a\\b.xml','C:a.xml','a/./b.xml','a//b.xml','a%2fb.xml'])('rejects ambiguous path %s',async name=>rejected([...parts(),{name,text:'x'}],'zip_path'))
 it('rejects duplicate names, CRC mismatch and directory disagreement',async()=>{
  await rejected([...parts(),parts()[0]],'zip_duplicate');const p=parts();p[0].crc=0;await rejected(p,'zip_crc')
  const bytes=zip(parts());bytes[30]^=1;expect((await inspectWorkbook(bytes)).issues[0].code).toBe('zip_local_header')
 })
 it('enforces archive count and advertised expanded cap',async()=>{
  await rejected(Array.from({length:2001},(_,i)=>({name:`a${i}.xml`,text:''})),'zip_entry_limit')
  const p=parts();p[0].size=50*1024*1024+1;await rejected(p,'inflated_limit')
 })
 it('rejects forged output length and actual per-entry expansion',async()=>{
  const p=parts();p[0].size=1;await rejected(p,'zip_size')
  await rejected([...parts(),{name:'docProps/bomb.xml',text:'x'.repeat(1024*1024),deflate:true,size:1}],'expansion_limit')
 })
 it('rejects expanded >50 MiB before retain even with falsified metadata',async()=>{
  expect(WORKBOOK_LIMITS.inflatedBytes).toBe(50*1024*1024)
  const p=parts();p.push({name:'docProps/big.xml',text:'x'.repeat(50*1024*1024+1),deflate:true,size:1})
  // The tighter 100:1 cap must reject this bomb before reaching 50 MiB.
  await rejected(p,'expansion_limit')
 })
 it('falls back when native raw deflate is unavailable',async()=>{
  vi.stubGlobal('DecompressionStream',class {constructor(){throw Error('unsupported')}})
  try{const p=parts();p[0].deflate=true;await rejected(p,'raw_deflate_unavailable')}finally{vi.unstubAllGlobals()}
 })
 it.each([['dimension ref="A1:K100"','dimension ref="A1:XFD1048576"'],['mergeCell ref="A5:K5"','mergeCell ref="A5:XFD1048576"'],['row r="6"','row r="10001"']])('rejects structural amplification %s',async(a,b)=>{const p=parts();p[5].text=p[5].text!.replace(a,b);await rejected(p,'structure_limit')})
 it('rejects DTD, malformed XML and oversized shared formula refs',async()=>{
  const p=parts();p[5].text='<!DOCTYPE worksheet [<!ENTITY x "a">]>'+p[5].text;await rejected(p,'xml_unsafe')
  const q=parts();q[5].text=q[5].text!.replace('</sheetData>','');await rejected(q,'xml_malformed')
  const f=parts(header+group+transaction(6).replace('<v>2</v>','<f t="array" ref="A1:XFD1048576">1</f><v>2</v>'));await rejected(f,'structure_limit')
 })
 it('counts aggregate sheets/rows/cells and rejects excessive declarations',async()=>{
  const p=parts();p[2].text=p[2].text!.replace('<sheet name="Sheet" sheetId="1" r:id="rId1"/>',Array.from({length:21},(_,i)=>`<sheet name="S${i}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join(''));await rejected(p,'sheet_limit')
  expect(WORKBOOK_LIMITS.rows).toBe(10000);expect(WORKBOOK_LIMITS.cells).toBe(100000)
 })
 it('canonicalizes only validated exact entry bytes and supports cancellation',async()=>{
  const g=await guardWorkbook(zip(parts()),signal());const again=await guardWorkbook(g.canonicalBytes,signal());expect(again.sheetNames).toEqual(['Sheet']);expect([...again.entries.keys()]).toEqual([...g.entries.keys()]);for(const [k,v]of g.entries)expect(again.entries.get(k)).toEqual(v)
  const abort=new AbortController();abort.abort();await expect(guardWorkbook(zip(parts()),abort.signal)).rejects.toMatchObject({name:'AbortError'})
 })
 it('rejects actual aggregate inflated bytes without trusting advertised sizes',async()=>{
  const seed=randomBytes(16384), chunk=Buffer.concat(Array(64).fill(seed)), p=parts()
  for(let i=0;i<48;i++)p.push({name:`docProps/p${i}.xml`,bytes:chunk,deflate:true})
  p.push({name:'docProps/last.xml',bytes:Buffer.concat([chunk,chunk,chunk]),deflate:true,size:chunk.length})
  const archive=zip(p), view=new DataView(archive.buffer,archive.byteOffset,archive.byteLength)
  let offset=0, declared=0, actual=0, compressedTotal=0
  for(const part of p){
   const compressed=view.getUint32(offset+18,true), size=view.getUint32(offset+22,true)
   const actualSize=part.bytes?.length??Buffer.byteLength(part.text??'')
   expect(actualSize).toBeLessThanOrEqual(compressed*100)
   declared+=size;actual+=actualSize;compressedTotal+=compressed
   offset+=30+view.getUint16(offset+26,true)+compressed
  }
  expect(declared).toBeLessThan(50*1024*1024)
  expect(actual).toBeGreaterThan(50*1024*1024)
  expect(actual).toBeLessThanOrEqual(compressedTotal*100)
  // The actual-output cap must fire: neither metadata nor per-entry/aggregate ratio rejects first.
  expect((await inspectWorkbook(archive)).issues.map(i=>i.code)).toContain('inflated_limit')
 },30000)
 it('bounds total cells/rows across multiple sheets rather than separately',async()=>{
  const p=parts(row(1,num('A1','1')),'');p[2].text=p[2].text!.replace('</sheets>','<sheet name="Other" sheetId="2" r:id="rId9"/></sheets>');p[3].text=p[3].text!.replace('</Relationships>','<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
  const sheetRows=Array.from({length:5001},(_,i)=>row(i+1,num(`A${i+1}`,'1'))).join('')
  p[5]=parts(sheetRows,'')[5];p.push({...p[5],name:'xl/worksheets/sheet2.xml'});await rejected(p,'row_limit')
  const cellRows=Array.from({length:501},(_,i)=>row(i+1,Array.from({length:100},(_,j)=>{let c=j+1,name='';while(c){c--;name=String.fromCharCode(65+c%26)+name;c=Math.floor(c/26)}return num(`${name}${i+1}`,'1')}).join(''))).join('')
  p[5]=parts(cellRows,'')[5];p[6]={...p[5],name:'xl/worksheets/sheet2.xml'};await rejected(p,'cell_limit')
 })
 it('does not misclassify an unidentified transaction as a subtotal',async()=>{
  const p=parts(header+group+transaction(6).replace(str('B6','TEST-001'),'').replace(num('C6','46263','s="1"'),''))
  expect((await extract(p)).warnings).toContain('manual_review:malformed_transaction')
 })
 it('rejects duplicate cell values and unexpected workbook namespaces',async()=>{
  const p=parts(header+group+transaction(6).replace('<v>2</v>','<v>2</v><v>3</v>'));await rejected(p,'xml_duplicate')
  const q=parts();q[5].text=q[5].text!.replace('<sheetData>','<sheetData xmlns="urn:unexpected">');await rejected(q,'xml_namespace')
 })
 it('bounds XML attributes, merge aggregate and style indices',async()=>{
  const p=parts();p[5].text=p[5].text!.replace('<dimension','<dimension evil="'+ 'x'.repeat(65537)+'"');await rejected(p,'xml_text_limit')
  const q=parts();q[4].text=q[4].text!.replace('numFmtId="164"','numFmtId="4294967295"');await rejected(q,'structure_limit')
  const m=parts(header+group+transaction(6),Array(40).fill('A10:CV100').join(','));await rejected(m,'cell_limit')
 })
 it('rejects sparse worksheet indices and aggregate column amplification',async()=>{
  const p=parts();p[2].text=p[2].text!.replace('sheetId="1"','sheetId="4294967294"');await rejected(p,'structure_limit')
  const q=parts();q[5].text=q[5].text!.replace('<sheetData>','<cols>'+Array(21).fill('<col min="1" max="256"/>').join('')+'</cols><sheetData>');await rejected(q,'structure_limit')
  const r=parts();r[3].text=r[3].text!.replace('Id="rId2"','Id="__proto__"');await rejected(r,'xml_unsafe')
 })
 it('rejects all true hidden booleans and ambiguous shared-formula IDs',async()=>{
  const p=parts();p[5].text=p[5].text!.replace('<row r="6">','<row r="6" hidden="true">');await rejected(p,'hidden_content')
  const q=parts(header+group+transaction(6).replace('<v>2</v>','<f t="shared" si="__proto__" ref="E6:E7">1+1</f><v>2</v>'));await rejected(q,'structure_limit')
 })
 it('does not request remote resources or execute external formulas',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch');const p=parts(header+group+transaction(6).replace('<v>2</v>','<f>WEBSERVICE("https://invalid.example/private")</f><v>2</v>'));const r=await extract(p);expect(r.sourceRows[0].quantity.raw).toBe('2');expect(r.sourceRows[0].flags).toContain('formula_cache_requires_confirmation');expect(fetch).not.toHaveBeenCalled()
 })
 it('rejects protection, relationships and conditional-format metadata before ExcelJS model construction',async()=>{
  const module=await import('exceljs/dist/exceljs.min.js'), ExcelJS=module.default??module;const construct=vi.spyOn(ExcelJS,'Workbook')
  try{for(const node of ['<sheetProtection password="bad" spinCount="4294967295"/>','<conditionalFormatting sqref="A1:XFD1048576"/>']){const p=parts();p[5].text=p[5].text!.replace('</worksheet>',node+'</worksheet>');expect((await extract(p)).warnings).toContain('manual_review:unsupported_content')}expect(construct).not.toHaveBeenCalled()}finally{construct.mockRestore()}
 })
 it('preserves original bytes and grouped aggregate totals for a synthetic complete workbook',async()=>{
  const tx=(r:number,sku:string,qty:string,returned:string,price:string,amount:string)=>transaction(r)
   .replace('TEST-001',`SYN-${r}`).replace('1234',sku)
   .replace('<v>2</v>','<v>'+qty+'</v>').replace('<v>1</v>','<v>'+returned+'</v>')
   .replaceAll('9007199254740993.125',price).replace('18014398509481986.250',amount)
  const bytes=zip(parts(header+group+tx(6,'1234','3','1','20','60')
   +row(8,num('D8','1')+num('E8','3')+num('F8','1')+num('K8','60'))
   +row(10,str('A10','Produk: SYNTHETIC SECOND'))+tx(11,'5678','4','0','30','120')
   +row(13,num('D13','1')+num('E13','4')+num('F13','0')+num('K13','120')),
   'A5:K5,B8:C8,G8:J8,A10:K10,B13:C13,G13:J13'))
  const digest=createHash('sha256').update(bytes).digest('hex')
  const r=await extractXlsx(bytes,digest,signal())
  expect(r.sha256).toBe(digest);expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest)
  expect(r.warnings.filter(w=>w.startsWith('manual_review:'))).toEqual([])
  expect(r.sourceRows).toHaveLength(2);expect(r.sections).toHaveLength(2)
  expect(r.sourceRows.reduce((s,x)=>s+BigInt(x.quantity.decimal!),0n)).toBe(7n)
  expect(r.sourceRows.reduce((s,x)=>s+BigInt(x.returned!.decimal!),0n)).toBe(1n)
  expect(r.sourceRows.reduce((s,x)=>s+BigInt(x.amount!.decimal!),0n)).toBe(180n)
  expect(r.customerCandidates).toEqual([])
  expect(r.sourceRows.map(x=>x.sourceSku)).toEqual(['00001234','00005678'])
 })
})

describe('independent review regressions', () => {
 it('I1 rejects reused shared rich text before producing an amplified result', async () => {
  const shared = (ref: string) => `<c r="${ref}" t="s"><v>0</v></c>`
  const transactions = Array.from({length:1000}, (_,i) => {
   const r=i+6
   return row(r, shared(`B${r}`)+num(`C${r}`,'46263','s="1"')+shared(`D${r}`)+num(`E${r}`,'2')+num(`F${r}`,'0')+shared(`G${r}`)+num(`H${r}`,'1')+num(`I${r}`,'0')+num(`J${r}`,'1')+num(`K${r}`,'2'))
  }).join('')
  const p=parts(header+group+transactions)
  p.push({name:'xl/sharedStrings.xml',text:`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>${'X'.repeat(4000)}</t></r></si></sst>`})
  const r=await extract(p)
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:source_text_limit')
  expect(JSON.stringify(r).length).toBeLessThan(1024)
 })
 it('I1 bounds cumulative dereferencing even when every field is individually short', async () => {
  const shared=(ref:string,index:number)=>`<c r="${ref}" t="s"><v>${index}</v></c>`
  const transactions=Array.from({length:1000},(_,i)=>{
   const r=i+6
   return row(r,shared(`B${r}`,0)+num(`C${r}`,'46263','s="1"')+shared(`D${r}`,0)+num(`E${r}`,'2')+num(`F${r}`,'0')+shared(`G${r}`,1)+num(`H${r}`,'1')+num(`I${r}`,'0')+num(`J${r}`,'1')+num(`K${r}`,'2'))
  }).join('')
  const p=parts(header+group+transactions)
  p.push({name:'xl/sharedStrings.xml',text:`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>${'X'.repeat(120)}</t></r></si><si><r><t>${'U'.repeat(30)}</t></r></si></sst>`})
  const r=await extract(p)
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:dereferenced_text_limit')
 })
 it('I1 bounds result growth from a name reused without further cell dereferencing', async () => {
  const longGroup=row(5,str('A5',`Produk: ${'N'.repeat(250)}`))
  const r=await extract(parts(header+longGroup+Array.from({length:1000},(_,i)=>transaction(i+6)).join('')))
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:result_budget')
 })
 it('I2 rejects split text/CDATA before constructing an ExcelJS model', async () => {
  const p=parts(header+group+transaction(6).replace('<v>2</v>','<v>1<![CDATA[2]]>3</v>'))
  const module=await import('exceljs/dist/exceljs.min.js'), ExcelJS=module.default??module
  const construct=vi.spyOn(ExcelJS,'Workbook')
  try {
   const r=await extract(p)
   expect(r.sourceRows).toEqual([])
   expect(r.warnings).toContain('manual_review:xml_unsafe')
   expect(construct).not.toHaveBeenCalled()
  } finally { construct.mockRestore() }
 })
 it.each([num('E7','999')+num('K7','1000'),num('F7','99'),num('D7','1')+num('K7','1000')])('I3 rejects unidentified numeric evidence rather than discarding it', async cells => {
  const r=await extract(parts(header+group+transaction(6)+row(7,cells)))
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:malformed_transaction')
 })
 it.each(['group','period','summary'])('I4 rejects formula-derived %s metadata', async location => {
  const formula=(ref:string,value:string)=>`<c r="${ref}" t="str"><f>"UNPROVEN"</f><v>${value}</v></c>`
  let data=header+group+transaction(6)
  if(location==='group')data=data.replace(str('A5','Produk: SYNTHETIC PRODUCT'),formula('A5','Produk: SYNTHETIC PRODUCT'))
  if(location==='period')data=data.replace(str('A2','Periode : 01-08-2026 s/d 31-08-2026'),formula('A2','Periode : 01-08-2026 s/d 31-08-2026'))
  if(location==='summary')data+=row(8,num('D8','1')+num('E8','2')+num('F8','1')+'<c r="K8"><f>1+1</f><v>2</v></c>')
  const r=await extract(parts(data))
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:structural_formula')
 })
})

it.each([num('E5','999'),str('E5','999')])('does not discard stock evidence hidden under a product-group merge', async evidence => {
 const malformedGroup=row(5,str('A5','Produk: SYNTHETIC PRODUCT')+evidence)
 const r=await extract(parts(header+malformedGroup+transaction(6)))
 expect(r.sourceRows).toEqual([])
 expect(r.warnings).toContain('manual_review:malformed_transaction')
})
it('requires actual subtotal merges before treating unidentified financial values as a summary', async () => {
 const fakeSummary=row(7,num('D7','1')+num('E7','999')+num('F7','0')+num('K7','1000'))
 const r=await extract(parts(header+group+transaction(6)+fakeSummary))
 expect(r.sourceRows).toEqual([])
 expect(r.warnings).toContain('manual_review:malformed_transaction')
})

describe('fix round 2 physical merge evidence', () => {
 it.each(['A5:K5','A5:K5,A7:L7'])('rejects the same unidentified E/K evidence with merge layout %s', async merges => {
  const unidentified=row(7,num('E7','999')+num('K7','1000'))
  const r=await extract(parts(header+group+transaction(6)+unidentified,merges))
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:malformed_transaction')
 })
 it.each([num('H8','999'),str('H8','999')])('rejects meaningful slave evidence in an otherwise supported summary', async evidence => {
  const summary=row(8,num('D8','1')+num('E8','2')+num('F8','1')+evidence+num('K8','10'))
  const r=await extract(parts(header+group+transaction(6)+summary,'A5:K5,B8:C8,G8:J8'))
  expect(r.sourceRows).toEqual([])
  expect(r.warnings).toContain('manual_review:malformed_transaction')
 })
 it('preserves genuinely empty styled slaves in blank rows and summaries', async () => {
  const blank=row(7,'<c r="E7" s="1"/><c r="K7" s="1"/>')
  const summary=row(8,num('D8','1')+num('E8','2')+num('F8','1')+'<c r="H8" s="1"/><c r="J8" s="1"/>'+num('K8','10'))
  const r=await extract(parts(header+group+transaction(6)+blank+summary,'A5:K5,A7:L7,B8:C8,G8:J8'))
  expect(r.sourceRows).toHaveLength(1)
  expect(r.sections[0].printedTotal).toEqual({raw:'10',decimal:'10',convention:'decimal_dot'})
  expect(r.warnings.some(w=>w.startsWith('manual_review:'))).toBe(false)
 })
})

describe('exact integer text in supported numeric columns', () => {
 const withText = (value: string, column = 'I') => {
  const xml = transaction(6).replace(new RegExp(`<c r="${column}6"[^>]*>.*?</c>`), `<c r="${column}6" t="s"><v>0</v></c>`)
  const p = parts(header + group + xml)
  p.push({name:'xl/sharedStrings.xml',text:`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t xml:space="preserve">${value}</t></si></sst>`})
  return p
 }
 it.each([['E','quantity'],['F','returned'],['H','unitPrice'],['I','discount'],['J','netUnitPrice'],['K','amount']] as const)('preserves exact shared-string zero in %s', async (column, field) => {
  const r = await extract(withText('0', column))
  expect(r.sourceRows).toHaveLength(1)
  expect(r.sourceRows[0][field]).toEqual({raw:'0',decimal:'0',convention:'canonical_integer_text'})
  expect(r.sourceRows[0].flags).not.toContain('unresolved_source_number')
 })
 it('preserves large canonical integer text without a Number conversion', async () => {
  const r=await extract(withText('9007199254740993'))
  expect(r.sourceRows[0].discount).toEqual({raw:'9007199254740993',decimal:'9007199254740993',convention:'canonical_integer_text'})
 })
 it.each(['-1','-0','+1','00','01','0.0','1,000','1.000','1e3','12%','',' ',' 0','0 ','0\n','1\n','NaN','Infinity','0x10','１'])('keeps noncanonical text %j unresolved and unchanged', async value => {
  const r=await extract(withText(value))
  expect(r.sourceRows).toHaveLength(1)
  expect(r.sourceRows[0].discount).toEqual({raw:value,decimal:null,convention:null})
  expect(r.sourceRows[0].flags).toContain('unresolved_source_number')
 })
 it('retains confirmation for an exact integer string formula cache', async () => {
  const xml=transaction(6).replace(/<c r="I6"[^>]*>.*?<\/c>/,'<c r="I6" t="str"><f>1-1</f><v>0</v></c>')
  const r=await extract(parts(header+group+xml))
  expect(r.sourceRows[0].discount).toEqual({raw:'0',decimal:'0',convention:'canonical_integer_text'})
  expect(r.sourceRows[0].flags).toContain('formula_cache_requires_confirmation')
 })
 it('accepts an inline string zero but never treats boolean zero as numeric text', async () => {
  const xml=transaction(6).replace(/<c r="I6"[^>]*>.*?<\/c>/,str('I6','0'))
  expect((await extract(parts(header+group+xml))).sourceRows[0].discount).toEqual({raw:'0',decimal:'0',convention:'canonical_integer_text'})
  const boolean=transaction(6).replace(/<c r="I6"[^>]*>.*?<\/c>/,'<c r="I6" t="b"><v>0</v></c>')
  expect((await extract(parts(header+group+boolean))).sourceRows[0].discount).toEqual({raw:'0',decimal:null,convention:null})
 })
})
