import type { ParsedPO, SourceField } from './contracts';

/** Seed the editable review once. Apply must use the user's current notes verbatim. */
export function initialReviewNotes(parsed: ParsedPO): string {
    const context: string[] = [];
    const source = (label: string, field: SourceField) => {
        if (field.raw.trim()) context.push(`${label}${field.page === null ? '' : ` (halaman ${field.page})`}: ${field.raw}`);
    };
    source('Pengiriman sumber', parsed.delivery);
    source('Pembayaran sumber', parsed.paymentTerms);
    source('Mata uang sumber', parsed.currency);
    if (!parsed.currency.raw.trim()) context.push('Mata uang sumber: tidak tercantum; perlu konfirmasi IDR tanpa konversi');
    context.push(`Dasar harga sumber: ${parsed.priceBasis === 'gross' ? 'gross (bruto)' : parsed.priceBasis === 'net' ? 'net (neto)' : 'belum dapat dipastikan'}`);
    source('Total tercetak sumber', parsed.printedTotal);
    parsed.rows.forEach((row, index) => source(`Satuan sumber barang ${index + 1}`, row.uom));
    for (const message of new Set(parsed.issues.filter(issue => issue.code === 'tax-review').map(issue => issue.message))) {
        if (!parsed.notes.includes(message)) context.push(`Pajak sumber: ${message}`);
    }
    return [parsed.notes, 'Informasi sumber dokumen (catatan, bukan komponen biaya terstruktur; tanpa konversi):', ...context].filter(Boolean).join('\n');
}
