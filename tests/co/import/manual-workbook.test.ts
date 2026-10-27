// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import * as shared from '../../../supabase/functions/_shared/workbook-guard'
import { extractXlsx } from '../../../src/lib/co/import/xlsx'
import { canTranscribeSource } from '../../../src/lib/co/import/manualPolicy'
import { sourceControlIssues } from '../../../src/lib/co/import/sourceControls'
import { header, group, transaction, ns, num, parts, row, str, zip, type Part } from './fixtures/xlsx-layout'

const sha = 'a'.repeat(64)
const signal = () => new AbortController().signal
const unknown = () => parts(row(2, str('A2', 'Other report')) + row(8, str('B8', 'Item') + num('E8', '2')), '')
const classify = (p: Part[]) => shared.classifyManualWorkbook(zip(p), signal())
function second(p: Part[], data: string, merges = ''): Part[] {
  p[2].text = p[2].text!.replace('</sheets>', '<sheet name="Other" sheetId="2" r:id="rId9"/></sheets>')
  p[3].text = p[3].text!.replace('</Relationships>', '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>')
  p.push({ ...parts(data, merges)[5], name: 'xl/worksheets/sheet2.xml' })
  return p
}
const sharedString = (p: Part[], value: string) => {
  p.push({ name: 'xl/sharedStrings.xml', text: `<sst xmlns="${ns}"><si>${value}</si></sst>` })
  return p
}
async function refused(p: Part[], code: string) {
  await expect(classify(p)).rejects.toMatchObject({ code })
  const result = await extractXlsx(zip(p), sha, signal())
  expect(result.sourceRows).toEqual([])
  expect(result).not.toHaveProperty('manualWorkbook')
  expect(result.warnings).not.toContain('manual_review:safe_unsupported_xlsx_layout')
}

describe('complete byte-derived unknown-layout manual workbook classification', () => {
  it('returns distinct safe-unknown evidence only after classifying the entire workbook', async () => {
    const result = await extractXlsx(zip(unknown()), sha, signal())
    expect(result.warnings).toEqual(['manual_review:safe_unsupported_xlsx_layout'])
    expect(result.manualWorkbook).toEqual({ version: 1, policy: 'co-manual-xlsx-values-1', sheets: [{ name: 'Sheet', rows: [2, 8] }] })
  })
  it('attests all physical nonempty rows across all unknown sheets, not dimensions or style-only cells', async () => {
    const p = second(unknown(), row(1, str('A1', 'Second')) + row(9, '<c r="A9" s="1"/>') + row(10, num('B10', '0') + str('C10', '')), '')
    expect(await classify(p)).toEqual({ version: 1, policy: 'co-manual-xlsx-values-1', sheets: [{ name: 'Sheet', rows: [2, 8] }, { name: 'Other', rows: [1, 10] }] })
    const result = await extractXlsx(zip(p), sha, signal())
    expect(result).toMatchObject({ parserVersion: 'co-guarded-xlsx-7', sourceRows: [], sections: [], warnings: ['manual_review:safe_unsupported_xlsx_layout'], manualWorkbook: { version: 1, policy: 'co-manual-xlsx-values-1', sheets: [{ name: 'Sheet', rows: [2, 8] }, { name: 'Other', rows: [1, 10] }] } })
    // Task 3 enables a client manual-v2 affordance, never a receipt capability.
    expect(canTranscribeSource(result)).toBe(true)
  })
  it('attests whitespace-valued physical rows without silently discarding their source identity', async () => {
    expect((await classify(parts(row(7, str('A7', ' ')), ''))).sheets).toEqual([{ name: 'Sheet', rows: [7] }])
    await expect(classify(parts(row(7, str('A7', 'Master') + str('B7', ' ')), 'A7:B7'))).rejects.toMatchObject({ code: 'manual_merge' })
  })
  it('accepts bounded shared/inline rich strings and safe merges without counting empty slaves', async () => {
    const p = sharedString(parts(row(3, '<c r="A3" t="s"><v>0</v></c><c r="B3" s="1"/>') + row(8, '<c r="A8" t="inlineStr"><is><r><rPr><b/></rPr><t>Inline</t></r><r><t> text</t></r></is></c>'), 'A3:B3'), '<r><t>Shared</t></r><r><t> text</t></r>')
    expect((await classify(p)).sheets).toEqual([{ name: 'Sheet', rows: [3, 8] }])
  })
  it.each(['<c r="A1"><f>1+1</f><v>2</v></c>', '<c r="A1"><f>1+1</f></c>', '<c r="A1" t="str"><f>"Text"</f><v>Text</v></c>'])('rejects any later-sheet formula, including a plausible cache: %s', async cell => {
    await refused(second(unknown(), row(1, cell)), 'manual_formula')
  })
  it.each(['0', '1', '-1', '0.0', '1e0', 'NaN'])('rejects an absent or invalid later-sheet shared string reference %s', async index => {
    const p = second(unknown(), row(1, `<c r="A1" t="s"><v>${index}</v></c>`))
    if (index !== '0') sharedString(p, '<t>Only index zero</t>')
    await refused(p, 'manual_shared_string')
  })
  it('rejects physical evidence lost beneath a merge on a later sheet', async () => {
    await refused(second(unknown(), row(1, str('A1', 'Master') + num('B1', '999')), 'A1:B1'), 'manual_merge')
  })
  it('rejects overlapping merges rather than relying on model repair', async () => {
    await refused(second(unknown(), row(1, str('A1', 'Master')), 'A1:B1,B1:C1'), 'manual_merge')
  })
  it('rejects oversized rich strings before joining and cumulative dereferencing across sheets', async () => {
    await refused(sharedString(second(unknown(), row(1, '<c r="A1" t="s"><v>0</v></c>')), '<r><t>' + 'X'.repeat(300) + '</t></r><r><t>' + 'Y'.repeat(213) + '</t></r>'), 'source_text_limit')
    const repeated = (start: number) => Array.from({ length: 140 }, (_, i) => row(start + i, `<c r="A${start + i}" t="s"><v>0</v></c>`)).join('')
    await refused(sharedString(second(parts(repeated(1), ''), repeated(1)), '<t>' + 'X'.repeat(500) + '</t>'), 'dereferenced_text_limit')
  })
  it.each([
    ['<c r="A1" s="3"><v>1</v></c>', 'manual_style'],
    ['<c r="A1" s="1e0"><v>1</v></c>', 'manual_style'],
    ['<c r="A1" t="n"><v>NaN</v></c>', 'manual_cell_value'],
    ['<c r="A1" t="n"><v>1e999</v></c>', 'manual_cell_value'],
    ['<c r="A1" t="n"><v>0x10</v></c>', 'manual_cell_value'],
    ['<c r="A1" t="n"><v/></c>', 'manual_cell_value'],
    ['<c r="A1" t="b"><v>2</v></c>', 'manual_cell_value'],
    ['<c r="A1" t="e"><v>#REF!</v></c>', 'manual_cell_type'],
    ['<c r="A1" t="d"><v>garbage</v></c>', 'manual_cell_type'],
    ['<c r="A1" t="inlineStr"><v>lost</v></c>', 'manual_cell_value'],
    ['<c r="A1" t="inlineStr"><is><t>one</t><t>two</t></is></c>', 'manual_structure'],
    ['<c r="A1"><is><t>lost</t></is></c>', 'manual_cell_value'],
    ['<c r="A1"><v><b>2</b></v></c>', 'manual_structure'],
    ['<c r="A1" cm="1"><v>2</v></c>', 'manual_structure'],
  ])('rejects a malformed or undisplayable cell anywhere: %s', async (cell, code) => {
    await refused(second(unknown(), row(1, cell)), code)
  })
  it('rejects nonexistent style dependencies and unsupported format interpretations', async () => {
    const invalid = unknown(); invalid[4].text = invalid[4].text!.replace('fontId="0"', 'fontId="2"')
    await refused(invalid, 'manual_style')
    const format = unknown(); format[4].text = format[4].text!.replace('formatCode="00000000"', 'formatCode="[Red][&gt;0]0;[Blue]0"')
    await refused(format, 'manual_style')
  })
  it.each([
    ['named style', (p: Part[]) => { p[4].text = p[4].text!.replace('</styleSheet>', '<cellStyles count="1"><cellStyle name="Normal" xfId="99"/></cellStyles></styleSheet>') }],
    ['row style', (p: Part[]) => { p[5].text = p[5].text!.replace('<row r="2">', '<row r="2" s="99">') }],
    ['column style', (p: Part[]) => { p[5].text = p[5].text!.replace('<sheetData>', '<cols><col min="1" max="1" style="99"/></cols><sheetData>') }],
  ])('validates every referenced style index, including %s', async (_, mutate) => {
    const p = unknown(); mutate(p)
    await expect(classify(p)).rejects.toMatchObject({ code: 'manual_style' })
  })
  it('rejects unsupported structural content instead of discarding it as empty', async () => {
    const p = unknown(); p[5].text = p[5].text!.replace('</worksheet>', '<unknown><lost>9</lost></unknown></worksheet>')
    await refused(p, 'manual_structure')
  })
  it.each([
    ['workbook', (p: Part[]) => { p[2].text = p[2].text!.replace('<sheets>', '<unknown><sheets>').replace('</sheets>', '</sheets></unknown>') }],
    ['relationship root', (p: Part[]) => { p[3].text = p[3].text!.replace('<Relationships ', '<Ignored ').replace('</Relationships>', '</Ignored>') }],
    ['wrong relationship namespace', (p: Part[]) => { p[2].text = p[2].text!.replace('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', 'xmlns:r="urn:wrong"') }],
    ['non-worksheet relation type', (p: Part[]) => { p[3].text = p[3].text!.replace('/relationships/worksheet', '/relationships/styles') }],
  ])('refuses package/model interpretation mismatch in %s', async (_, mutate) => {
    const p = unknown(); mutate(p)
    await expect(classify(p)).rejects.toMatchObject({ code: 'manual_structure' })
  })
  it.each([
    '<c r="A1" __proto__="ignored"><v>2</v></c>',
    '<c r="A1" t="str"><v>&amp;amp;</v></c>',
    '<c r="A1" t="inlineStr"><is><r><t>_x0000_</t></r></is></c>',
  ])('refuses unsupported string/attribute decoding instead of silently changing evidence: %s', async cell => {
    await expect(classify(second(unknown(), row(1, cell)))).rejects.toHaveProperty('code')
  })
  it('refuses a date-style serial that cannot be displayed as an Excel date', async () => {
    await refused(second(unknown(), row(1, num('A1', '1e20', 's="1"'))), 'manual_cell_value')
  })
  it('does not attest model-normalized sheet names as physical source identities', async () => {
    const p = unknown(); p[2].text = p[2].text!.replace('name="Sheet"', 'name="Sales &amp;amp;"')
    await expect(classify(p)).rejects.toMatchObject({ code: 'unsupported_sheet' })
  })
  it('recognizes automatic headers from shared and rich strings, not only inline literals', async () => {
    const data = header.replace(str('A4', 'No Faktur'), '<c r="A4" t="s"><v>0</v></c>')
    await expect(classify(sharedString(parts(data, ''), '<r><t>No </t></r><r><t>Faktur</t></r>'))).rejects.toMatchObject({ code: 'manual_layout_recognized' })
  })
  it('keeps recognized and mixed workbooks ineligible even if an unknown sheet appears first', async () => {
    await refused(second(unknown(), header + group + transaction(6), 'A5:K5'), 'manual_layout_recognized')
    await expect(classify(parts())).rejects.toMatchObject({ code: 'manual_layout_recognized' })
    const result = await extractXlsx(zip(parts()), sha, signal())
    expect(result.sourceRows).toHaveLength(1)
    expect(result).not.toHaveProperty('manualWorkbook')
    expect(result.sourceRows[0].quantity.raw).toBe('2')
  })
  it.each([
    [parts(header + group + transaction(6).replace(num('C6', '46263', 's="1"'), str('C6', 'invalid'))), 'unsupported_date'],
    [parts(header + group + transaction(6) + row(7, num('E7', '999'))), 'malformed_transaction'],
  ])('does not relabel a post-recognition failure as unknown', async (p, code) => {
    const result = await extractXlsx(zip(p), sha, signal())
    expect(result.warnings).toContain(`manual_review:${code}`)
    expect(result).not.toHaveProperty('manualWorkbook')
  })
  it('preserves supported cached-formula extraction while refusing it for manual mode', async () => {
    const p = parts(header + group + transaction(6).replace('<v>2</v>', '<f>1+1</f><v>2</v>'))
    await expect(classify(p)).rejects.toMatchObject({ code: 'manual_formula' })
    const result = await extractXlsx(zip(p), sha, signal())
    expect(result.sourceRows[0].quantity.decimal).toBe('2')
    expect(result.sourceRows[0].flags).toContain('formula_cache_requires_confirmation')
    expect(result).not.toHaveProperty('manualWorkbook')
  })
  it('does not let parser v7 skip required automatic printed controls', async () => {
    const result = await extractXlsx(zip(parts()), sha, signal())
    result.parserVersion = 'co-guarded-xlsx-7'
    delete result.printedControls
    expect(sourceControlIssues(result)).toContain('source_controls_required')
  })
  it.each(['zip', 'crc', 'xml', 'macro', 'external', 'hidden'])('retains existing complete archive refusal for %s', async kind => {
    const p = unknown()
    if (kind === 'crc') p[5].crc = 0
    if (kind === 'xml') p[5].text = p[5].text!.replace('</sheetData>', '')
    if (kind === 'macro') p.push({ name: 'xl/vbaProject.bin', text: 'x' })
    if (kind === 'external') p[3].text = p[3].text!.replace('Target="styles.xml"', 'Target="https://invalid.example/x" TargetMode="External"')
    if (kind === 'hidden') p[2].text = p[2].text!.replace('sheetId="1"', 'sheetId="1" state="hidden"')
    const bytes = kind === 'zip' ? new TextEncoder().encode('not a zip') : zip(p)
    await expect(shared.classifyManualWorkbook(bytes, signal())).rejects.toBeDefined()
    const result = await extractXlsx(bytes, sha, signal())
    expect(result.sourceRows).toEqual([])
    expect(result).not.toHaveProperty('manualWorkbook')
    expect(result.warnings).not.toContain('manual_review:safe_unsupported_xlsx_layout')
  })
  it('throws on pre-cancel and cancellation during expansion without emitting partial facts', async () => {
    const before = new AbortController(); before.abort()
    await expect(shared.classifyManualWorkbook(zip(unknown()), before.signal)).rejects.toMatchObject({ name: 'AbortError' })
    const during = new AbortController(), p = shared.classifyManualWorkbook(zip(second(unknown(), row(1, str('A1', 'Late')))), during.signal)
    during.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    const extractAbort = new AbortController(), extracted = extractXlsx(zip(unknown()), sha, extractAbort.signal)
    extractAbort.abort()
    await expect(extracted).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('classification does not fetch network resources', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    try { expect((await classify(unknown())).sheets[0].rows).toEqual([2, 8]); expect(fetch).not.toHaveBeenCalled() }
    finally { fetch.mockRestore() }
  })
})

describe('review R2-1 bounded date-system interpretation', () => {
  const withDate = (epoch: string, serial: string) => {
    const p = second(unknown(), row(9, num('A9', serial, 's="1"')))
    p[2].text = p[2].text!.replace('<sheets>', `<workbookPr date1904="${epoch}"/><sheets>`)
    return p
  }
  it('characterizes the installed model literal-one epoch interpretation', async () => {
    const module = await import('exceljs/dist/exceljs.min.js'), ExcelJS = module.default ?? module
    for (const [epoch, enabled] of [['true', false], ['1', true]] as const) {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load((await shared.guardWorkbook(zip(withDate(epoch, '2958465')), signal())).canonicalBytes)
      expect(book.properties.date1904).toBe(enabled)
      const value = book.getWorksheet('Other')!.getCell('A9').value
      expect(value).toBeInstanceOf(Date)
      expect((value as Date).getUTCFullYear()).toBe(enabled ? 10004 : 9999)
    }
  })
  it.each([['true', '46263'], ['1', '46263'], ['1', '2958465']])('refuses unsupported 1904 representation %s with later-sheet date %s', async (epoch, serial) => {
    await refused(withDate(epoch, serial), 'manual_structure')
  })
  it.each(['0', 'false'])('retains the supported 1900 maximum displayable date for %s', async epoch => {
    const p = withDate(epoch, '2958465')
    expect((await classify(p)).sheets).toEqual([{ name: 'Sheet', rows: [2, 8] }, { name: 'Other', rows: [9] }])
    const result = await extractXlsx(zip(p), sha, signal())
    expect(result.warnings).toEqual(['manual_review:safe_unsupported_xlsx_layout'])
    expect(result.manualWorkbook?.sheets).toEqual([{ name: 'Sheet', rows: [2, 8] }, { name: 'Other', rows: [9] }])
  })
  it('still refuses serials beyond the supported 1900 boundary', async () => {
    await refused(withDate('0', '2958466'), 'manual_cell_value')
  })
})

describe('review R2-2 shared-empty representation', () => {
  const withShared = (value: string) => sharedString(second(unknown(), row(9, '<c r="A9" t="s"><v>0</v></c>')), value)
  it('characterizes a childless si as a model object, not empty text', async () => {
    const module = await import('exceljs/dist/exceljs.min.js'), ExcelJS = module.default ?? module
    const book = new ExcelJS.Workbook()
    await book.xlsx.load((await shared.guardWorkbook(zip(withShared('')), signal())).canonicalBytes)
    expect(book.getWorksheet('Other')!.getCell('A9').value).toEqual({})
  })
  it('refuses a later-sheet reference to a childless shared item without partial facts', async () => {
    await refused(withShared(''), 'manual_structure')
  })
  it('retains explicitly empty shared text and its genuinely empty physical row', async () => {
    const p = withShared('<t/>')
    const module = await import('exceljs/dist/exceljs.min.js'), ExcelJS = module.default ?? module
    const book = new ExcelJS.Workbook()
    await book.xlsx.load((await shared.guardWorkbook(zip(p), signal())).canonicalBytes)
    expect(book.getWorksheet('Other')!.getCell('A9').value).toBe('')
    expect((await classify(p)).sheets).toEqual([{ name: 'Sheet', rows: [2, 8] }, { name: 'Other', rows: [] }])
    const result = await extractXlsx(zip(p), sha, signal())
    expect(result.warnings).toEqual(['manual_review:safe_unsupported_xlsx_layout'])
    expect(result.manualWorkbook?.sheets).toEqual([{ name: 'Sheet', rows: [2, 8] }, { name: 'Other', rows: [] }])
  })
})
