import type { Customer, Matches, ParsedPO, Product, ProductMatch } from './contracts';

// ERP codes are opaque identifiers. Keep punctuation, leading zeros and internal spaces.
export function skuKey(value: string): string { return value.trim().toLowerCase(); }
export function nameKey(value: string): string { return value.trim().replace(/\s+/g, ' ').toLowerCase(); }
const MAX_SUGGESTIONS = 5;
const MIN_SIMILARITY = 30;
const ignoredWords = new Set(['and', 'dan', 'the', 'with', 'untuk', 'dengan', 'of', 'pcs', 'pc', 'buah', 'unit']);

/** Lexical evidence only, never a model probability or a unit conversion. */
function descriptionTokens(value: string): Set<string> {
    const normalized = value.normalize('NFKC').toLowerCase()
        .replace(/(\d),(?=\d)/g, '$1.')
        .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1x')
        .replace(/(\d)\s+(mm|cm|m|ml|l|kg|g|w|v|inch)\b/g, '$1$2');
    const words: string[] = normalized.match(/[\p{L}\p{N}]+(?:[./-][\p{L}\p{N}]+)*/gu) ?? [];
    return new Set(words.filter(word => !ignoredWords.has(word) && (word.length > 1 || /\d/.test(word))));
}
const hasNumber = (value: string) => /\d/.test(value);
const weight = (value: string) => hasNumber(value) ? 3 : 1;
function compareDescription(source: Set<string>, candidate: Set<string>) {
    const sourceSpecs = [...source].filter(hasNumber), candidateSpecs = [...candidate].filter(hasNumber);
    const sharedName = [...source].some(token => !hasNumber(token) && candidate.has(token));
    // Missing catalogue detail reduces overlap; additional/differing numeric
    // evidence warrants a warning, not an inferred match or unit conversion.
    const conflict = sourceSpecs.length > 0 && candidateSpecs.some(token => !source.has(token));
    const specification: ProductMatch['specification'] = conflict ? 'conflict'
        : sourceSpecs.length > 0 && sourceSpecs.every(token => candidate.has(token)) ? 'match' : null;
    const totalWeight = [...source, ...candidate].reduce((sum, token) => sum + weight(token), 0);
    const commonWeight = [...source].filter(token => candidate.has(token)).reduce((sum, token) => sum + weight(token), 0);
    const score = totalWeight ? Math.round(100 * 2 * commonWeight / totalWeight * (conflict ? 0.4 : 1)) : 0;
    return { score, specification, sharedName };
}
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const compareMatch = (a: ProductMatch, b: ProductMatch) => Number(b.kind === 'exact-sku') - Number(a.kind === 'exact-sku') || b.score - a.score || compareId(a.productId, b.productId);

/** Only current authorized order options are supplied. Suggestions never establish ERP identity. */
export function matchPODraft(parsed: ParsedPO, customers: Customer[], products: Product[]): Matches {
    const buyer = nameKey(parsed.buyer.value || '');
    // Tokenize the catalogue once per review, not once for every source row.
    const catalog = products.map(product => ({ product, sku: skuKey(product.sku), name: nameKey(product.name), tokens: descriptionTokens(`${product.name} ${product.size ?? ''}`) }));
    const productMatchesByRow: Matches['productMatchesByRow'] = {}, exactSkuIdsByRow: Matches['exactSkuIdsByRow'] = {};
    for (const row of parsed.rows) {
        const sku = skuKey(row.sku.value || ''), name = nameKey(row.name.value || '');
        const source = descriptionTokens(row.name.value || '');
        const candidates: ProductMatch[] = [], exactIds: string[] = [];
        for (const item of catalog) {
            const exactSku = !!sku && item.sku === sku, exactName = !!name && item.name === name;
            if (exactSku) exactIds.push(item.product.id);
            const evidence = compareDescription(source, item.tokens);
            if (!exactSku && !exactName && (!evidence.sharedName || evidence.score < MIN_SIMILARITY)) continue;
            candidates.push({ productId: item.product.id, kind: exactSku ? 'exact-sku' : exactName ? 'exact-name' : 'similarity', score: evidence.score, specification: evidence.specification });
        }
        // Keep the complete collision set independently of the bounded display list.
        exactSkuIdsByRow[row.id] = exactIds.sort(compareId);
        productMatchesByRow[row.id] = candidates.sort(compareMatch).slice(0, MAX_SUGGESTIONS);
    }
    return {
        customerIds: buyer ? customers.filter(c => nameKey(c.name) === buyer).map(c => c.id) : [],
        productIdsByRow: Object.fromEntries(Object.entries(productMatchesByRow).map(([id, matches]) => [id, matches.map(match => match.productId)])),
        productMatchesByRow, exactSkuIdsByRow,
    };
}
