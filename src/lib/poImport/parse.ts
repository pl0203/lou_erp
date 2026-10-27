import type { PageText, ParsedPO } from './contracts';
import { parsePhotoGrid } from './layouts/photoGrid';
import { parseUnpricedIndent } from './layouts/unpricedIndent';
import { parsePricedIndent } from './layouts/pricedIndent';
import { parseDepotTable } from './layouts/depotTable';
import { emptyPO, issue, textOf } from './layouts/structural';
import { reconcileHeaders } from './layouts/headers';
export function parsePODocument(pages: PageText[]): ParsedPO {
    const unsupported = () => { const p = emptyPO(null); p.complete = false; p.issues.push(issue('document', 'unsupported-layout', 'Format PO tidak dikenali. Gunakan input manual.', true)); return p; };
    if (!pages.length)
        return unsupported();
    if (pages.length > 5) {
        const p = unsupported();
        p.issues.push(issue('document', 'page-limit', 'Maksimal lima halaman; dokumen tidak dipotong.', true));
        return p;
    }
    if (pages.some(p => !Number.isFinite(p.width) || !Number.isFinite(p.height) || p.width <= 0 || p.height <= 0 || p.tokens.some(t => !Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.width) || !Number.isFinite(t.height) || t.width < 0 || t.height < 0)))
        return unsupported();
    const text = textOf(pages[0].tokens).replace(/\s+/g, ' ');
    let parse: ((pages: PageText[]) => ParsedPO) | undefined;
    if (/SKU/i.test(text) && /BARCODE/i.test(text) && /ORDER\s*PEMBELIAN/i.test(text) && /NAMA\s*PRODUK/i.test(text) && /BRUTO/i.test(text) && /NETTO/i.test(text))
        parse = parsePhotoGrid;
    else if (/BARCODE/i.test(text) && /KMSN/i.test(text) && /DIORDER/i.test(text) && /SAT\.?\s*K/i.test(text))
        parse = parseUnpricedIndent;
    else if (/NO\.?\s*PO/i.test(text) && /KODE/i.test(text) && /KUANTITAS/i.test(text) && /SATUAN/i.test(text) && /HARGA/i.test(text))
        parse = parsePricedIndent;
    else if (/PURCHASE\s*ORDER/i.test(text) && /ITEM\s*DESCRIPTION/i.test(text) && /PURCHASE\s*PRICE/i.test(text) && /ORDER\s*NO\s*\/\s*REV/i.test(text))
        parse = parseDepotTable;
    if (!parse)
        return unsupported();
    const p = parse(pages);
    reconcileHeaders(p, pages);
    for (const pg of pages) {
        const marker = textOf(pg.tokens).match(/(?:HAL\.?|PAGE)\s*(\d+)\s*\/\s*(\d+)/i);
        if (marker && (Number(marker[2]) !== pages.length || Number(marker[1]) !== pg.page)) {
            p.complete = false;
            p.issues.push(issue('document', 'incomplete-extraction', 'Jumlah atau urutan halaman sumber tidak lengkap.', true, `document:page-sequence:${pg.page}`));
        }
    }
    if (p.rows.length > 100) {
        p.complete = false;
        p.issues.push(issue('document', 'row-limit', 'Maksimal 100 baris sumber; baris tidak dipotong.', true));
    }
    if (!p.poNumber.value || !p.buyer.value) {
        p.complete = false;
        p.issues.push(issue('document', 'incomplete-extraction', 'Header pembeli atau nomor PO tidak terbaca lengkap.', true));
    }
    return p;
}
