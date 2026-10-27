// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async importOriginal => {
  const actual = await importOriginal<typeof pdfjs>()
  return {...actual, getDocument:vi.fn(actual.getDocument)}
})
import { extractPdf } from '../../../src/lib/co/import/pdf'
import { bjHeader, bjRow, pdf, septHeader, septRow } from './fixtures/pdf-layout'
const hash = 'a'.repeat(64)
const extract = (bytes: Uint8Array) => extractPdf(bytes, hash, new AbortController().signal)
describe('bounded searchable PDF evidence', () => {
  it('bj_page_totals_are_not_transactions', async () => {
    const result = await extract(pdf([[...bjHeader, bjRow, [[27, 'Total PMJ'], [541, '2,500']], [[27, 'TOTAL'], [541, '2,500']]]]))
    expect(result.sourceRows).toHaveLength(1)
    expect(result.sections[0].printedTotal?.decimal).toBe('2500')
    expect(result.sourceRows[0].sourceSku).toBe('00001234')
  })
  it('september_sections_stay_separate', async () => {
    const result = await extract(pdf([[[[100, 'REKAP PENJUALAN']], [[100, 'CV SYNTHETIC STORE']], [[100, '01/09/2026 sd 30/09/2026']], septHeader, septRow, [[174, 'TOTAL'], [506, '2.500,00']], septHeader, septRow, [[174, 'TOTAL'], [506, '2.500,00']]]]))
    expect(result.sections).toHaveLength(2)
    expect(result.sections.map(s => s.printedTotal?.decimal)).toEqual(['2500.00', '2500.00'])
    expect(result.sourceRows.map(r => r.ref.section)).toEqual(result.sections.map(s => s.id))
    expect(result.sourceRows[0].unit).toBeNull()
    expect(result.sourceRows[0].discount).toEqual({raw:'-', decimal:'0',convention:'dash_zero'})
  })
  it('identical_transactions_keep_distinct_refs', async () => {
    const page = [...bjHeader, [[25, 'filler one']], [[25, 'filler two']], [[25, 'filler three']], bjRow] as typeof bjHeader
    const result = await extract(pdf([page, page]))
    expect(result.sourceRows.map(r => `${r.ref.page}:${r.ref.row}`)).toEqual(['1:r8', '2:r8'])
    expect(new Set(result.sourceRows.map(r => r.id)).size).toBe(2)
    expect(result.sourceRows.every(r => r.id.includes(hash))).toBe(true)
  })
  it('recognises BJ labelled summary totals outside transaction columns', async () => {
    const result = await extract(pdf([[...bjHeader,bjRow,[[23,'Total PMJ'],[136,'Qty:'],[155,'2'],[220,'Penjualan Rp.'],[279,'2,500']]]]))
    expect(result.sourceRows).toHaveLength(1)
    expect(result.sections[0].printedTotal?.decimal).toBe('2500')
  })
  it('keeps right-aligned eight digit September codes out of reference column', async () => {
    const row = septRow.map(c => c[0] === 157 ? [143.7,'12345678'] as [number,string] : c)
    const result = await extract(pdf([[[[100,'REKAP PENJUALAN']],septHeader,row]]))
    expect(result.sourceRows[0]?.sourceSku).toBe('12345678')
    expect(result.sourceRows[0]?.transactionReference).toBe('SYN-002')
  })
  it('separates BJ unit at fractional PDF coordinate from quantity', async () => {
    const row = bjRow.map(c => c[0] === 450 ? [449.76,'PCS'] as [number,string] : c)
    const result = await extract(pdf([[...bjHeader,row]]))
    expect(result.sourceRows[0].quantity.decimal).toBe('2')
    expect(result.sourceRows[0].unit).toBe('PCS')
  })
  it('does not turn a product containing TOTAL into a summary or invent a price basis', async () => {
    const row = bjRow.map(c => c[0] === 183 ? [183,'SYNTHETIC TOTAL PRODUCT'] as [number,string] : c)
    const result = await extract(pdf([[...bjHeader,row]]))
    expect(result.sourceRows).toHaveLength(1)
    expect(result.sourceRows[0].priceBasisLabel).toBeNull()
  })
  it.each(['19-07-26', ''])('rejects partial extraction beside transaction with invalid/missing date %j', async date => {
    const row = bjRow.map(c => c[0] === 23 ? [23,date] as [number,string] : c)
    const result = await extract(pdf([[...bjHeader,bjRow,[[25,'ordinary decoration']],row]]))
    expect(result.sourceRows).toEqual([])
    expect(result.warnings).toContain('manual_review:malformed_transaction')
  })
  it('period_is_not_print_date', async () => {
    const result = await extract(pdf([[...bjHeader, bjRow]]))
    expect(result.periodCandidates).toEqual(['2026-08-01'])
    expect(result.sourceRows[0].transactionDate).toBe('2026-07-19')
  })
  it('encrypted_or_image_only_falls_back', async () => {
    for (const input of [new Uint8Array(readFileSync(new URL('./fixtures/encrypted.pdf',import.meta.url))), new TextEncoder().encode('%PDF-invalid'), pdf([[]]), pdf([[[[10,'unknown layout']]]])]) {
      const result = await extract(input)
      expect(result.sourceRows).toEqual([])
      expect(result.warnings.join(' ')).toMatch(/manual_review/)
    }
  })
  it('enforces byte/page bounds without partial success', async () => {
    for (const input of [new Uint8Array(10 * 1024 * 1024 + 1), pdf(Array.from({length:51}, () => [...bjHeader,bjRow]))]) {
      const result = await extract(input)
      expect(result.sourceRows).toHaveLength(0)
      expect(result.warnings.join()).toMatch(/limit/)
    }
  })
  it('does not fetch external resources and honours cancellation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'))
    await extract(pdf([[...bjHeader, bjRow]]))
    expect(fetch).not.toHaveBeenCalled()
    const controller = new AbortController(); controller.abort()
    await expect(extractPdf(pdf([[...bjHeader,bjRow]]), hash, controller.signal)).rejects.toMatchObject({name:'AbortError'})
  })
  // Controlled PDF.js text-stream boundary: avoids multi-megabyte fixture blobs and
  // makes exhaustion and teardown deterministic; the parser/grouping remains real.
  function streamDocument(lines: typeof bjHeader, pending = false) {
    const items = lines.flatMap((cells,row) => cells.map(([x,str]) => ({str,transform:[1,0,0,1,x,2_000_000-row*12]})))
    const cancel = vi.fn().mockResolvedValue(undefined)
    const reader = {read:vi.fn().mockResolvedValueOnce({done:false,value:{items}}).mockResolvedValue({done:true}),cancel,releaseLock:vi.fn()}
    if (pending) reader.read.mockReset().mockImplementation(() => new Promise(() => {}))
    const destroy = vi.fn().mockResolvedValue(undefined)
    const loading = {promise:Promise.resolve({numPages:1,getMetadata:async () => ({info:{}}),getPage:async () => ({streamTextContent:() => ({getReader:() => reader}),cleanup:vi.fn()})}),destroy}
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce(loading as unknown as ReturnType<typeof pdfjs.getDocument>)
    return {reader,destroy}
  }
  it('discards all rows at candidate transaction exhaustion', async () => {
    const source = streamDocument([...bjHeader,...Array.from({length:10_001}, () => bjRow)])
    const result = await extract(new Uint8Array([1]))
    expect(result.sourceRows).toEqual([])
    expect(result.warnings).toEqual(['manual_review:transaction_row_limit'])
    expect(source.reader.cancel).toHaveBeenCalledOnce()
    expect(source.destroy).toHaveBeenCalledOnce()
  })
  it('discards evidence at text-item exhaustion and tears down stream', async () => {
    const source = streamDocument(Array.from({length:200_001}, () => [[10,'x']]))
    const result = await extract(new Uint8Array([1]))
    expect(result.sourceRows).toEqual([])
    expect(result.warnings).toEqual(['manual_review:text_item_limit'])
    expect(source.reader.cancel).toHaveBeenCalledOnce()
    expect(source.destroy).toHaveBeenCalledOnce()
  })
  it('aborts mid-flight text reads and tears down stream and loading task', async () => {
    const source = streamDocument([],true)
    const controller = new AbortController()
    const result = extractPdf(new Uint8Array([1]),hash,controller.signal)
    const assertion = expect(result).rejects.toMatchObject({name:'AbortError'})
    await vi.waitFor(() => expect(source.reader.read).toHaveBeenCalledOnce())
    controller.abort()
    await assertion
    expect(source.reader.cancel).toHaveBeenCalledOnce()
    expect(source.reader.releaseLock).toHaveBeenCalledOnce()
    expect(source.destroy).toHaveBeenCalled()
  })

})

describe('safe layout failure eligibility does not mask unsafe later pages',()=>{
 it('rejects empty-password encrypted metadata before offering manual layout mode',async()=>{const destroy=vi.fn(async()=>{});vi.mocked(pdfjs.getDocument).mockReturnValueOnce({promise:Promise.resolve({numPages:1,getMetadata:async()=>({info:{EncryptFilterName:'Standard'}}),getPage:async()=>({streamTextContent:()=>new ReadableStream({start(c){c.close()}}),cleanup(){}})}),destroy} as any);expect((await extract(new Uint8Array([1]))).warnings).toEqual(['manual_review:invalid_or_encrypted_pdf'])});
 it('continues bounded reads after unsupported first page and fails malformed later page',async()=>{const getPage=vi.fn(async(n:number)=>{if(n===2)throw new Error('Malformed later page');return {streamTextContent:()=>new ReadableStream({start(c){c.close()}}),cleanup(){}}});vi.mocked(pdfjs.getDocument).mockReturnValueOnce({promise:Promise.resolve({numPages:2,getMetadata:async()=>({info:{}}),getPage}),destroy:async()=>{}} as any);expect((await extract(new Uint8Array([1]))).warnings).toEqual(['manual_review:invalid_or_encrypted_pdf']);expect(getPage).toHaveBeenCalledWith(2)});
});
