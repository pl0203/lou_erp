import type { PageText, ParsedPO } from '../contracts';
import { normalizeDate } from '../numbers';
import { nameKey } from '../matching';
import { firstLine, issue, lines, region } from './structural';

type HeaderKey = 'buyer' | 'supplier' | 'poNumber' | 'orderDate' | 'delivery' | 'expiry' | 'paymentTerms' | 'currency';
type Band = [number, number, number, number];
const contextual = /^(?:REMARK|MEMO|NOTE|CATATAN|KETERANGAN|END[\s-]*CUSTOMER|OUR\s*REFERENCE|PRINTOUT\s*DATE|TGL\.?\s*CETAK|DIKIRIM\s*KE)\b/i;
const explicitLabel = /^(?:NO\.?\s*(?:PO|NOTA)|ORDER\s*(?:NO|DATE)|TANGGAL|TGL\.?|KEPADA|SUPPLIER|PAYMENT|TOP\b|JTH\.?|CURRENCY|MATA\s*UANG|EXPIRY|EXPIRES|BERLAKU|PAGE\b|HAL\.)/i;

/** Inspect only the supported header geometry, stopping before a table or source row.
 * A missing continuation header is not evidence of a different document. */
function headerValues(original: PageText, layout: string): Partial<Record<HeaderKey, string[]>> {
    const photo = layout === 'photo-grid', unpriced = layout === 'unpriced-indent', priced = layout === 'priced-indent';
    const table = photo ? /\bBARCODE\b|\bH\.?\s*BRUTO\b/i : unpriced ? /KMSN.*DIORDER/i : priced ? /KUANTITAS.*SATUAN.*HARGA/i : /ITEM\s*DESCRIPTION.*QTY/i;
    const noEnd = photo ? .1 : unpriced ? .09 : priced ? .055 : .08;
    const quantityBand = photo ? [.245, .32] : unpriced ? [.79, .86] : priced ? [.545, .63] : [.46, .525];
    const tableY = lines(original.tokens).find(line => table.test(line.text))?.y ?? Infinity;
    const rowY = Math.min(...original.tokens.filter(t => t.x / original.width < noEnd && /^\d{1,3}\.?$/.test(t.text.trim()) && original.tokens.some(q =>
        q.x / original.width >= quantityBand[0] && q.x / original.width < quantityBand[1] && Math.abs(q.y - t.y) <= Math.max(2, t.height) && /^[\d.,]+$/.test(q.text.trim())
    )).map(t => t.y));
    const end = Math.min(tableY, rowY);
    const page = { ...original, tokens: original.tokens.filter(t => t.y < end) };
    const found: Partial<Record<HeaderKey, string[]>> = {};
    const add = (key: HeaderKey, value: string) => {
        if (!value.trim()) return;
        (found[key] ??= []).push(value.trim());
    };
    const read = (key: HeaderKey, pattern: RegExp, band: Band, nextLine = false) => {
        const ls = lines(region(page, ...band));
        for (const [index, line] of ls.entries()) {
            if (contextual.test(line.text)) continue;
            const match = pattern.exec(line.text);
            if (!match) continue;
            // A field label must start a source token/run, not be embedded in prose.
            let offset = 0;
            const starts = line.tokens.map(token => { const start = offset; offset += token.text.length + 1; return start; });
            if (!starts.includes(match.index)) continue;
            const rest = line.text.slice(match.index + match[0].length).replace(/^\s*:\s*/, '').trim();
            const next = ls[index + 1]?.text || '';
            add(key, rest || (nextLine && !explicitLabel.test(next) && !contextual.test(next) ? next : ''));
        }
    };
    const buyerBand: Band = photo ? [.65, 1, 0, .11] : unpriced ? [0, .45, 0, .05] : priced ? [0, .38, 0, .09] : [0, .4, 0, .10];
    const buyer = firstLine(page, ...buyerBand).raw;
    if (!explicitLabel.test(buyer) && !contextual.test(buyer) && !/^(?:PURCHASE\s*ORDER|ORDER\s*PEMBELIAN|SURAT\s*ORDER)\b/i.test(buyer)) add('buyer', buyer);
    if (photo || unpriced) {
        const left: Band = [0, photo ? .53 : .45, 0, photo ? .23 : .12];
        read('supplier', /^KEPADA\s*:?/i, left);
        read('poNumber', /^NO\.?\s*NOTA\s*:?/i, [0, photo ? .38 : .45, 0, photo ? .23 : .12]);
        const right: Band = [photo ? .52 : .45, photo ? .80 : .85, 0, photo ? .23 : .12];
        read('orderDate', /^TGL\.?\s*NOTA\s*:?/i, right);
        read('delivery', /^TGL\.?\s*KIRIM\s*:?/i, right);
        read('paymentTerms', photo ? /^TOP\s*:?/i : /^JTH\.?\s*TEMPO\s*:?/i, [photo ? .38 : 0, photo ? .53 : .45, 0, photo ? .23 : .12]);
    } else if (priced) {
        read('supplier', /^KEPADA\s*:?/i, [0, .4, 0, .17], true);
        read('poNumber', /^NO\.?\s*PO\s*:?/i, [.68, 1, 0, .10]);
        read('orderDate', /^TANGGAL\s*:?/i, [.68, 1, 0, .10]);
    } else {
        read('supplier', /^SUPPLIER\s*ADDRESS\s*:?/i, [.40, .57, 0, .24], true);
        read('poNumber', /^ORDER\s*NO\s*\/\s*REV\s*:?/i, [.40, .65, 0, .17], true);
        read('paymentTerms', /^PAYMENT\s*TERMS\s*:?/i, [0, .40, 0, .28]);
    }
    // Only explicit labels in the remaining header area qualify. Printout dates and
    // references in remarks/notes, rows and delivery addresses never establish identity.
    read('orderDate', /\b(?:ORDER\s*DATE|TANGGAL\s*PO)\s*:?/i, [0, 1, 0, 1]);
    read('delivery', /\b(?:DELIVERY\s*DATE|REQUESTED\s*DELIVERY|TGL\.?\s*KIRIM)\s*:?/i, [0, 1, 0, 1]);
    read('expiry', /\b(?:EXPIRY(?:\s*DATE)?|EXPIRES|TGL\.?\s*(?:EXPIRED|KADALUARSA)|BERLAKU\s*SAMPAI)\s*:?/i, [0, 1, 0, 1]);
    read('currency', /\b(?:CURRENCY|MATA\s*UANG)\s*:?/i, [0, 1, 0, 1]);
    if (priced) read('paymentTerms', /^PAYMENT\s*TERMS\s*:?/i, [0, .68, 0, 1]);
    return found;
}
function normalized(key: HeaderKey, raw: string, layout: string): string {
    if (['orderDate', 'delivery', 'expiry'].includes(key)) return normalizeDate(raw) || nameKey(raw);
    if (key === 'currency') return /^(?:IDR|RUPIAH|RP)$/i.test(raw.trim()) ? 'idr' : nameKey(raw);
    if (key === 'supplier') {
        raw = raw.replace(/^\s*V[-–]\w+\s*[-–]\s*/i, '');
        if (layout === 'depot-table') raw = raw.split(/\s+(?=(?:KP\.?|JL\.?|JALAN|KAMPUNG|RT|RW|STREET|ROAD)\b)/i)[0];
    }
    return nameKey(raw);
}
/** Repeated titled table sections on one physical page need the same identity guard.
 * An isolated PO reference below a table is not another document header. */
function headerSections(page: PageText, layout: string): PageText[] {
    const band: [number, number] = layout === 'photo-grid' ? [0, .65] : layout === 'unpriced-indent' ? [.7, 1] : [.38, .65];
    const titles = lines(region(page, ...band)).filter(line => /^(?:PURCHASE\s*ORDER|ORDER\s*PEMBELIAN|SURAT\s*ORDER(?:\s*PEMBELIAN)?)$/i.test(line.text));
    const sections = [page];
    for (const title of titles.slice(1)) {
        const offset = title.y - titles[0].y;
        const tokens = page.tokens.filter(token => token.y >= offset).map(token => ({ ...token, y: token.y - offset }));
        if (lines(tokens).some(line => /ITEM\s*DESCRIPTION.*QTY|KUANTITAS.*SATUAN.*HARGA|KMSN.*DIORDER|\bBARCODE\b/i.test(line.text)))
            sections.push({ ...page, tokens });
    }
    return sections;
}
export function reconcileHeaders(parsed: ParsedPO, pages: PageText[]): void {
    const evidence = new Map<HeaderKey, Set<string>>();
    for (const page of pages.flatMap(page => headerSections(page, parsed.layout!))) {
        for (const [key, values] of Object.entries(headerValues(page, parsed.layout!)) as [HeaderKey, string[]][]) {
            const seen = evidence.get(key) || new Set<string>();
            values.forEach(value => seen.add(normalized(key, value, parsed.layout!)));
            evidence.set(key, seen);
        }
    }
    for (const [key, values] of evidence) {
        if (values.size <= 1) continue;
        parsed.complete = false;
        const code = key === 'poNumber' ? 'multiple-po' : 'conflicting-header';
        parsed.issues.push(issue('document', code, key === 'poNumber'
            ? 'Dokumen memuat lebih dari satu PO. Gunakan satu PO per impor.'
            : `Header ${key} yang diulang tidak konsisten. Gunakan satu PO dengan header yang sesuai per impor.`, true, `document:${code}:${key}`));
    }
}
