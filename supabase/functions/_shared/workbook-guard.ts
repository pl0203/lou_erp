import { SaxesParser } from 'saxes';
/** Accepted expanded bytes, NOT a browser heap ceiling. Model/XML objects add overhead. */
export const WORKBOOK_LIMITS = Object.freeze({ inputBytes: 10 * 1024 * 1024, inflatedBytes: 50 * 1024 * 1024, ratio: 100, entries: 2000, sheets: 20, rows: 10000, cells: 100000, columns: 256, xmlNodes: 500000, text: 65536, depth: 32 });
class WorkbookError extends Error {
    readonly code: string;
    constructor(code: string) { super(code); this.code = code; }
}
const fail: (code: string) => never = (code: string): never => { throw new WorkbookError(code); };
export const workbookErrorCode = (e: unknown) => e instanceof WorkbookError ? e.code : 'invalid_workbook';
const mainNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
type Entry = {
    name: string;
    start: number;
    compressed: number;
    size: number;
    crc: number;
    method: number;
};
export type RawCell = {
    raw: string;
    type: string;
    formula: boolean;
    hasContent: boolean;
    style: number;
};
export type GuardedWorkbook = {
    entries: Map<string, Uint8Array>;
    canonicalBytes: Uint8Array;
    sheetNames: string[];
    sheets: {
        name: string;
        path: string;
    }[];
    cells: Map<string, Map<string, RawCell>>;
};
function crc32(data: Uint8Array): number { let c = 0xffffffff; for (const b of data) {
    c ^= b;
    for (let j = 0; j < 8; j++)
        c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
} return (c ^ 0xffffffff) >>> 0; }
function safePath(name: string) { return /^[A-Za-z0-9_\[\]. /-]+$/.test(name) && !name.startsWith('/') && !name.includes('//') && !name.split('/').some(s => s === '.' || s === '..') && !name.includes(' ') && !name.endsWith('.'); }
function envelope(bytes: Uint8Array): Entry[] {
    if (bytes.length > WORKBOOK_LIMITS.inputBytes)
        fail('byte_limit');
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (n: number) => n >= 0 && n + 2 <= bytes.length ? v.getUint16(n, true) : fail('zip_bounds');
    const u32 = (n: number) => n >= 0 && n + 4 <= bytes.length ? v.getUint32(n, true) : fail('zip_bounds');
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf)
        fail('encrypted_or_legacy');
    if (bytes.length < 22 || u32(0) !== 0x04034b50)
        fail('zip_signature');
    let end = -1;
    for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
        if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) {
            end = p;
            break;
        }
    if (end < 0)
        fail('zip_directory');
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10))
        fail('zip_multidisk');
    const count = u16(end + 10), length = u32(end + 12), offset = u32(end + 16);
    if (count > WORKBOOK_LIMITS.entries)
        fail('zip_entry_limit');
    if (!count || offset + length !== end)
        fail('zip_directory');
    const entries: Entry[] = [], names = new Set<string>();
    let p = offset, declared = 0;
    const extents: {
        start: number;
        end: number;
    }[] = [];
    for (let i = 0; i < count; i++) {
        if (u32(p) !== 0x02014b50)
            fail('zip_directory');
        const flags = u16(p + 8), method = u16(p + 10), crc = u32(p + 16), compressed = u32(p + 20), size = u32(p + 24), n = u16(p + 28), extra = u16(p + 30), comment = u16(p + 32), local = u32(p + 42);
        if (flags & ~0x800)
            fail('zip_flags'); // encrypted, data-descriptor and other unsupported features
        if (method !== 0 && method !== 8)
            fail('zip_method');
        if (u16(p + 34) || extra || u16(p + 6) > 20)
            fail('zip_unsupported'); // no ZIP64/extra-field aliases
        if (p + 46 + n + extra + comment > end || n > 240)
            fail('zip_bounds');
        const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(p + 46, p + 46 + n));
        if (!safePath(name))
            fail('zip_path');
        const key = name.replace(/\/$/, '').toLowerCase();
        if (names.has(key))
            fail('zip_duplicate');
        names.add(key);
        if (/vba|macro|\.bin$/i.test(name))
            fail('macro_content');
        if (/externalLinks|connections|queryTables|embeddings|activeX/i.test(name))
            fail('external_content');
        declared += size;
        if (declared > WORKBOOK_LIMITS.inflatedBytes)
            fail('inflated_limit');
        if (size > compressed * WORKBOOK_LIMITS.ratio)
            fail('expansion_limit');
        if (u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size || u16(local + 26) !== n || u16(local + 28) !== 0)
            fail('zip_local_header');
        const start = local + 30 + n;
        if (start + compressed > offset)
            fail('zip_overlap');
        if (!bytes.subarray(local + 30, start).every((b, j) => b === bytes[p + 46 + j]))
            fail('zip_local_header');
        extents.push({ start: local, end: start + compressed });
        entries.push({ name, start, compressed, size, crc, method });
        p += 46 + n + extra + comment;
    }
    if (p !== end)
        fail('zip_directory');
    let expectedLocal = 0;
    for (const extent of extents.sort((a, b) => a.start - b.start)) {
        if (extent.start !== expectedLocal)
            fail('zip_overlap');
        expectedLocal = extent.end;
    }
    if (expectedLocal !== offset)
        fail('zip_directory');
    return entries;
}
async function expand(bytes: Uint8Array, e: Entry, budget: {
    total: number;
    compressed: number;
}, signal: AbortSignal): Promise<Uint8Array> {
    signal.throwIfAborted();
    const chunks: Uint8Array[] = [];
    let size = 0;
    const accept = (chunk: Uint8Array) => { signal.throwIfAborted(); const next = size + chunk.length, total = budget.total + chunk.length; if (next > e.compressed * WORKBOOK_LIMITS.ratio || total > budget.compressed * WORKBOOK_LIMITS.ratio)
        fail('expansion_limit'); if (total > WORKBOOK_LIMITS.inflatedBytes)
        fail('inflated_limit'); size = next; budget.total = total; chunks.push(chunk); };
    if (e.method === 0)
        accept(bytes.subarray(e.start, e.start + e.compressed));
    else {
        let stream: DecompressionStream;
        try {
            stream = new DecompressionStream('deflate-raw');
        }
        catch {
            fail('raw_deflate_unavailable');
        }
        const writer = stream.writable.getWriter(), reader = stream.readable.getReader();
        let stopped = false;
        const stop = () => { stopped = true; void writer.abort().catch(() => { }); void reader.cancel().catch(() => { }); };
        signal.addEventListener('abort', stop, { once: true });
        // Feed bounded chunks with backpressure while concurrently consuming. Never a whole-output arrayBuffer().
        const feeding = (async () => { try {
            for (let p = e.start; p < e.start + e.compressed; p += 4096) {
                if (stopped)
                    break;
                signal.throwIfAborted();
                await writer.write(bytes.subarray(p, Math.min(p + 4096, e.start + e.compressed)) as Uint8Array<ArrayBuffer>);
            }
            if (!stopped)
                await writer.close();
        }
        catch (error) {
            stop();
            throw error;
        } })();
        void feeding.catch(() => { });
        try {
            while (true) {
                signal.throwIfAborted();
                const next = await reader.read();
                if (next.done)
                    break;
                accept(next.value);
            }
            await feeding;
            signal.throwIfAborted();
        }
        finally {
            stop();
            signal.removeEventListener('abort', stop);
        }
    }
    if (size !== e.size)
        fail('zip_size');
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    if (crc32(out) !== e.crc)
        fail('zip_crc');
    return out;
}
function storedArchive(entries: Map<string, Uint8Array>): Uint8Array {
    // Exactly one bounded allocation; retain every original part's bytes, not a rewritten document.
    const total = [...entries].reduce((n, [name, data]) => n + 76 + 2 * name.length + data.length, 22);
    if (total > WORKBOOK_LIMITS.inflatedBytes + WORKBOOK_LIMITS.entries * 556)
        fail('inflated_limit');
    const out = new Uint8Array(total), v = new DataView(out.buffer), enc = new TextEncoder();
    let p = 0;
    const records: {
        name: Uint8Array;
        data: Uint8Array;
        offset: number;
        crc: number;
    }[] = [];
    for (const [path, data] of entries) {
        const name = enc.encode(path), offset = p, crc = crc32(data);
        v.setUint32(p, 0x04034b50, true);
        v.setUint16(p + 4, 20, true);
        v.setUint32(p + 14, crc, true);
        v.setUint32(p + 18, data.length, true);
        v.setUint32(p + 22, data.length, true);
        v.setUint16(p + 26, name.length, true);
        out.set(name, p + 30);
        out.set(data, p + 30 + name.length);
        p += 30 + name.length + data.length;
        records.push({ name, data, offset, crc });
    }
    const dir = p;
    for (const { name, data, offset, crc } of records) {
        v.setUint32(p, 0x02014b50, true);
        v.setUint16(p + 4, 20, true);
        v.setUint16(p + 6, 20, true);
        v.setUint32(p + 16, crc, true);
        v.setUint32(p + 20, data.length, true);
        v.setUint32(p + 24, data.length, true);
        v.setUint16(p + 28, name.length, true);
        v.setUint32(p + 42, offset, true);
        out.set(name, p + 46);
        p += 46 + name.length;
    }
    v.setUint32(p, 0x06054b50, true);
    v.setUint16(p + 8, records.length, true);
    v.setUint16(p + 10, records.length, true);
    v.setUint32(p + 12, p - dir, true);
    v.setUint32(p + 16, dir, true);
    return out;
}
function coordinate(ref: string): [
    number,
    number
] { const m = /^([A-Z]{1,3})([1-9][0-9]{0,4})$/.exec(ref); if (!m)
    fail('structure_limit'); let col = 0; for (const c of m[1])
    col = col * 26 + c.charCodeAt(0) - 64; const row = Number(m[2]); if (col > WORKBOOK_LIMITS.columns || row > WORKBOOK_LIMITS.rows)
    fail('structure_limit'); return [row, col]; }
function area(ref: string) { const parts = ref.split(':'); if (parts.length > 2)
    fail('structure_limit'); const [r, c] = coordinate(parts[0]), [rr, cc] = coordinate(parts[1] ?? parts[0]); const n = (rr - r + 1) * (cc - c + 1); if (rr < r || cc < c || n > WORKBOOK_LIMITS.cells)
    fail('structure_limit'); return n; }
async function validatePackage(bytes: Uint8Array, signal: AbortSignal): Promise<Omit<GuardedWorkbook, 'canonicalBytes'>> {
    signal.throwIfAborted();
    const records = envelope(bytes), entries = new Map<string, Uint8Array>();
    const budget = { total: 0, compressed: records.reduce((n, e) => n + e.compressed, 0) };
    for (const e of records) {
        const data = await expand(bytes, e, budget, signal);
        entries.set(e.name, data);
    }
    let nodes = 0, rows = 0, cells = 0, merges = 0, dimensions = 0, formulaArea = 0, strings = 0, styles = 0, relations = 0, sheetCount = 0, columnArea = 0, hasContentType = false;
    const sheetIds = new Set<string>();
    const sheets: {
        name: string;
        id: string;
    }[] = [], sheetRels = new Map<string, string>(), rawCells = new Map<string, Map<string, RawCell>>();
    for (const [path, data] of entries) {
        signal.throwIfAborted();
        if (path.endsWith('/')) {
            if (data.length)
                fail('zip_directory');
            continue;
        }
        if (!/^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/[A-Za-z0-9_-]+\.xml|xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/styles\.xml|xl\/theme\/theme[0-9]+\.xml|xl\/worksheets\/sheet[0-9]+\.xml)$/.test(path))
            fail('unsupported_part');
        const sheetIndex = /^xl\/worksheets\/sheet([0-9]+)\.xml$/.exec(path);
        if (sheetIndex && (!/^[1-9][0-9]*$/.test(sheetIndex[1]) || Number(sheetIndex[1]) > 20))
            fail('structure_limit');
        let text: string;
        try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(data);
        }
        catch {
            fail('xml_malformed');
        }
        if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(text))
            fail('xml_unsafe');
        // Bound lexical tokens BEFORE SAX retains attributes/text; conservative for unsupported giant comments/values.
        let last = 0;
        for (let i = 0; i < text.length; i++)
            if (text[i] === '<' || text[i] === '>') {
                if (i - last > WORKBOOK_LIMITS.text)
                    fail('xml_text_limit');
                last = i;
            }
        if (text.length - last > WORKBOOK_LIMITS.text)
            fail('xml_text_limit');
        const parser = new SaxesParser({ xmlns: true }), stack: string[] = [];
        let current: RawCell | null = null, currentRef = '', valueDepth = 0, currentRow = 0, lastRow = 0, lastCol = 0, textLength = 0, root = false, hasValue = false, hasFormula = false;
        const sheet = /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(path), map = new Map<string, RawCell>();
        if (sheet)
            rawCells.set(path, map);
        parser.on('cdata', () => fail('xml_unsafe'));
        parser.on('error', () => fail('xml_malformed'));
        parser.on('doctype', () => fail('xml_unsafe'));
        parser.on('processinginstruction', () => fail('xml_unsafe'));
        parser.on('opentag', tag => {
            signal.throwIfAborted();
            stack.push(tag.local);
            textLength = 0;
            if (++nodes > WORKBOOK_LIMITS.xmlNodes || stack.length > WORKBOOK_LIMITS.depth || Object.keys(tag.attributes).length > 32)
                fail('structure_limit');
            const a = (key: string) => tag.attributes[key]?.value ?? '';
            if (!root) {
                root = true;
                const expected = path === '[Content_Types].xml' ? 'http://schemas.openxmlformats.org/package/2006/content-types' : path.endsWith('.rels') ? relNS : path.startsWith('xl/') && !path.startsWith('xl/theme/') ? mainNS : null;
                if (expected && tag.uri !== expected)
                    fail('xml_namespace');
            }
            const inertExtension = path === 'xl/styles.xml' && tag.uri === 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main' && tag.local === 'slicerStyles' || path === 'xl/workbook.xml' && tag.uri === 'http://schemas.microsoft.com/office/spreadsheetml/2018/calcfeatures' && ['calcFeatures', 'feature'].includes(tag.local);
            if (path.startsWith('xl/') && !path.startsWith('xl/theme/') && !path.endsWith('.rels') && tag.uri !== mainNS && !inertExtension)
                fail('xml_namespace');
            if (tag.uri === mainNS && tag.prefix)
                fail('xml_namespace'); // ExcelJS dispatches unprefixed names; avoid interpretation mismatch.
            if (tag.local === 'Relationship') {
                if (++relations > 2000)
                    fail('structure_limit');
                if (!/^rId[1-9][0-9]{0,5}$/.test(a('Id')))
                    fail('xml_unsafe');
                if (a('TargetMode') || /external|hyperlink|oleObject|vba|connections/i.test(a('Type')) || /^[a-z]+:|^\/\//i.test(a('Target')))
                    fail('external_content');
                const target = a('Target');
                if (!safePath(target) || target.includes('..'))
                    fail('zip_path');
                if (path === 'xl/_rels/workbook.xml.rels') {
                    if (sheetRels.has(a('Id')))
                        fail('xml_duplicate');
                    sheetRels.set(a('Id'), `xl/${target}`);
                }
            }
            if (tag.local === 'Override' || tag.local === 'Default') {
                if (/macroEnabled|vba|ms-excel|externalLink/i.test(a('ContentType')))
                    fail('macro_content');
                if (a('PartName') === '/xl/workbook.xml' && a('ContentType') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')
                    hasContentType = true;
            }
            if (tag.local === 'sheet' && path === 'xl/workbook.xml') {
                if (++sheetCount > 20)
                    fail('sheet_limit');
                if (!/^[1-9][0-9]*$/.test(a('sheetId')) || Number(a('sheetId')) > 20)
                    fail('structure_limit');
                if (sheetIds.has(a('sheetId')))
                    fail('xml_duplicate');
                sheetIds.add(a('sheetId'));
                if (!a('name') || a('state') && a('state') !== 'visible' || sheets.some(s => s.name === a('name') || s.id === a('r:id')))
                    fail('unsupported_sheet');
                sheets.push({ name: a('name'), id: a('r:id') });
            }
            if (tag.local === 'externalReference' || tag.local === 'definedName' || tag.local === 'sheetProtection' || tag.local === 'workbookProtection' || tag.local === 'conditionalFormatting' || tag.local === 'dataValidation' || tag.local === 'tablePart' || tag.local === 'oleObject')
                fail('unsupported_content');
            for (const key of ['numFmtId', 'fontId', 'fillId', 'borderId', 'xfId'])
                if (a(key) && (!/^[0-9]+$/.test(a(key)) || Number(a(key)) > 65535))
                    fail('structure_limit');
            if (tag.local === 'si' && ++strings > 100000 || tag.local === 'xf' && ++styles > 10000)
                fail('structure_limit');
            if (!sheet)
                return;
            if (tag.local === 'dimension') {
                dimensions += area(a('ref'));
                if (dimensions > 100000)
                    fail('structure_limit');
            }
            if (tag.local === 'row') {
                currentRow = Number(a('r'));
                if (!/^[1-9][0-9]*$/.test(a('r')) || currentRow > 10000)
                    fail('structure_limit');
                if (currentRow <= lastRow)
                    fail('xml_duplicate');
                lastRow = currentRow;
                lastCol = 0;
                if (++rows > 10000)
                    fail('row_limit');
                if (['1', 'true'].includes(a('hidden')))
                    fail('hidden_content');
            }
            if (tag.local === 'c') {
                const [r, c] = coordinate(a('r'));
                if (stack.at(-2) !== 'row' || r !== currentRow || c <= lastCol)
                    fail('xml_duplicate');
                lastCol = c;
                if (++cells > 100000 || cells + merges > 100000)
                    fail('cell_limit');
                currentRef = a('r');
                hasValue = false;
                hasFormula = false;
                current = { raw: '', hasContent: false, type: a('t') || 'n', formula: false, style: Number(a('s') || 0) };
                if (!Number.isInteger(current.style) || current.style < 0 || current.style > 10000)
                    fail('structure_limit');
                map.set(currentRef, current);
            }
            if (tag.local === 'v' && current) {
                if (hasValue)
                    fail('xml_duplicate');
                hasValue = true;
                valueDepth = stack.length;
            }
            if (tag.local === 'f' && current) {
                if (hasFormula)
                    fail('xml_duplicate');
                hasFormula = true;
                if (a('si') && (!/^[0-9]+$/.test(a('si')) || Number(a('si')) > 100000))
                    fail('structure_limit');
                current.formula = true;
                if (a('ref')) {
                    formulaArea += area(a('ref'));
                    if (formulaArea > 100000)
                        fail('structure_limit');
                }
            }
            if (tag.local === 'mergeCell') {
                merges += area(a('ref'));
                if (merges + cells > 100000)
                    fail('cell_limit');
            }
            if (tag.local === 'col') {
                const min = Number(a('min')), max = Number(a('max'));
                if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 256)
                    fail('structure_limit');
                columnArea += max - min + 1;
                if (columnArea > 5120)
                    fail('structure_limit');
                if (['1', 'true'].includes(a('hidden')))
                    fail('hidden_content');
            }
        });
        parser.on('text', value => {
            textLength += value.length;
            if (textLength > WORKBOOK_LIMITS.text) fail('xml_text_limit');
            if (current && value.trim() !== '') current.hasContent = true;
            if (valueDepth === stack.length && current) current.raw += value;
        });
        parser.on('closetag', tag => {
            if (tag.local === 'v') valueDepth = 0;
            if (tag.local === 'c') current = null;
            stack.pop();
            textLength = 0;
        });
        try {
            for (let i = 0; i < text.length; i += 4096) {
                signal.throwIfAborted();
                parser.write(text.slice(i, i + 4096));
            }
            parser.close();
        }
        catch (e) {
            if (e instanceof WorkbookError || signal.aborted)
                throw e;
            fail('xml_malformed');
        }
    }
    if (!hasContentType || !sheets.length || !entries.has('_rels/.rels') || !entries.has('xl/_rels/workbook.xml.rels'))
        fail('xlsx_package');
    const resolved = sheets.map(s => { const path = sheetRels.get(s.id); if (!path || !rawCells.has(path))
        fail('xlsx_package'); return { name: s.name, path }; });
    if (new Set(resolved.map(s => s.path)).size !== rawCells.size)
        fail('xlsx_package');
    return { entries, sheetNames: sheets.map(s => s.name), sheets: resolved, cells: rawCells };
}
/** Same validation pipeline; evidence never constructs or substitutes canonical ZIP bytes. */
export async function validateWorkbook(bytes: Uint8Array, signal: AbortSignal = new AbortController().signal): Promise<void> {
    await validatePackage(bytes, signal);
}
export async function guardWorkbook(bytes: Uint8Array, signal: AbortSignal): Promise<GuardedWorkbook> {
    const validated = await validatePackage(bytes, signal);
    return { ...validated, canonicalBytes: storedArchive(validated.entries) };
}

/** Shared exact automatic-header policy. Recognition is not a client warning or capability. */
export const CO_XLSX_HEADERS: Readonly<Record<string, string>> = Object.freeze({
    A: 'No Faktur', C: 'Tgl Jual', D: 'Barcode Alias', E: 'Jumlah', F: 'Retur',
    G: 'Satuan', H: 'H. Satuan', I: 'Diskon', J: 'H. Net', K: 'Sub Total',
});
export type ManualWorkbookFacts = {
    version: 1;
    policy: 'co-manual-xlsx-values-1';
    sheets: { name: string; rows: number[] }[];
};
const MANUAL_TEXT = Object.freeze({ cell: 512, dereferenced: 128 * 1024 });
type ManualNode = { name: string; attrs: Record<string, string>; text: string; children: string[] };
/** Only called on already CRC/namespace/size-validated XML. This second, bounded
 * SAX pass refuses semantics the values-only viewer cannot faithfully interpret. */
function manualXml(data: Uint8Array, signal: AbortSignal, grammar: Record<string, readonly string[]>,
    open: (node: ManualNode, parent?: ManualNode) => void,
    close: (node: ManualNode, parent?: ManualNode) => void) {
    const stack: ManualNode[] = [], parser = new SaxesParser({ xmlns: true });
    parser.on('opentag', tag => {
        signal.throwIfAborted();
        const parent = stack.at(-1);
        if (tag.local === 'f') fail('manual_formula');
        if (!(grammar[parent?.name ?? ''] ?? []).includes(tag.local)) fail('manual_structure');
        const attrs: Record<string, string> = Object.create(null);
        for (const [key, value] of Object.entries(tag.attributes)) {
            if (value.uri === 'http://www.w3.org/2000/xmlns/') continue;
            if (value.prefix && key !== 'xml:space' && key !== 'r:id'
                || key === 'r:id' && value.uri !== 'http://schemas.openxmlformats.org/officeDocument/2006/relationships') fail('manual_structure');
            attrs[key] = value.value;
        }
        const node = { name: tag.local, attrs, text: '', children: [] };
        if (parent) parent.children.push(node.name);
        open(node, parent);
        stack.push(node);
    });
    parser.on('text', value => {
        signal.throwIfAborted();
        const node = stack.at(-1);
        if (!node) { if (value.trim()) fail('manual_structure'); return; }
        if (!['t', 'v', 'oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter'].includes(node.name)) {
            if (value.trim()) fail('manual_structure');
            return;
        }
        if (node.text.length + value.length > MANUAL_TEXT.cell) fail('source_text_limit');
        node.text += value;
    });
    parser.on('closetag', () => { const node = stack.pop()!; close(node, stack.at(-1)); });
    parser.on('error', () => fail('xml_malformed'));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    for (let i = 0; i < text.length; i += 4096) { signal.throwIfAborted(); parser.write(text.slice(i, i + 4096)); }
    parser.close();
    signal.throwIfAborted();
}
function manualIndex(value: string, length: number, code: string) {
    if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) >= length) fail(code);
    return Number(value);
}
const richProperties = ['b', 'i', 'u', 'sz', 'color', 'rFont', 'family', 'charset', 'scheme', 'vertAlign', 'strike', 'outline', 'shadow', 'condense', 'extend'];
const richGrammar: Record<string, readonly string[]> = {
    si: ['t', 'r'], is: ['t', 'r'], r: ['rPr', 't'], rPr: richProperties,
};
/** Decode one bounded string at a time; a shared value is charged again at each physical cell. */
function manualString(node: ManualNode) {
    // A childless shared item is an object in ExcelJS, not explicit empty text.
    if (node.name === 'si' && !node.children.length) fail('manual_structure');
    // ExcelJS applies different escape/double-entity decoding to shared/rich/str
    // values. Refuse this unsupported subset rather than attest changed evidence.
    if (['t', 'v'].includes(node.name) && (/_x[0-9A-Fa-f]{4}_|&(?:lt|gt|amp|apos|quot);/.test(node.text)
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(node.text))) fail('manual_cell_value');
    if (node.name === 'r' && (node.children.filter(n => n === 't').length !== 1 || node.children.filter(n => n === 'rPr').length > 1)
        || ['si', 'is'].includes(node.name) && (node.children.filter(n => n === 't').length > 1 || node.children.includes('t') && node.children.includes('r')))
        fail('manual_structure');
}
function manualStyles(entries: Map<string, Uint8Array>, signal: AbortSignal): number[] {
    const data = entries.get('xl/styles.xml');
    if (!data) return [0]; // XLSX's implicit General style when no style part exists.
    const font = ['name', ...richProperties.filter(n => n !== 'rFont')];
    const grammar: Record<string, readonly string[]> = {
        '': ['styleSheet'], styleSheet: ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors'],
        numFmts: ['numFmt'], fonts: ['font'], font, fills: ['fill'], fill: ['patternFill'], patternFill: ['fgColor', 'bgColor'],
        borders: ['border'], border: ['left', 'right', 'top', 'bottom', 'diagonal', 'vertical', 'horizontal', 'start', 'end'],
        cellStyleXfs: ['xf'], cellXfs: ['xf'], xf: ['alignment', 'protection'], cellStyles: ['cellStyle'],
        colors: ['indexedColors', 'mruColors'], indexedColors: ['rgbColor'], mruColors: ['color'],
    };
    for (const side of grammar.border) grammar[side] = ['color'];
    const counts: Record<string, number> = { fonts: 0, fills: 0, borders: 0, cellStyleXfs: 0, cellXfs: 0 };
    const namedStyleRefs: string[] = [];
    const formats = new Map<number, string>(), xfs: { attrs: Record<string, string>; parent: string }[] = [], seen = new Set<string>();
    manualXml(data, signal, grammar, (node, parent) => {
        if (parent?.name === 'styleSheet') {
            if (seen.has(node.name)) fail('manual_style');
            seen.add(node.name);
        }
        if (parent && parent.name in counts) counts[parent.name]++;
        if (node.name === 'numFmt') {
            const id = Number(node.attrs.numFmtId);
            if (!/^[1-9][0-9]*$/.test(node.attrs.numFmtId ?? '') || id < 164 || id > 65535 || formats.has(id)
                || !/^0{1,32}$/.test(node.attrs.formatCode ?? '')) fail('manual_style');
            formats.set(id, node.attrs.formatCode);
        }
        if (node.name === 'cellStyle') namedStyleRefs.push(node.attrs.xfId);
        if (node.name === 'xf') xfs.push({ attrs: node.attrs, parent: parent!.name });
        if (node.name === 'protection' && node.attrs.hidden && node.attrs.hidden !== '0' && node.attrs.hidden !== 'false') fail('manual_style');
    }, node => {
        if (node.attrs.count !== undefined && (!/^(0|[1-9][0-9]*)$/.test(node.attrs.count) || Number(node.attrs.count) !== node.children.length)) fail('manual_style');
    });
    const result: number[] = [];
    for (const ref of namedStyleRefs) manualIndex(ref, counts.cellStyleXfs, 'manual_style');
    for (const { attrs, parent } of xfs) {
        for (const [key, count] of [['fontId', counts.fonts], ['fillId', counts.fills], ['borderId', counts.borders]] as const)
            manualIndex(attrs[key] ?? '0', count, 'manual_style');
        if (attrs.xfId !== undefined) manualIndex(attrs.xfId, counts.cellStyleXfs, 'manual_style');
        const format = attrs.numFmtId ?? '0';
        if (!/^(0|[1-9][0-9]*)$/.test(format) || !(Number(format) <= 22 || Number(format) >= 37 && Number(format) <= 49 || formats.has(Number(format)))) fail('manual_style');
        if (parent === 'cellXfs') result.push(Number(format));
    }
    if (!result.length) fail('manual_style');
    return result;
}
function manualPackageStructure(guarded: Omit<GuardedWorkbook, 'canonicalBytes'>, signal: AbortSignal) {
    const workbook = guarded.entries.get('xl/workbook.xml');
    if (!workbook) fail('manual_structure');
    const seen = new Set<string>();
    manualXml(workbook, signal, {
        '': ['workbook'], workbook: ['fileVersion', 'workbookPr', 'bookViews', 'sheets', 'calcPr'],
        bookViews: ['workbookView'], sheets: ['sheet'],
    }, (node, parent) => {
        if (parent?.name === 'workbook') {
            if (seen.has(node.name)) fail('manual_structure');
            seen.add(node.name);
        }
        // Manual interpretation is deliberately 1900-only. ExcelJS recognizes only
        // literal '1' for 1904, so neither true nor 1 is normalized/attested here.
        if (node.name === 'workbookPr' && node.attrs.date1904 !== undefined && !['0', 'false'].includes(node.attrs.date1904)) fail('manual_structure');
    }, () => {});
    if (!seen.has('sheets')) fail('manual_structure');
    for (const path of ['_rels/.rels', 'xl/_rels/workbook.xml.rels']) {
        const ids = new Set<string>(), targets = new Set<string>();
        let primary = 0;
        manualXml(guarded.entries.get(path)!, signal, { '': ['Relationships'], Relationships: ['Relationship'] }, node => {
            if (node.name !== 'Relationship') return;
            const { Id, Type, Target } = node.attrs;
            if (ids.has(Id) || Object.keys(node.attrs).some(k => !['Id', 'Type', 'Target'].includes(k))) fail('manual_structure');
            ids.add(Id);
            const prefix = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
            const type = Type?.startsWith(prefix) ? Type.slice(prefix.length) : Type === 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties' ? 'core-properties' : '';
            const resolved = path.startsWith('xl/') ? `xl/${Target}` : Target;
            const expected: Readonly<Record<string, RegExp>> = path.startsWith('xl/')
                ? { worksheet: /^xl\/worksheets\/sheet[1-9][0-9]*\.xml$/, styles: /^xl\/styles\.xml$/, sharedStrings: /^xl\/sharedStrings\.xml$/, theme: /^xl\/theme\/theme[1-9][0-9]*\.xml$/ }
                : { officeDocument: /^xl\/workbook\.xml$/, 'core-properties': /^docProps\/core\.xml$/, 'extended-properties': /^docProps\/app\.xml$/ };
            if (!Object.hasOwn(expected, type) || !expected[type].test(resolved) || !guarded.entries.has(resolved) || targets.has(resolved)) fail('manual_structure');
            targets.add(resolved);
            if (type === 'officeDocument') primary++;
        }, () => {});
        if (path === '_rels/.rels' && primary !== 1) fail('manual_structure');
    }
}
/** Successful return establishes BOTH whole-workbook values-only safety and the
 * exact unknown automatic-header policy, from bytes. No caller warning is read.
 * Deliberately not an extraction service: mixed/recognized layouts, formulas and
 * unsupported interpretation are refused, never repaired or partially attested.
 * Facts are context only; future receipt callers must run this on owned bytes. */
export async function classifyManualWorkbook(bytes: Uint8Array, signal: AbortSignal): Promise<ManualWorkbookFacts> {
    const guarded = await validatePackage(bytes, signal);
    manualPackageStructure(guarded, signal);
    const styles = manualStyles(guarded.entries, signal), shared: string[] = [];
    const stringData = guarded.entries.get('xl/sharedStrings.xml');
    if (stringData) manualXml(stringData, signal, { '': ['sst'], sst: ['si'], ...richGrammar }, () => {}, (node, parent) => {
        manualString(node);
        if (node.name === 'si') shared.push(node.text);
        else if (parent && ['t', 'r'].includes(node.name)) {
            if (parent.text.length + node.text.length > MANUAL_TEXT.cell) fail('source_text_limit');
            parent.text += node.text;
        }
    });
    const facts: ManualWorkbookFacts = { version: 1, policy: 'co-manual-xlsx-values-1', sheets: [] };
    let dereferenced = 0, recognized = false;
    const sheetNames = new Set<string>();
    for (const source of guarded.sheets) {
        signal.throwIfAborted();
        if (source.name.length > 31 || /[\\/?*\[\]:]|&(?:lt|gt|amp|apos|quot);|^'|'$/.test(source.name) || sheetNames.has(source.name.toLowerCase())) fail('unsupported_sheet');
        sheetNames.add(source.name.toLowerCase());
        const values = new Map<string, string>(), nonempty = new Set<number>(), merged = new Set<string>();
        let current: ManualNode | undefined;
        const merges: string[] = [], seen = new Set<string>();
        const grammar: Record<string, readonly string[]> = {
            '': ['worksheet'], worksheet: ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'mergeCells', 'pageMargins', 'pageSetup', 'printOptions', 'headerFooter'],
            sheetPr: ['tabColor', 'outlinePr', 'pageSetUpPr'], sheetViews: ['sheetView'], sheetView: ['pane', 'selection'],
            cols: ['col'], sheetData: ['row'], row: ['c'], c: ['v', 'is'], ...richGrammar,
            mergeCells: ['mergeCell'], headerFooter: ['oddHeader', 'oddFooter', 'evenHeader', 'evenFooter', 'firstHeader', 'firstFooter'],
        };
        manualXml(guarded.entries.get(source.path)!, signal, grammar, (node, parent) => {
            if (parent?.name === 'worksheet') {
                if (seen.has(node.name)) fail('manual_structure');
                seen.add(node.name);
            }
            for (const key of ['hidden', 'collapsed', 'zeroHeight']) {
                if (node.attrs[key] !== undefined && !['0', 'false'].includes(node.attrs[key])) fail('hidden_content');
            }
            if (node.name === 'row' && node.attrs.s !== undefined) manualIndex(node.attrs.s, styles.length, 'manual_style');
            if (node.name === 'col' && node.attrs.style !== undefined) manualIndex(node.attrs.style, styles.length, 'manual_style');
            if (node.name === 'c') {
                if (Object.keys(node.attrs).some(k => !['r', 's', 't'].includes(k))) fail('manual_structure');
                manualIndex(node.attrs.s ?? '0', styles.length, 'manual_style');
                if (!['n', 's', 'inlineStr', 'str', 'b'].includes(node.attrs.t ?? 'n')) fail('manual_cell_type');
                current = node;
            }
            if (node.name === 'mergeCell') merges.push(node.attrs.ref);
        }, (node, parent) => {
            manualString(node);
            if (parent && ['t', 'r', 'is', 'v'].includes(node.name)) {
                if (parent.text.length + node.text.length > MANUAL_TEXT.cell) fail('source_text_limit');
                parent.text += node.text;
            }
            if (node.name !== 'c') return;
            const type = node.attrs.t ?? 'n', hasValue = node.children.includes('v'), inline = node.children.includes('is');
            if (node !== current || node.children.filter(n => n === 'v').length > 1 || node.children.filter(n => n === 'is').length > 1
                || (type === 'inlineStr' ? !inline || hasValue : inline)) fail('manual_cell_value');
            let value = node.text;
            if (type === 's') value = shared[manualIndex(value, shared.length, 'manual_shared_string')];
            else if (type === 'b' && (!hasValue || !/^[01]$/.test(value))) fail('manual_cell_value');
            else if (type === 'n' && hasValue && (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[Ee][+-]?[0-9]+)?$/.test(value) || !Number.isFinite(Number(value)))) fail('manual_cell_value');
            else if (type === 'str' && !hasValue) fail('manual_cell_value');
            const format = styles[Number(node.attrs.s ?? '0')];
            if (type === 'n' && hasValue && (format >= 14 && format <= 22 || format >= 45 && format <= 47)
                && (Number(value) < 0 || Number(value) > 2958465)) fail('manual_cell_value');
            if (value.length > MANUAL_TEXT.cell) fail('source_text_limit');
            dereferenced += value.length;
            if (dereferenced > MANUAL_TEXT.dereferenced) fail('dereferenced_text_limit');
            const ref = node.attrs.r;
            values.set(ref, value);
            if (value !== '') nonempty.add(coordinate(ref)[0]);
            current = undefined;
        });
        if (!seen.has('sheetData')) fail('manual_structure');
        for (const ref of merges) {
            const [start, end = start] = ref.split(':'), [r, c] = coordinate(start), [rr, cc] = coordinate(end);
            for (let y = r; y <= rr; y++) for (let x = c; x <= cc; x++) {
                signal.throwIfAborted();
                const key = `${y}:${x}`;
                if (merged.has(key)) fail('manual_merge');
                merged.add(key);
                let column = '', n = x;
                while (n) { n--; column = String.fromCharCode(65 + n % 26) + column; n = Math.floor(n / 26); }
                const address = `${column}${y}`;
                if (address !== start && (values.get(address) ?? '') !== '') fail('manual_merge');
            }
        }
        if (Object.entries(CO_XLSX_HEADERS).every(([column, title]) => (values.get(`${column}4`) ?? '').trim() === title)) recognized = true;
        facts.sheets.push({ name: source.name, rows: [...nonempty].sort((a, b) => a - b) });
    }
    signal.throwIfAborted();
    if (recognized) fail('manual_layout_recognized');
    return facts;
}
