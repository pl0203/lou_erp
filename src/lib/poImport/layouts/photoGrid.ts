import type { PageText, ParsedPO } from '../contracts';
import { dated, emptyPO, firstLine, headerFields, labeled, numeric, tableRows, textOf, region, totals, vendor, issue } from './structural';
export function parsePhotoGrid(pages: PageText[]): ParsedPO {
    const p = emptyPO('photo-grid');
    const original = pages[0];
    const left = original.tokens.filter(t => t.x / original.width < .1 && t.y / original.height > .28 && t.y / original.height < .54 && /^\d{1,3}$/.test(t.text)).sort((a, b) => a.y - b.y);
    const prices = original.tokens.filter(t => t.x / original.width > .76 && t.x / original.width < .87 && t.y / original.height > .25 && t.y / original.height < .54 && /^[\d.,]+$/.test(t.text.trim())).sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));
    const slopes = prices.length === left.length * 2 ? left.map((anchor, i) => ((prices[i * 2].y + prices[i * 2].height / 2) - (anchor.y + anchor.height / 2)) / (prices[i * 2].x - anchor.x)).sort((a, b) => a - b) : [];
    const slope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
    const heights = original.tokens.map(t => t.height).filter(h => h > 8 && h < 40).sort((a, b) => a - b);
    const height = heights[Math.floor(heights.length / 2)] || 18;
    // At most ~3.4 degrees, measured from independent numbered rows and paired price cells. Text is never rewritten.
    if (Math.abs(slope) > .06) {
        p.complete = false;
        p.issues.push(issue('document', 'incomplete-extraction', 'Kemiringan tabel terlalu besar untuk penggabungan baris yang aman.', true));
    }
    const page: PageText = { ...original, tokens: original.tokens.map(t => ({ ...t, y: t.y + t.height / 2 - (Math.abs(slope) <= .06 ? slope : 0) * (t.x - original.width * .07) - height / 2, height })) };
    const aligned = [page, ...pages.slice(1)];
    p.buyer = firstLine(page, .65, 1, 0, .11);
    p.supplier = vendor(labeled(page, /KEPADA\s*:?/i, 0, .53, 0, .23));
    p.poNumber = labeled(page, /NO\.?\s*NOTA\s*:?/i, 0, .38, 0, .23);
    p.orderDate = dated(labeled(page, /TGL\.?\s*NOTA\s*:?/i, .52, .80, 0, .23));
    p.delivery = dated(labeled(page, /TGL\.?\s*KIRIM\s*:?/i, .52, .80, 0, .23));
    p.paymentTerms = labeled(page, /TOP\s*:?/i, .38, .53, 0, .23);
    p.printedTotal = numeric(labeled(page, /GRAND\s*TOTAL\s*:?/i, .60, 1), 'comma-decimal');
    p.notes = textOf(region(page, 0, .65, .54, .65));
    tableRows(p, aligned, { header: /BARCODE/i, footer: /MEMO\s*:|GRAND\s*TOTAL/i, noEnd: .1, sku: [.1, .245], name: [.38, .75], quantity: [.245, .32], uom: [.32, .38], price: [.76, .87], amount: [.87, 1], stacked: true, nameSingleLine: true, alternateQuantity: [.68, .75], convention: 'comma-decimal' });
    headerFields(p, page, pages);
    if (original.source === 'ocr' && /^[O0]\d?\//i.test(p.poNumber.value || ''))
        p.issues.push(issue('poNumber', 'ambiguous-identifier', 'Periksa karakter O/0 pada nomor PO; teks OCR tidak dikoreksi otomatis.'));
    totals(p);
    return p;
}
