import type { Issue, PageText, ParsedPO, ParsedRow, SourceField, Token } from '../contracts';
import { decimalCents, normalizeDate, normalizeNumber } from '../numbers';
import type { NumberConvention } from '../numbers';
export type TextLine = {
    y: number;
    tokens: Token[];
    text: string;
};
export function lines(tokens: Token[]): TextLine[] {
    const result: TextLine[] = [];
    for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
        const line = result.find(l => Math.abs(l.y - token.y) <= Math.max(1.5, Math.min(token.height, ...l.tokens.map(t => t.height)) * .5));
        if (line)
            line.tokens.push(token);
        else
            result.push({ y: token.y, tokens: [token], text: '' });
    }
    return result.map(l => ({ ...l, tokens: l.tokens.sort((a, b) => a.x - b.x), text: l.tokens.map(t => t.text).join(' ').trim() }));
}
export function region(page: PageText, x1 = 0, x2 = 1, y1 = 0, y2 = 1): Token[] {
    return page.tokens.filter(t => t.x >= x1 * page.width && t.x < x2 * page.width && t.y >= y1 * page.height && t.y < y2 * page.height);
}
export function textOf(tokens: Token[]): string { return lines(tokens).map(l => l.text).join('\n').trim(); }
export function field(raw = '', value: string | null = raw.trim() || null, page: number | null = null): SourceField { return { raw, value, page }; }
export function issue(fieldName: string, code: string, message: string, blocking = false, id = `${fieldName}:${code}`): Issue { return { id, field: fieldName, code, message, blocking }; }
export function emptyPO(layout: string | null): ParsedPO {
    return { version: 1, layout, complete: true, buyer: field(), supplier: field(), poNumber: field(), orderDate: field(), expiry: field(), delivery: field(), paymentTerms: field(), currency: field(), printedTotal: field(), priceBasis: 'unknown', notes: '', rows: [], issues: [] };
}
export function labeled(page: PageText, pattern: RegExp, x1 = 0, x2 = 1, y1 = 0, y2 = 1, nextLine = false): SourceField {
    const ls = lines(region(page, x1, x2, y1, y2));
    for (let i = 0; i < ls.length; i++) {
        const match = pattern.exec(ls[i].text);
        if (!match)
            continue;
        const rest = ls[i].text.slice(match.index + match[0].length).replace(/^\s*:\s*/, '').trim();
        return field(rest || (nextLine ? ls[i + 1]?.text || '' : ''), undefined, page.page);
    }
    return field();
}
export function dated(source: SourceField): SourceField { return { ...source, value: normalizeDate(source.raw) }; }
export function firstLine(page: PageText, x1: number, x2: number, y1: number, y2: number): SourceField {
    return field(lines(region(page, x1, x2, y1, y2))[0]?.text || '', undefined, page.page);
}
export function vendor(source: SourceField): SourceField {
    return { ...source, value: source.raw.replace(/^\s*V[-–]\w+\s*[-–]\s*/i, '').trim() || null };
}
export function numeric(source: SourceField, convention: NumberConvention): SourceField { return { ...source, value: normalizeNumber(source.raw, convention) }; }
export function headerFields(p: ParsedPO, page: PageText, pages: PageText[] = [page]): void {
    p.expiry = dated(labeled(page, /(?:EXPIRY(?: DATE)?|EXPIRES|TGL\.?\s*(?:EXPIRED|KADALUARSA)|BERLAKU SAMPAI)\s*:?/i));
    const curr = labeled(page, /(?:CURRENCY|MATA UANG)\s*:?/i);
    const explicit = curr.raw.match(/^(IDR|USD|EUR|SGD|AUD|MYR|GBP|JPY|CNY|RUPIAH|RP)\b/i);
    p.currency = { ...curr, value: explicit ? /^(RUPIAH|RP)$/i.test(explicit[1]) ? 'IDR' : explicit[1].toUpperCase() : curr.raw ? curr.raw.toUpperCase() : null };
    // Currency can be printed in a price/total column heading rather than a dedicated field.
    const monetaryEvidence = pages.flatMap(pg => lines(pg.tokens)
        .filter(line => /\b(?:CURRENCY|HARGA|PRICE|AMOUNT|TOTAL|NILAI|RUPIAH|FEE|CHARGE|SHIPPING|FREIGHT|BIAYA|ONGKOS|COST)\b|MATA\s*UANG/i.test(line.text))
        .flatMap(line => {
        const codes = line.text.match(/\b(?:IDR|USD|EUR|SGD|AUD|MYR|GBP|JPY|CNY|HKD|CHF|NZD|INR|THB|KRW|CAD|AED|SAR)\b|[$€£¥]/gi) || [];
        return codes.map(code => ({ raw: line.text, value: code.toUpperCase(), page: pg.page }));
    }));
    const foreign = monetaryEvidence.find(evidence => evidence.value !== 'IDR');
    const rupiah = monetaryEvidence.find(evidence => evidence.value === 'IDR');
    if (foreign)
        p.currency = foreign;
    else if (!p.currency.value && rupiah)
        p.currency = rupiah;
    const chargePattern = /(?:TRANSPORTATION\s*COST|(?:BIAYA|ONGKOS)\s*(?:KIRIM|ANGKUT|TRANSPORT|LAIN|ADMIN)|SHIPPING\s*(?:COST|FEE|CHARGE)?|FREIGHT\s*(?:COST|FEE|CHARGE)?|(?:EXTRA|HANDLING|ADMIN(?:ISTRATION)?)\s*(?:FEE|COST|CHARGE)|DISCOUNT|DISKON|POTONGAN)\s*:?/i;
    const convention: NumberConvention = p.layout === 'photo-grid' ? 'comma-decimal' : p.layout === 'unpriced-indent' ? 'unknown' : 'dot-decimal';
    for (const pg of pages) {
        for (const line of lines(pg.tokens)) {
            const match = chargePattern.exec(line.text);
            if (!match)
                continue;
            const rawAmount = line.text.slice(match.index + match[0].length).replace(/^\s*:\s*/, '').trim();
            if (!rawAmount)
                continue;
            const amount = normalizeNumber(rawAmount, convention);
            const provenance = `Halaman ${pg.page}: ${line.text}`;
            p.notes = [p.notes, provenance].filter(Boolean).join('\n');
            if (amount !== '0')
                p.issues.push(issue(`charges.page-${pg.page}`, 'unsupported-charge', `${provenance}. Komponen biaya atau diskon memerlukan peninjauan; harga barang tidak diubah otomatis.`, false, `charges.page-${pg.page}:${match[0].trim().toLowerCase()}:unsupported-charge`));
        }
    }
    if (!p.orderDate.value)
        p.issues.push(issue('orderDate', 'order-date-missing', 'Tanggal pesanan belum terbaca; pilih tanggal setelah memeriksa sumber.'));
    if (p.orderDate.raw && !p.orderDate.value)
        p.issues.push(issue('orderDate', 'invalid-date', 'Tanggal sumber tidak valid.'));
    if (p.expiry.raw && !p.expiry.value)
        p.issues.push(issue('expiry', 'invalid-date', 'Tanggal expiry sumber tidak valid.'));
    if (!p.currency.value)
        p.issues.push(issue('currency', 'currency-unknown', 'Mata uang tidak tertulis; pastikan harga menggunakan IDR.'));
    else if (p.currency.value !== 'IDR')
        p.issues.push(issue('currency', 'foreign-currency', 'Harga mata uang asing tidak dapat dikonversi otomatis.', true));
    for (const [key, value] of Object.entries({ poNumber: p.poNumber, buyer: p.buyer, orderDate: p.orderDate })) {
        if (!value.raw)
            continue;
        const tokens = page.tokens.filter(t => value.raw.includes(t.text) || t.text.includes(value.raw));
        if (tokens.some(t => page.source === 'ocr' && (t.confidence === null || t.confidence < 85)))
            p.issues.push(issue(key, 'low-confidence', 'Teks hasil OCR perlu diperiksa kembali.'));
    }
}
export type TableSpec = {
    header: RegExp;
    footer: RegExp;
    noEnd: number;
    sku: [
        number,
        number
    ];
    name: [
        number,
        number
    ];
    quantity: [
        number,
        number
    ];
    uom: [
        number,
        number
    ];
    price?: [
        number,
        number
    ];
    amount?: [
        number,
        number
    ];
    barcodeOnly?: boolean;
    stacked?: boolean;
    convention: NumberConvention;
    continuation?: boolean;
    nameSingleLine?: boolean;
    alternateQuantity?: [
        number,
        number
    ];
    priceUom?: [
        number,
        number
    ];
};
export function tableRows(p: ParsedPO, pages: PageText[], spec: TableSpec): void {
    let previous = 0;
    for (const [pageIndex, page] of pages.entries()) {
        const ls = lines(page.tokens);
        const header = ls.find(l => spec.header.test(l.text));
        // Only one table section per physical page is consumed below. Repeated
        // sections must fail closed even when their PO identities are identical.
        if (ls.filter(l => spec.header.test(l.text)).length > 1) {
            p.complete = false;
            p.issues.push(issue('document', 'incomplete-extraction', 'Satu halaman memuat beberapa bagian tabel. Gunakan satu bagian tabel per halaman atau masukkan PO secara manual.', true, `document:multiple-table-sections:${page.page}`));
        }
        if (!header && !(spec.continuation && pageIndex > 0)) {
            p.complete = false;
            p.issues.push(issue('document', 'incomplete-extraction', 'Halaman tabel tidak memiliki struktur yang didukung.', true));
            continue;
        }
        const continuationHeader = ls.find(l => /\bPAGE\s*\d+\s*\/\s*\d+/i.test(l.text));
        const start = header ? header.y + Math.max(...header.tokens.map(t => t.height)) * .5 : continuationHeader ? continuationHeader.y + Math.max(...continuationHeader.tokens.map(t => t.height)) : 0;
        const footer = ls.find(l => l.y > start && spec.footer.test(l.text));
        const end = footer?.y || page.height;
        const candidates = page.tokens.filter(t => t.x / page.width < spec.noEnd && t.y > start && t.y < end && /^\d{1,3}\.?$/.test(t.text.trim())).sort((a, b) => a.y - b.y);
        // A repeated word token at the same location must not create a duplicate row anchor.
        const anchors = candidates.filter((t, i) => !i || Math.abs(t.y - candidates[i - 1].y) > Math.max(1, t.height * .4));
        for (const [index, anchor] of anchors.entries()) {
            const number = Number(anchor.text.replace('.', ''));
            if (number !== previous + 1) {
                p.complete = false;
                p.issues.push(issue('document', 'incomplete-extraction', 'Urutan baris sumber tidak lengkap atau berulang.', true, `document:row-sequence:${page.page}:${number}`));
            }
            previous = number;
            const next = anchors[index + 1];
            const bottom = next ? next.y - Math.max(2, next.height * .4) : end;
            const rowTokens = page.tokens.filter(t => t.y >= anchor.y - Math.max(2, anchor.height * .4) && t.y < bottom);
            const cell = (range: [
                number,
                number
            ]) => rowTokens.filter(t => t.x / page.width >= range[0] && t.x / page.width < range[1]);
            const id = `row-${page.page}-${number}`;
            const codes = lines(cell(spec.sku));
            const sku = spec.barcodeOnly ? field() : field(codes[0]?.text || '', undefined, page.page);
            const barcode = spec.barcodeOnly ? field(codes[0]?.text || '', undefined, page.page) : spec.stacked ? field(codes[1]?.text || '', undefined, page.page) : field();
            const qtyTokens = cell(spec.quantity).filter(t => !/^[-_~–—=]+$/.test(t.text.trim()) && !/^[A-Za-z]+$/.test(t.text.trim()));
            const qtyLines = lines(qtyTokens);
            const quantity = numeric(field(textOf(qtyTokens), undefined, page.page), spec.convention);
            const priceTokens = spec.price ? cell(spec.price) : [];
            const priceLines = lines(priceTokens);
            const summaryAnchor = spec.stacked && codes.length === 2 && qtyLines.length === 1 && priceLines.length === 2 ? codes[1] : null;
            const baselineTolerance = Math.max(2, anchor.height * .5);
            const anchoredSummary = summaryAnchor && Math.abs(summaryAnchor.y - qtyLines[0].y) <= baselineTolerance && Math.abs(summaryAnchor.y - priceLines[1].y) <= baselineTolerance ? summaryAnchor : null;
            const allNameTokens = cell(spec.name);
            const nameTokens: Token[] = [], uncertainNameTokens: Token[] = [], summaryTokens: Token[] = [];
            for (const line of lines(allNameTokens)) {
                if (!spec.nameSingleLine || line.y <= anchor.y + anchor.height * .75) {
                    nameTokens.push(...line.tokens);
                    continue;
                }
                // Classify the whole textual run before considering any numeric auxiliary cell.
                const textRun = line.tokens.filter(t => /[A-Za-z]/.test(t.text) && !(t.text.trim().length <= 2 && t.confidence !== null && t.confidence < 85));
                const firstText = Math.min(...textRun.map(t => t.x)), lastText = Math.max(...textRun.map(t => t.x));
                const onSummaryBaseline = anchoredSummary && Math.abs(line.y - anchoredSummary.y) <= baselineTolerance;
                const compoundMarkers = line.tokens.filter(t => /^[-_~–—=:\s\d.,]+$/.test(t.text) && (t.text.match(/[-_~–—=:]/g) || []).length >= 2);
                const isolatedMarkers = line.tokens.filter(t => /^[-_~–—=:]+$/.test(t.text.trim()));
                const hasSummaryMarkers = compoundMarkers.length > 0 || isolatedMarkers.length >= 3;
                const auxiliaryNumbers = line.tokens.filter(t => spec.alternateQuantity && t.x / page.width >= spec.alternateQuantity[0] && t.x / page.width < spec.alternateQuantity[1] && normalizeNumber(t.text, spec.convention) !== null);
                const overlappingText = auxiliaryNumbers.filter(t => textRun.length > 1 && t.x >= firstText && t.x <= lastText);
                const conflictingCells = onSummaryBaseline && hasSummaryMarkers && (auxiliaryNumbers.length > 1 || overlappingText.length > 0);
                // Exclusion requires independent barcode/quantity/net-price anchors, summary markers,
                // one quantity agreeing with the primary cell, and no competing textual attribution.
                const confirmedQuantity = onSummaryBaseline && hasSummaryMarkers && !conflictingCells && auxiliaryNumbers.length === 1 && normalizeNumber(auxiliaryNumbers[0].text, spec.convention) === quantity.value ? auxiliaryNumbers : [];
                const knownSummary = onSummaryBaseline && hasSummaryMarkers ? [...compoundMarkers, ...confirmedQuantity] : [];
                const remaining = line.tokens.filter(t => !knownSummary.includes(t));
                const markers = remaining.filter(t => /^[-_~–—=:]+$/.test(t.text.trim()));
                const shortNoisyCells = remaining.filter(t => !markers.includes(t));
                // Three stacked summary markers plus the total-quantity cell identify the auxiliary subrow.
                // Keep its uncertain OCR glyphs verbatim as evidence rather than assigning them to the name.
                const summaryLine = onSummaryBaseline && markers.length >= 3 && confirmedQuantity.length === 1
                    && shortNoisyCells.every(t => t.text.trim().length <= 2 && t.width / page.width < .06 && t.confidence !== null && t.confidence < 85);
                summaryTokens.push(...(summaryLine ? line.tokens : knownSummary));
                if (summaryLine || !remaining.length)
                    continue;
                // Attribute the whole textual continuation, including numeric fragments and indentation.
                if (remaining.some(t => /[A-Za-z]/.test(t.text)))
                    nameTokens.push(...remaining);
                else
                    uncertainNameTokens.push(...remaining);
                if (conflictingCells)
                    uncertainNameTokens.push(...auxiliaryNumbers);
            }
            const name = field(textOf([...new Set([...nameTokens, ...uncertainNameTokens])]), textOf(nameTokens).replace(/\s+/g, ' ').trim() || null, page.page);
            const unitLines = lines(cell(spec.uom));
            const unitValues = [...new Set(unitLines.map(l => l.text.trim().toUpperCase()).filter(Boolean))];
            const uom = field(textOf(cell(spec.uom)), unitValues.length === 1 ? unitValues[0] : null, page.page);
            const prices = priceLines.map(l => normalizeNumber(l.text, spec.convention));
            const distinct = [...new Set(prices)];
            const unitPrice = field(textOf(priceTokens), priceTokens.length && distinct.length === 1 ? distinct[0] : null, page.page);
            const row: ParsedRow = { id, sku, barcode, name, quantity, unitPrice, uom, issues: [] };
            const rowIssue = (key: string, code: string, message: string, blocking = false) => row.issues.push(issue(`rows.${id}.${key}`, code, message, blocking, `${id}:${code}`));
            if (summaryTokens.length)
                rowIssue('source', 'stacked-summary-evidence', `Halaman ${page.page}, baris ${number}: ${textOf(summaryTokens)}. Sel ringkasan sumber dipertahankan tanpa perubahan harga atau satuan.`);
            if (uncertainNameTokens.length) {
                p.complete = false;
                p.issues.push(issue('document', 'incomplete-extraction', `Halaman ${page.page}, baris ${number}: kelanjutan teks ${textOf(uncertainNameTokens)} tidak dapat dipisahkan dari sel ringkasan dengan aman.`, true, `${id}:incomplete-description`));
            }
            if (sku.value || barcode.value)
                rowIssue(sku.value ? 'sku' : 'barcode', 'source-sku-review', 'Kode barang sumber perlu dicocokkan dengan SKU ERP secara eksplisit.');
            if (!name.value || !quantity.raw || !(sku.value || barcode.value) || !uom.raw) {
                p.complete = false;
                p.issues.push(issue('document', 'incomplete-extraction', 'Ada sel barang wajib yang tidak terbaca.', true, `${id}:incomplete-extraction`));
            }
            if (codes.length > (spec.stacked ? 2 : 1) || lines(qtyTokens).length > 1 || priceLines.length > (spec.stacked ? 2 : 1)) {
                p.complete = false;
                p.issues.push(issue('document', 'incomplete-extraction', 'Ada baris tanpa nomor atau sel yang bergabung; gunakan input manual.', true, `${id}:orphan-row`));
            }
            if (!quantity.value)
                rowIssue('quantity', 'unknown-number', 'Jumlah sumber tidak dapat ditafsirkan; periksa dan isi jumlah.', true);
            else if (!/^\d+$/.test(quantity.value))
                rowIssue('quantity', 'fractional-quantity', 'Jumlah pecahan memerlukan peninjauan; tidak dikonversi otomatis.', true);
            if (!uom.value)
                rowIssue('uom', 'unit-mismatch', 'Satuan sumber tidak konsisten; periksa satuan barang.', true);
            if (spec.priceUom) {
                const other = textOf(cell(spec.priceUom));
                if (other && other.trim().toUpperCase() !== uom.value) {
                    uom.raw = [uom.raw, other].join('\n');
                    rowIssue('uom', 'unit-mismatch', 'Satuan jumlah dan satuan harga berbeda; tidak dikonversi otomatis.', true);
                }
            }
            if (spec.alternateQuantity) {
                const otherRaw = textOf(cell(spec.alternateQuantity));
                const other = normalizeNumber(otherRaw, spec.convention);
                if (otherRaw && other !== quantity.value)
                    rowIssue('quantity', 'quantity-mismatch', 'Kolom jumlah sumber berbeda; pilih jumlah setelah memeriksa satuan, tanpa konversi otomatis.', true);
            }
            if (priceTokens.length && prices.some(v => v === null))
                rowIssue('unitPrice', 'unknown-number', 'Harga sumber tidak dapat ditafsirkan; periksa dan isi harga.');
            if (distinct.length > 1)
                rowIssue('unitPrice', 'ambiguous-price', 'Harga bruto dan netto berbeda; pilih harga secara eksplisit.');
            if (!unitPrice.value)
                rowIssue('unitPrice', 'missing-price', 'Harga belum diisi. Isi harga atau setujui penyelesaian manual sebelum menyimpan.');
            else if (unitPrice.value === '0')
                rowIssue('unitPrice', 'zero-price', 'Harga nol harus dikonfirmasi secara eksplisit.');
            if (page.source === 'ocr' && [...qtyTokens, ...priceTokens, ...nameTokens, ...cell(spec.sku)].some(t => t.confidence === null || t.confidence < 85))
                rowIssue('source', 'low-confidence', 'Teks barang hasil OCR perlu diperiksa.');
            if (spec.amount) {
                const amount = numeric(field(textOf(cell(spec.amount)), undefined, page.page), spec.convention);
                const price = decimalCents(unitPrice.value), total = decimalCents(amount.value);
                if (price !== null && total !== null && quantity.value && /^\d+$/.test(quantity.value) && BigInt(quantity.value) * price !== total)
                    rowIssue('unitPrice', 'line-total-mismatch', `Jumlah baris sumber ${amount.raw} tidak sama dengan ${quantity.raw} × ${unitPrice.raw}; tidak ada penyesuaian otomatis.`);
            }
            p.rows.push(row);
        }
        // Visible item codes above the first anchor indicate lost row numbering.
        const orphan = page.tokens.some(t => t.y > start && t.y < (anchors[0] ? anchors[0].y - Math.max(2, anchors[0].height * .4) : end) && t.x / page.width >= spec.sku[0] && t.x / page.width < spec.sku[1] && /^[A-Z0-9][A-Z0-9.-]{4,}$/i.test(t.text.trim()) && !/^(Code\/UPC|BARCODE)$/i.test(t.text));
        if (orphan) {
            p.complete = false;
            p.issues.push(issue('document', 'incomplete-extraction', 'Ada barang tanpa nomor baris yang terbaca.', true, `document:orphan:${page.page}`));
        }
    }
    if (!p.rows.length) {
        p.complete = false;
        p.issues.push(issue('document', 'incomplete-extraction', 'Tidak ada baris barang lengkap yang dapat dibaca.', true));
    }
}
export function totals(p: ParsedPO): void {
    const total = decimalCents(p.printedTotal.value);
    const cents = p.rows.map(r => { const price = decimalCents(r.unitPrice.value); return price !== null && r.quantity.value && /^\d+$/.test(r.quantity.value) ? BigInt(r.quantity.value) * price : null; });
    if (total !== null && cents.every(v => v !== null) && cents.reduce<bigint>((sum, v) => sum + v!, 0n) !== total)
        p.issues.push(issue('printedTotal', 'total-mismatch', 'Total sumber tidak sama dengan total baris. Periksa diskon, pajak, dan biaya; tidak dihitung ulang otomatis.'));
}
