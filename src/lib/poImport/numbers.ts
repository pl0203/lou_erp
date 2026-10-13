export type NumberConvention = 'comma-decimal' | 'dot-decimal' | 'unknown';
/** Accept a stated convention, never remove punctuation speculatively. */
export function normalizeNumber(raw: string, convention: NumberConvention): string | null {
    const text = raw.trim();
    if (!text || text.length > 128 || !/^[0-9.,]+$/.test(text))
        return null;
    if (convention === 'unknown') {
        if (/^\d+$/.test(text))
            return canonical(text);
        if (text.includes('.') && text.includes(',')) {
            const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? 'dot-decimal' : 'comma-decimal';
            return normalizeNumber(text, decimal);
        }
        const match = /^(\d+)([.,])(\d+)$/.exec(text);
        // Three trailing digits could mean either a fraction or thousands.
        if (!match || match[3].length === 3)
            return null;
        return canonical(`${match[1]}.${match[3]}`);
    }
    const decimal = convention === 'comma-decimal' ? ',' : '.';
    const group = convention === 'comma-decimal' ? '.' : ',';
    const pieces = text.split(decimal);
    if (pieces.length > 2 || (pieces.length === 2 && !/^\d+$/.test(pieces[1])))
        return null;
    const integer = pieces[0];
    const escaped = group === '.' ? '\\.' : ',';
    if (!/^\d+$/.test(integer) && !new RegExp(`^\\d{1,3}(?:${escaped}\\d{3})+$`).test(integer))
        return null;
    return canonical(`${integer.split(group).join('')}${pieces.length === 2 ? `.${pieces[1]}` : ''}`);
}
function canonical(value: string): string {
    const [integer, decimal = ''] = value.split('.');
    const whole = integer.replace(/^0+(?=\d)/, '');
    const fraction = decimal.replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
}
/** Exact cents for comparisons; no floating-point totals or hidden rounding. */
export function decimalCents(value: string | null): bigint | null {
    if (value === null || !/^\d+(?:\.\d{1,2})?$/.test(value) || value.length > 128)
        return null;
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function validISODate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match)
        return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
export function normalizeDate(raw: string): string | null {
    const text = raw.trim();
    if (validISODate(text))
        return text;
    const numeric = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
    const named = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text);
    const months: Record<string, number> = {
        jan: 1, january: 1, januari: 1,
        feb: 2, february: 2, februari: 2,
        mar: 3, march: 3, maret: 3,
        apr: 4, april: 4,
        may: 5, mei: 5,
        jun: 6, june: 6, juni: 6,
        jul: 7, july: 7, juli: 7,
        aug: 8, august: 8, agu: 8, agustus: 8,
        sep: 9, sept: 9, september: 9,
        oct: 10, october: 10, okt: 10, oktober: 10,
        nov: 11, november: 11,
        dec: 12, december: 12, des: 12, desember: 12,
    };
    const month = numeric ? Number(numeric[2]) : named ? months[named[2].toLowerCase()] || 0 : 0;
    const day = numeric?.[1] || named?.[1], year = numeric?.[3] || named?.[3];
    if (!day || !year || !month)
        return null;
    const iso = `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
    return validISODate(iso) ? iso : null;
}
