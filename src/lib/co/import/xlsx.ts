import type { Workbook, Cell } from 'exceljs'
import type { ExtractedReport, SourceNumber, SourceRow } from './types'
import { normalizeSourceNumber } from './decimal'
import { guardWorkbook, workbookErrorCode, classifyManualWorkbook, CO_XLSX_HEADERS } from './workbookGuard'
import { assertResultBudget, ImportBudgetError, ResultBudget } from './resultBudget'

const VERSION = 'co-guarded-xlsx-7'
export const XLSX_TEXT_LIMITS = Object.freeze({
  identity: 128, unit: 32, name: 256, cell: 512, number: 128,
  dereferencedCodeUnits: 128 * 1024,
})


export async function extractXlsx(bytes: Uint8Array, sha256: string, signal: AbortSignal): Promise<ExtractedReport> {
  const empty = (code: string): ExtractedReport => ({
    sha256, format: 'xlsx', parserVersion: VERSION, sourceRows: [], sections: [], printedControls: [],
    periodCandidates: [], customerCandidates: [], warnings: [`manual_review:${code}`],
  })
  signal.throwIfAborted()
  try {
    const guarded = await guardWorkbook(bytes, signal)
    signal.throwIfAborted()
    // Explicit browser entry. Only the validated, canonical stored ZIP reaches ExcelJS.
    const module = await import('exceljs/dist/exceljs.min.js')
    const ExcelJS = (module.default ?? module) as { Workbook: new () => Workbook }
    signal.throwIfAborted()
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(guarded.canonicalBytes as unknown as Parameters<Workbook['xlsx']['load']>[0])
    signal.throwIfAborted()

    const result: ExtractedReport = { ...empty(''), warnings: [
      'review_required:source_prices_are_not_CO_prices', 'review_required:currency_and_customer',
      'review_required:returns_are_not_deducted',
    ] }
    const outputBudget = new ResultBudget()
    outputBudget.reserve(result)
    let dereferencedUnits = 0
    const reserveText = (length: number, fieldLimit: number) => {
      if (length > fieldLimit) throw new ImportBudgetError('source_text_limit')
      dereferencedUnits += length
      if (dereferencedUnits > XLSX_TEXT_LIMITS.dereferencedCodeUnits) {
        throw new ImportBudgetError('dereferenced_text_limit')
      }
    }

    for (const sourceSheet of guarded.sheets) {
      const sheet = book.getWorksheet(sourceSheet.name)
      if (!sheet) return empty('model_mismatch')
      const raw = guarded.cells.get(sourceSheet.path)!
      // Cache each physical cell only once; total cached text is bounded by reserveText.
      const textCache = new Map<string, string>()
      const formulaRows = new Set<number>()
      const evidenceOutsideGroupTitle = new Set<number>()
      for (const [address, value] of raw) {
        // ExcelJS discards original slave values when materializing merges. Check
        // preserved physical evidence before ANY display-based empty/summary logic.
        // Empty styled slaves remain supported; a value or formula may not vanish.
        if (value.hasContent || value.formula) {
          const cell = sheet.getCell(address)
          if (cell.isMerged && cell.master.address !== address) return empty('malformed_transaction')
        }
        const rowNumber = Number(address.replace(/^[A-Z]+/, ''))
        if (value.formula) formulaRows.add(rowNumber)
        if (!/^A[0-9]+$/.test(address) && value.hasContent) evidenceOutsideGroupTitle.add(rowNumber)
      }
      // Title, period and column headers are structural, not transaction caches.
      if ([1, 2, 3, 4].some(r => formulaRows.has(r))) return empty('structural_formula')

      const text = (cell: Cell, fieldLimit: number): string => {
        if (cell.isMerged && cell.master.address !== cell.address) return ''
        const value = cell.value
        if (value && typeof value === 'object' && 'richText' in value) {
          // Sum lengths BEFORE map/join/trim. A shared string is charged each time
          // a different physical cell dereferences it, including repeated aliases.
          let length = 0
          for (const run of value.richText) {
            length += run.text.length
            if (length > fieldLimit) throw new ImportBudgetError('source_text_limit')
          }
          reserveText(length, fieldLimit)
          return value.richText.map(run => run.text).join('')
        }
        const untrimmed = typeof value === 'string' ? value
          : value && typeof value === 'object' && 'formula' in value && typeof value.result === 'string'
            ? value.result : raw.get(cell.address)?.raw ?? ''
        reserveText(untrimmed.length, fieldLimit)
        return untrimmed
      }
      const get = (r: number, column: string, trim = true): string => {
        const address = `${column}${r}`
        if (!textCache.has(address)) {
          const limit = column === 'G' ? XLSX_TEXT_LIMITS.cell // summary notes also occupy G
            : column === 'B' || column === 'D' ? XLSX_TEXT_LIMITS.identity : XLSX_TEXT_LIMITS.cell
          textCache.set(address, text(sheet.getCell(address), limit))
        }
        const original = textCache.get(address)!
        return trim ? original.trim() : original
      }
      const number = (r: number, column: string): SourceNumber => {
        const cell = raw.get(`${column}${r}`), value = cell?.raw ?? ''
        if (value.length > XLSX_TEXT_LIMITS.number) throw new ImportBudgetError('source_text_limit')
        if (cell && ['n', ''].includes(cell.type)) return normalizeSourceNumber(value, '.')

        // Supported numeric columns may contain literal integer text, including
        // shared-string zero. Preserve the original text before whitespace trimming;
        // do not interpret locale separators, signs, decimals, exponents or blanks.
        const original = get(r, column, false)
        if (original.length > XLSX_TEXT_LIMITS.number) throw new ImportBudgetError('source_text_limit')
        const textType = cell && ['s', 'inlineStr', 'str'].includes(cell.type)
        const canonicalInteger = /^(?:0|[1-9][0-9]*)$/.test(original)
        return { raw: original, decimal: textType && canonicalInteger ? original : null, convention: textType && canonicalInteger ? 'canonical_integer_text' : null }
      }
      if (!Object.entries(CO_XLSX_HEADERS).every(([c, v]) => get(4, c) === v)) {
        // Byte-derived safety AND exact unknown-header eligibility across ALL sheets.
        // Mixed/recognized workbooks cannot hide post-recognition failures here.
        const manualWorkbook = await classifyManualWorkbook(bytes, signal)
        signal.throwIfAborted()
        const manual = { ...empty('safe_unsupported_xlsx_layout'), manualWorkbook }
        assertResultBudget(manual)
        return manual
      }
      const p = /^Periode\s*:\s*(\d{2})-(\d{2})-(\d{4})\s*s\/d\s*(\d{2})-(\d{2})-(\d{4})$/.exec(get(2, 'A'))
      if (p) {
        const first = `${p[3]}-${p[2]}-${p[1]}`, last = `${p[6]}-${p[5]}-${p[4]}`
        const end = new Date(`${first}T00:00:00Z`)
        if (Number.isFinite(end.getTime())) {
          end.setUTCMonth(end.getUTCMonth() + 1)
          end.setUTCDate(0)
          if (p[1] === '01' && last === end.toISOString().slice(0, 10) && !result.periodCandidates.includes(first)) {
            outputBudget.reserve(first)
            result.periodCandidates.push(first)
          }
        }
      }

      let section: ExtractedReport['sections'][number] | null = null
      let name = '', footerSeen = false
      for (let r = 5; r <= sheet.rowCount; r++) {
        signal.throwIfAborted()
        const a = get(r, 'A'), ref = get(r, 'B'), date = get(r, 'C'), skuText = get(r, 'D')
        if (a.startsWith('Produk:')) {
          if (formulaRows.has(r)) return empty('structural_formula')
          if (evidenceOutsideGroupTitle.has(r)) return empty('malformed_transaction')
          if (footerSeen || !sheet.getCell(`K${r}`).isMerged || sheet.getCell(`K${r}`).master.address !== `A${r}` || !a.slice(7).trim()) {
            return empty('unsupported_group')
          }
          name = a.slice(7).trim()
          if (name.length > XLSX_TEXT_LIMITS.name) throw new ImportBudgetError('source_text_limit')
          section = { id: `xlsx:${sourceSheet.name}:r${r}`, label: name, rowIds: [], printedTotal: null }
          outputBudget.reserve(section)
          result.sections.push(section)
          continue
        }
        if (!ref && !date) {
          if (formulaRows.has(r)) return empty('structural_formula')
          const values = Object.fromEntries('ABCDEFGHIJKL'.split('').map(c => [c, get(r, c)]))
          if (Object.values(values).every(value => value === '')) continue
          // Supported subtotal/footer: count + quantity + returns + amount, without
          // transaction identity/prices. Never interpret arbitrary financial rows as decoration.
          const isSlaveOf = (column: string, master: string) => {
            const cell = sheet.getCell(`${column}${r}`)
            return cell.isMerged && cell.master.address === `${master}${r}`
          }
          const summaryMerges = section
            ? isSlaveOf('C', 'B') && isSlaveOf('J', 'G')
            : isSlaveOf('C', 'A') && isSlaveOf('H', 'G')
          // A contradictory printed count remains evidence, not discarded decoration.
          const countValid = /^[1-9][0-9]*$/.test(values.D)
          const numericSummary = ['E', 'F', 'K'].every(c => values[c] !== '' && number(r, c).decimal !== null)
          const noIdentityOrPrice = ['A', 'B', 'C', 'H', 'J', 'L'].every(c => values[c] === '')
          const noteAllowed = values.G === '' || !!section && /^ADA RETUR\s/.test(values.G)
          const discountAllowed = values.I === '' || !section && number(r, 'I').decimal === '0'
          if (footerSeen || !summaryMerges || !countValid || !numericSummary || !noIdentityOrPrice || !noteAllowed || !discountAllowed) {
            return empty('malformed_transaction')
          }
          const control = {
            kind: section ? 'section' as const : 'sheet' as const,
            ref: { fileSha256: sha256, page: null, sheet: sourceSheet.name, row: `r${r}`, section: section?.id ?? `xlsx:${sourceSheet.name}:sheet` },
            rowIds: section ? [...section.rowIds] : result.sourceRows.filter(row => row.ref.sheet === sourceSheet.name).map(row => row.id),
            count: number(r, 'D'), quantity: number(r, 'E'), returned: number(r, 'F'), amount: number(r, 'K'),
          }
          outputBudget.reserve(control)
          result.printedControls!.push(control)
          if (section) {
            const total = number(r, 'K')
            outputBudget.reserve(total)
            section.printedTotal = total
            section = null
          } else {
            footerSeen = true
          }
          name = ''
          continue
        }
        if (!section || !name || footerSeen) return empty('transaction_outside_group')
        if (!ref || !date || !skuText) return empty('malformed_transaction')
        let transactionDate: string | null = null
        const dateCell = sheet.getCell(`C${r}`), dateRaw = raw.get(`C${r}`)
        if (dateCell.value instanceof Date && /^\d+$/.test(dateRaw?.raw ?? '') && Number(dateRaw!.raw) > 0 && Number.isFinite(dateCell.value.getTime())) {
          transactionDate = dateCell.value.toISOString().slice(0, 10)
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(new Date(date + 'T00:00:00Z').getTime()) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date) {
          transactionDate = date
        }
        if (!transactionDate) return empty('unsupported_date')
        const codeCell = sheet.getCell(`D${r}`), codeRaw = raw.get(`D${r}`)
        const flags = ['discount_basis_unknown', 'currency_requires_confirmation']
        let sku = skuText
        if (codeRaw?.type === 'n') {
          if (!/^\d+$/.test(sku)) return empty('unsupported_code')
          const format = codeCell.numFmt || 'General'
          if (/^0{1,32}$/.test(format)) {
            sku = sku.padStart(format.length, '0')
            flags.push(`source_sku_raw:${codeRaw.raw}`)
          } else if (format !== 'General' && format !== '0') flags.push('source_sku_format_requires_confirmation')
        }
        if (formulaRows.has(r)) flags.push('formula_cache_requires_confirmation')
        const unit = get(r, 'G')
        if (unit.length > XLSX_TEXT_LIMITS.unit) throw new ImportBudgetError('source_text_limit')
        const sourceRef = { fileSha256: sha256, page: null, sheet: sourceSheet.name, row: `r${r}`, section: section.id }
        const id = `${sha256}:sheet:${sourceSheet.name}:r${r}:${section.id}`
        const sourceRow: SourceRow = {
          id, ref: sourceRef, sourceSku: sku, name, transactionDate, transactionReference: ref,
          quantity: number(r, 'E'), returned: number(r, 'F'), unit: unit || null,
          unitPrice: number(r, 'H'), discount: number(r, 'I'), discountBasis: 'unknown',
          netUnitPrice: number(r, 'J'), amount: number(r, 'K'), currency: null, priceBasisLabel: null, flags,
        }
        if ([sourceRow.quantity, sourceRow.returned, sourceRow.unitPrice, sourceRow.discount, sourceRow.netUnitPrice, sourceRow.amount].some(v => v && v.decimal === null)) flags.push('unresolved_source_number')
        if (sourceRow.returned?.decimal && /[1-9]/.test(sourceRow.returned.decimal)) flags.push('return_reconciliation_required')
        // Account for repeated group names, physical IDs and section row-ID aliases
        // before retaining the next row. No whole-result JSON string is allocated.
        outputBudget.reserve(sourceRow)
        outputBudget.reserve(id)
        result.sourceRows.push(sourceRow)
        section.rowIds.push(id)
      }
    }
    if (!result.sourceRows.length) return empty('no_transactions')
    assertResultBudget(result)
    return result
  } catch (e) {
    if (signal.aborted) throw e
    return empty(e instanceof ImportBudgetError ? e.message : workbookErrorCode(e))
  }
}
