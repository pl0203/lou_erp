import type { PageText, ParsedPO } from '../contracts';
import { dated, emptyPO, firstLine, headerFields, labeled, region, tableRows, textOf, vendor } from './structural';
export function parseUnpricedIndent(pages: PageText[]): ParsedPO {
    const page = pages[0], p = emptyPO('unpriced-indent');
    p.buyer = firstLine(page, 0, .45, 0, .05);
    p.supplier = vendor(labeled(page, /KEPADA\s*:?/i, 0, .45, 0, .12));
    p.poNumber = labeled(page, /NO\.?\s*NOTA\s*:?/i, 0, .45, 0, .12);
    p.orderDate = dated(labeled(page, /TGL\.?\s*NOTA\s*:?/i, .45, .85, 0, .12));
    p.delivery = dated(labeled(page, /TGL\.?\s*KIRIM\s*:?/i, .45, .85, 0, .12));
    p.paymentTerms = labeled(page, /JTH\.?\s*TEMPO\s*:?/i, 0, .45, 0, .12);
    p.notes = textOf(region(page, 0, .65, .21, .25));
    tableRows(p, pages, { header: /KMSN.*DIORDER|DIORDER.*JUMLAH/i, footer: /MEMO\s*:/i, noEnd: .09, sku: [.10, .22], name: [.23, .54], quantity: [.79, .86], uom: [.87, .96], barcodeOnly: true, alternateQuantity: [.72, .765], convention: 'unknown' });
    headerFields(p, page, pages);
    return p;
}
