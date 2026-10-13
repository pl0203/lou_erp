import type { PageText, ParsedPO } from '../contracts';
import { dated, emptyPO, firstLine, headerFields, issue, labeled, numeric, region, tableRows, textOf, totals, lines } from './structural';
export function parsePricedIndent(pages: PageText[]): ParsedPO {
    const page = pages[0], p = emptyPO('priced-indent');
    p.buyer = firstLine(page, 0, .38, 0, .09);
    p.supplier = labeled(page, /KEPADA\s*:?/i, 0, .4, 0, .17, true);
    p.poNumber = labeled(page, /NO\.?\s*PO\s*:?/i, .68, 1, 0, .10);
    p.orderDate = dated(labeled(page, /TANGGAL\s*:?/i, .68, 1, 0, .10));
    p.printedTotal = numeric(labeled(page, /JUMLAH\s*BERSIH\s*:?/i, .52, 1), 'dot-decimal');
    p.notes = textOf(region(page, 0, .53, .24, .46));
    tableRows(p, pages, { header: /KUANTITAS.*SATUAN.*HARGA/i, footer: /^KETERANGAN\b/i, noEnd: .055, sku: [.055, .15], name: [.15, .545], quantity: [.545, .63], uom: [.63, .70], price: [.70, .765], amount: [.89, 1], convention: 'dot-decimal' });
    const text = textOf(page.tokens);
    if (/DPP|PAJAK|PPN/i.test(text)) {
        p.issues.push(issue('printedTotal', 'tax-review', `Pajak tercetak pada sumber (Halaman ${page.page}): ${lines(page.tokens).filter(line => /\bDPP\b|\bPAJAK\b|\bPPN\b/i.test(line.text)).map(line => line.text).join('; ')}. Harga tidak dikurangi atau ditambah pajak secara otomatis.`));
    }
    headerFields(p, page, pages);
    totals(p);
    if (/DPP|PAJAK|PPN/i.test(text) && p.printedTotal.value !== null && !p.issues.some(i => i.code === 'total-mismatch') && p.rows.every(r => r.unitPrice.value !== null && /^\d+$/.test(r.quantity.value || '')))
        p.priceBasis = 'gross';
    return p;
}
