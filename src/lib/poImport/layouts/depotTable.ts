import type { PageText, ParsedPO } from '../contracts';
import { emptyPO, firstLine, headerFields, issue, labeled, numeric, region, tableRows, textOf, totals, lines } from './structural';
export function parseDepotTable(pages: PageText[]): ParsedPO {
    const page = pages[0], p = emptyPO('depot-table');
    p.buyer = firstLine(page, 0, .4, 0, .10);
    p.supplier = labeled(page, /SUPPLIER\s*ADDRESS\s*:?/i, .40, .57, 0, .24, true);
    // Some native text engines return name and adjoining address as one token. Keep the complete source evidence.
    p.supplier.value = p.supplier.raw.split(/\s+(?=(?:KP\.?|JL\.?|JALAN|KAMPUNG|RT|RW|STREET|ROAD)\b)/i)[0].trim() || null;
    p.poNumber = labeled(page, /ORDER\s*NO\s*\/\s*REV\s*:?/i, .40, .65, 0, .17, true);
    p.paymentTerms = labeled(page, /PAYMENT\s*TERMS\s*:?/i, 0, .40, 0, .28);
    p.notes = textOf(region(page, 0, 1, .266, .335));
    const last = pages[pages.length - 1];
    p.printedTotal = numeric(labeled(last, /ORDER\s*NET\s*VALUE\s*:?/i, .55, 1), 'dot-decimal');
    tableRows(p, pages, { header: /ITEM\s*DESCRIPTION.*QTY.*U\/M.*PURCHASE\s*PRICE/i, footer: /^AMOUNT\b|ORDER\s*NET\s*VALUE|TRANSPORTATION\s*COST/i, noEnd: .08, sku: [.08, .21], name: [.21, .46], quantity: [.46, .525], uom: [.525, .57], price: [.57, .71], amount: [.88, 1], priceUom: [.71, .78], convention: 'dot-decimal', continuation: true });
    if (/(?:INCLUD\w*|TERMASUK)\s*PPN|PRICES\s*INCLUDE\s*PPN/i.test(p.notes))
        p.priceBasis = 'gross';
    if (pages.some(pg => /\bVAT\b|\bPPN\b/i.test(textOf(pg.tokens))))
        p.issues.push(issue('printedTotal', 'tax-review', `Pajak dan total tercetak pada sumber: ${pages.flatMap(pg => lines(pg.tokens).filter(line => /\bVAT\b|\bPPN\b/i.test(line.text)).map(line => `Halaman ${pg.page}: ${line.text}`)).join('; ')}. Harga tidak dikurangi atau ditambah pajak secara otomatis.`));
    headerFields(p, page, pages);
    totals(p);
    return p;
}
