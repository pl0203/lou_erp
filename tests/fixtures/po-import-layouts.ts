import type { PageText, Token } from '../../src/lib/poImport/contracts'

// Synthetic identities, values, and item descriptions. Geometry mirrors the four supported layouts.
export function token(text: string, x: number, y: number, width = Math.max(6, text.length * 4), height = 8, confidence: number|null = null): Token {
  return { text, x, y, width, height, confidence }
}
export function page(tokens: Token[], width = 595, height = 842, number = 1, source: PageText['source'] = 'pdf-text'): PageText {
  return { page: number, width, height, source, tokens }
}
export function photoGrid(): PageText[] {
  const t: Token[] = [
    token('ORDER PEMBELIAN', 80, 70, 360, 20, 98), token('PT. LANTERN MATERIALS', 1020, 50, 400, 20, 98),
    token('NO. NOTA : O1/LT01-28010401', 80, 130, 360, 18, 96), token('TOP : 40 Hari', 600, 130, 180, 18, 98),
    token('KEPADA : V-00999 - GLASS PINE SUPPLY', 80, 165, 620, 18, 98),
    token('TGL. NOTA : 12-01-2028', 815, 95, 300, 18, 98), token('TGL. KIRIM : 15-01-2028', 815, 130, 310, 18, 98),
    token('Hal. 1 / 1', 1350, 185, 120, 18, 98),
    token('NO', 100, 260, 45, 18, 98), token('SKU', 240, 240, 70, 18, 98), token('BARCODE', 210, 270, 140, 18, 98),
    token('QTY. ORDER', 400, 260, 160, 18, 98), token('NAMA PRODUK', 760, 240, 250, 18, 98),
    token('DISC-1 DISC-2 DISC-3 PPN ISI TTL QTY', 590, 270, 560, 18, 98),
    token('H. BRUTO', 1190, 230, 150, 18, 98), token('H.NETTO-K', 1190, 265, 150, 18, 98), token('JUMLAH', 1360, 260, 130, 18, 98),
  ]
  for (let i = 0; i < 3; i++) {
    const y = 320 + i * 80
    t.push(token(String(i + 1), 108, y, 20, 18, 98), token(`00071000${i + 1}`, 165, y, 200, 18, 98), token(`88001000${i + 1}`, 165, y + 30, 180, 18, 98),
      token('-', 430, y, 15, 18, 98), token('PCS', 500, y, 55, 18, 98), token('1.000,0', 385, y + 30, 110, 18, 98), token('PCS', 500, y + 30, 55, 18, 98),
      token(['LANTERN PLINT 8X40 BLUE', 'LANTERN PLINT 8X40 WHITE', 'LANTERN STEP 8X40 GREEN'][i], 590, y, 550, 18, 98),
      token('- - - - 1', 625, y + 30, 350, 18, 98), token('1.000,0', 1050, y + 30, 100, 18, 98),
      token(['4.000','5.000','7.000'][i], 1210, y, 105, 18, 98), token(['4.000','5.000','7.000'][i], 1210, y + 30, 105, 18, 98),
      token(['4.000.000','5.000.000','7.000.000'][i], 1360, y, 140, 18, 98))
  }
  t.push(token('MEMO : CHECK PACKAGING BEFORE DELIVERY', 80, 575, 790, 18, 98), token('GRAND TOTAL : 16.000.000', 1060, 575, 430, 18, 98), token('TGL. CETAK : OPERATOR - 13-01-2028 (10:10:10)', 950, 780, 540, 18, 98))
  return [page(t, 1536, 1017, 1, 'ocr')]
}
export function unpricedIndent(): PageText[] {
  const t: Token[] = [
    token('LANTERN BUILDING',31,32,100,2), token('ORDER PEMBELIAN',479,33,99,2),
    token('NO. NOTA',31,54,34,2),token(':',79,54,3,2), token('O1/LB1-28020105',85,54,66,2),
    token('KEPADA',31,66,28,2),token(': V-00888 - GLASS PINE SUPPLY',79,66,130,2),
    token('TGL. NOTA : 03-02-2028',307,42,105,2),token('TGL. KIRIM : 09-02-2028',307,54,105,2),
    token('JTH. TEMPO 50 Hari',85,78,90,2),token('Hal. 1 / 1',546,66,32,2),
    token('NO.',34,96,13,2),token('BARCODE',81,96,33,2),token('NAMA BARANG',216,96,52,2),
    token('KMSN',351,96,20,2),token('DIORDER',408,96,32,2),token('JUMLAH',480,96,28,2),token('SAT.K',540,96,23,2),
  ]
  for (let i=0;i<3;i++) {
    const y=116+i*20
    t.push(token(`${i+1}.`,42,y,7,2),token(`90002000${i+1}`,74,y,45,2),token(['GLASS WASH BOWL MODEL A','GLASS WASH BOWL MODEL B','GLASS GARDEN STONE'][i],145,y,145,2),
      token('1',360,y,5,2),token('-',412,y,5,2),token('/',422,y,4,2),token(['1','2','50'][i],450,y,15,2),token(['1','2','50'][i],504,y,15,2),token(['UNIT','PCS','SAK'][i],542,y,18,2))
    if (i<2) t.push(token(['BLUE','WHITE'][i],145,y+9,30,2))
  }
  t.push(token('MEMO :',31,174,30,2),token('ORDER FOR DISPLAY STOCK',31,190,150,2),token('TGL. CETAK : OPERATOR - 04-02-2028',429,238,150,2))
  return [page(t,612,792)]
}
export function pricedIndent(): PageText[] {
  const t: Token[] = [
    token('PT. LANTERN RETAIL GROUP',12,10,190,18),token('North Outlet',12,25,80,18),
    token('SURAT ORDER',239,9,105,25),token('PEMBELIAN',248,30,87,25),
    token('No. PO : POZ1.2803.00421',434,10,137,18),token('Tanggal : 07 Mar 2028',456,25,115,18),
    token('Kepada:',12,89,42,18),token('GLASS PINE SUPPLY',12,104,115,18),token('Dikirim Ke:',515,89,55,18),token('NORTH DISPLAY OUTLET',430,115,141,15),
    token('No',17,153,14,16),token('Kode',37,153,24,16),token('Nama Barang',93,153,66,16),token('Kuantitas',326,153,46,16),token('Satuan',376,153,35,16),token('Harga',421,153,29,16),token('Disk (%)',459,153,41,16),token('Pot.',505,153,19,16),token('Jumlah',539,153,37,16),
    token('1',22,168,4,14),token('5002200111',37,168,46,14),token('GLASS 20X60 STEP BLUE',93,168,210,14),token('8',361,168,6,14),token('PCS',376,168,24,14),token('120,000',427,168,26,14),token('0',493,168,5,14),token('960,000',550,168,27,14),
    token('2',22,183,4,14),token('5002200222',37,183,46,14),token('GLASS 10X60 PLINT BLUE',93,183,210,14),token('8',361,183,6,14),token('PCS',376,183,24,14),token('42,500',430,183,23,14),token('0',493,183,5,14),token('340,000',550,183,27,14),
    token('Keterangan',13,197,59,18),token('DISPLAY INDENT FROM NO.PR :',13,224,220,15),token('045678 / POSZ1.280306.00555 ( SEND SOON )',13,236,275,15),
    token('Catatan',13,261,45,20),token('1. Nomor PO harap dicantumkan',13,279,265,15),
    token('Sub Jumlah : 1,300,000',352,219,225,15),token('DPP : 1,171,171.17',352,231,225,15),token('Pajak : 128,828.83',352,243,225,15),token('Jumlah Bersih : 1,300,000',352,279,225,15),
  ]
  return [page(t)]
}
export function depotTable(count = 22): PageText[] {
  const first: Token[] = [
    token('PURCHASE ORDER',246,25,92,18),token('PT. LANTERN DEPOT, Tbk',22,57,165,15),token('Page 1/2',510,58,52,18),
    token('Printout date : 11/04/2028',22,93,145,15),token('Our reference : DISPLAY TEAM',22,115,155,15),
    token('Order no / Rev',263,93,67,15),token('PODEP280411-0042',262,113,91,15),token('Supplier Code',463,93,64,15),token('445566',462,113,31,15),
    token('Supplier Address',263,144,77,15),token('GLASS PINE SUPPLY',262,162,112,15),token('Payment terms : Credit 20 Days',23,209,152,15),token('Currency :',468,209,55,15),
    token('Remark : PRICES INCLUDE PPN. CHECK QTY BEFORE SHIPPING',23,230,546,15),
    token('Line',22,285,19,15),token('No',25,301,13,15),token('Item No',71,293,37,15),token('Item Description',162,293,74,15),token('Qty',278,293,16,15),token('U/M',310,293,19,15),token('Purchase Price',344,293,72,15),token('Pur Price',422,285,40,15),token('Unit',433,301,19,15),token('Disc',474,293,18,15),token('Line',529,285,19,15),token('Amount',520,301,37,15),token('Supp Item',68,323,47,15),token('Code/UPC',67,339,46,15),
  ]
  const second: Token[] = [token('PURCHASE ORDER',246,25,92,18),token('PT. LANTERN DEPOT, Tbk',22,57,165,15),token('Page 2/2',510,58,52,18)]
  for (let i=0;i<count;i++) {
    const dest=i<11 ? first:second; const y=i<11 ? 360+i*39:86+(i-11)*39
    dest.push(token(String(i+1),15,y,8,11),token(`GLS000${String(i+1).padStart(4,'0')}`,52,y,56,11),token(`DISPLAY TRIM MODEL ${i+1}`,132,y,128,11),token('20.00',285,y,17,11),token('PC',316,y,8,11),token('1,200.00',390,y,27,11),token('PC',438,y,8,11),token('0.00',486,y,13,11),token('24,000.00',537,y,38,11))
    if(i===17) dest.push(token('BLUE',132,y+12,20,11))
  }
  const footerY=count<=22?560:86+(count-11)*39
  second.push(token(`Amount ${count*24000}`,419,footerY,152,15),token('VAT 0.00',438,footerY+42,132,15),token(`Order Net Value ${(count*24000).toLocaleString('en-US')}.00`,381,footerY+72,189,15),token('Address : WAREHOUSE DISPLAY ROAD',22,footerY+96,435,15))
  // Huge synthetic row-limit fixtures deliberately use larger pages, never truncating source tokens.
  return [page(first,595,count>22?5000:842,1),page(second,595,count>22?5000:842,2)]
}
