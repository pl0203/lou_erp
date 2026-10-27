/** Synthetic vector-text PDFs only: no customer data, links, actions or embedded assets. */
export type Cell = [number, string]
export type Line = Cell[]
export function pdf(pages: Line[][]): Uint8Array {
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((lines, i) => {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    const stream = lines.flatMap((cells, row) => cells.map(([x, text]) => `BT /F1 4 Tf 1 0 0 1 ${x} ${800 - row * 12} Tm (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`)).join('\n')
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let source = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const start = source.length
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return new TextEncoder().encode(source)
}
export const bjHeader: Line[] = [
  [[24, 'LAPORAN PENJUALAN'], [341, 'BJ Home Supermarket Bangunan']],
  [[25, 'POS, Tgl: 01/08/26-31/08/26']],
  [[448, 'Printed 05/09/2026']],
  [[27, 'Tanggal'], [86, 'No Transaksi'], [164, 'Produk'], [432, 'Qty'], [487, 'Hrg Sat'], [542, 'Penjualan']],
]
export const bjRow: Line = [[23, '19/07/26'], [50, 'SYN-001'], [142, '00001234'], [183, 'SYNTHETIC PRODUCT'], [439, '2'], [450, 'PCS'], [493, '1,250'], [541, '2,500']]
export const septHeader: Line = [[70, 'tgl'], [105, 'no_trans'], [146, 'kd_pro'], [241, 'nm_pro'], [340, 'qty'], [380, 'harga'], [432, 'diskon'], [497, 'total']]
export const septRow: Line = [[62, '07/09/2026'], [97, 'SYN-002'], [157, '0002'], [174, 'SYNTHETIC PRODUCT'], [341, '2'], [362, 'Rp'], [389, '1.250,00'], [420, 'Rp'], [453, '-'], [469, 'Rp'], [506, '2.500,00']]
