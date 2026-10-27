import { sourceControlIssues } from './sourceControls';
import { isManualTranscription } from './manualPolicy';
import type { ReviewInput, ReviewValidation, SourceRow } from './types'
import type { Quantity, SignedQuantity } from '../contracts'
import { parseMonth, parseQuantity, minorUnits } from '../validation'
import { sourceMoney, summarizeSource } from './normalize'

/** Client readiness only. Server preview/commit must independently verify the entire manifest. */
export function validateReview(input:ReviewInput, eligible:{stockKeyId:string;unit:string;available:Quantity|SignedQuantity|null}[]):ReviewValidation {
  const issues:ReviewValidation['issues']=[]
  const issue=(code:string,rowId:string|null=null,blocking=true)=>issues.push({code,rowId,message:code,blocking})
  const quantity=(text:string|null|undefined):bigint|null=>{
    try { return BigInt(parseQuantity(text)) } catch { return null }
  }
  const unique=(values:string[])=>new Set(values).size===values.length
  try {parseMonth(input.scope.reportMonth)} catch {issue('invalid_report_month')}
  if (!input.scope.customerId || !input.scope.actorId || !Number.isSafeInteger(input.scope.epoch) || input.scope.epoch<0) issue('invalid_scope')
  if (input.extracted.periodCandidates.some(month=>month!==input.scope.reportMonth)) issue('period_mismatch')
  if (!input.currency || !/^[A-Z]{3}$/.test(input.currency)) issue('currency_required')
  if (!input.completenessConfirmed) issue('completeness_required')
  if (!unique(eligible.map(item=>item.stockKeyId))) issue('duplicate_eligible_key')
  const keys=new Map(eligible.map(item=>[item.stockKeyId,item]))
  for (const item of eligible) if (!item.stockKeyId || !item.unit?.trim() || quantity(item.available)===null) issue('invalid_eligible_unit_or_quantity')
  if (input.extracted.warnings.some(w=>w.startsWith('manual_review:')) && !isManualTranscription(input.extracted)) issue('parser_manual_review_required')
  for (const code of sourceControlIssues(input.extracted)) issue(code)
  const rows=input.extracted.sourceRows
  const rowIds=new Set(rows.map(row=>row.id))
  if (rowIds.size!==rows.length) issue('duplicate_source_identity')
  const sections=new Map(input.extracted.sections.map(section=>[section.id,section]))
  if (sections.size!==input.extracted.sections.length || !unique(input.includedSectionIds) || input.includedSectionIds.some(id=>!sections.has(id))) issue('invalid_sections')
  // Section controls describe original source coverage, not the later mapped/excluded subtotal.
  const sourceById=new Map(rows.map(row=>[row.id,row]))
  const membershipCounts=new Map<string,number>()
  for (const section of input.extracted.sections) {
    if (!unique(section.rowIds)) issue('duplicate_section_membership')
    for (const rowId of section.rowIds) {
      membershipCounts.set(rowId,(membershipCounts.get(rowId)??0)+1)
      const row=sourceById.get(rowId)
      if (!row || row.ref.section!==section.id) issue('invalid_section_membership',rowId)
    }
    if (!input.includedSectionIds.includes(section.id) || section.printedTotal===null) continue
    const printed=sourceMoney(section.printedTotal)
    if (printed===null) {issue('unresolved_section_printed_total');continue}
    let sum=0n
    let resolved=true
    for (const rowId of section.rowIds) {
      const row=sourceById.get(rowId)
      const amount=row?sourceMoney(row.amount):null
      if (amount===null) resolved=false
      else sum+=minorUnits(amount)
      if (row?.currency!==null && row?.currency!==undefined && row.currency!==input.currency) issue('section_source_currency_mismatch',rowId)
    }
    if (!resolved) issue('unresolved_section_source_amount')
    else if (sum!==minorUnits(printed)) issue('section_printed_total_mismatch')
  }
  for (const row of rows) if (membershipCounts.get(row.id)!==1) issue('source_section_membership_required',row.id)
  if (!unique(input.mappings.map(m=>m.rowId)) || input.mappings.some(m=>!rowIds.has(m.rowId))) issue('invalid_mapping_identity')
  if (!unique(input.returns.map(r=>r.rowId)) || input.returns.some(r=>!rowIds.has(r.rowId))) issue('invalid_return_identity')
  const confirmations=input.sourceConfirmations??[]
  if (!unique(confirmations.map(c=>`${c.rowId}:${c.flag}`)) || confirmations.some(c=>!rowIds.has(c.rowId)||!rows.find(r=>r.id===c.rowId)?.flags.includes(c.flag))) issue('invalid_source_confirmation')
  if (!unique(input.omittedZeroStockKeyIds) || input.omittedZeroStockKeyIds.some(id=>!keys.has(id))) issue('invalid_zero_confirmation')
  const sums=new Map<string,bigint>()
  const included:SourceRow[]=[]
  for (const row of rows) {
    const mapping=input.mappings.find(item=>item.rowId===row.id)
    if (row.ref.fileSha256!==input.extracted.sha256 || !sections.get(row.ref.section)?.rowIds.includes(row.id)) issue('source_identity_mismatch',row.id)
    if (!mapping) {issue('mapping_required',row.id);continue}
    if (!mapping.confirmed) issue('mapping_confirmation_required',row.id)
    if (!mapping.included) {
      if (row.returned?.decimal!=='0' && row.returned!==null || input.returns.some(d=>d.rowId===row.id&&(d.state==='unresolved'||d.stockImpact==='uncertain'))) issue('return_reconciliation_required',row.id)
      if (!mapping.exclusionReason?.trim()) issue('exclusion_reason_required',row.id)
      continue
    }
    included.push(row)
    if (!input.includedSectionIds.includes(row.ref.section)) issue('section_selection_required',row.id)
    const key=mapping.stockKeyId?keys.get(mapping.stockKeyId):undefined
    if (!key) issue('eligible_stock_key_required',row.id)
    if (!mapping.ledgerUnit?.trim() || !key?.unit?.trim() || mapping.ledgerUnit!==key.unit) issue('eligible_unit_required',row.id)
    const sourceQuantity=quantity(row.quantity.decimal)
    if (sourceQuantity===null) issue('integer_source_quantity_required',row.id)
    const mappedQuantity=quantity(mapping.quantity)
    if (mappedQuantity===null) issue('mapped_quantity_required',row.id)
    let expected=sourceQuantity
    if (mapping.conversion) {
      const n=quantity(mapping.conversion.numerator),d=quantity(mapping.conversion.denominator)
      if (n===null || d===null || n===0n || d===0n || !mapping.conversion.reason.trim() || !row.unit) {issue('invalid_conversion',row.id);expected=null}
      else if (sourceQuantity!==null) {
        if (sourceQuantity*n%d!==0n) {issue('nonintegral_conversion',row.id);expected=null}
        else expected=sourceQuantity*n/d
      }
    } else if (row.unit!==null && row.unit!==mapping.ledgerUnit) issue('unit_conversion_required',row.id)
    // A missing source unit is resolved only by the explicit confirmed manual mapping.
    if (expected!==null && mappedQuantity!==expected) issue('quantity_mapping_mismatch',row.id)
    if (key && mappedQuantity!==null) sums.set(key.stockKeyId,(sums.get(key.stockKeyId)??0n)+mappedQuantity)
    if (row.currency!==null && row.currency!==input.currency) issue('source_currency_mismatch',row.id)
    for (const value of [row.unitPrice,row.discount,row.netUnitPrice,row.amount]) if (value!==null && sourceMoney(value)===null) issue('unresolved_source_money',row.id)
    if (row.amount===null) issue('source_amount_required',row.id)
    const discount=sourceMoney(row.discount)
    if (discount!==null && minorUnits(discount)!==0n && (!row.discountBasis || row.discountBasis==='unknown')) issue('discount_basis_required',row.id)
    const price=sourceMoney(row.unitPrice), amount=sourceMoney(row.amount)
    if (sourceQuantity!==null && price!==null && amount!==null && (row.discount===null || discount!==null)) {
      let expectedAmount=sourceQuantity*minorUnits(price)
      const d=discount===null?0n:minorUnits(discount)
      let arithmeticKnown=true
      if (d!==0n) {
        if (row.discountBasis==='line_amount') expectedAmount-=d
        else if (row.discountBasis==='unit_amount') expectedAmount-=sourceQuantity*d
        else if (row.discountBasis==='percent' && d<=10000n && expectedAmount*(10000n-d)%10000n===0n) expectedAmount=expectedAmount*(10000n-d)/10000n
        else arithmeticKnown=false
      }
      if (arithmeticKnown && expectedAmount!==minorUnits(amount)) issue('source_amount_mismatch',row.id)
      if (!arithmeticKnown && row.discountBasis==='percent') issue('inexact_discount_arithmetic',row.id)
    }
    for (const flag of row.flags) {
      if (flag==='formula_cache_requires_confirmation'||flag==='source_sku_format_requires_confirmation') {
        if (!confirmations.some(c=>c.rowId===row.id&&c.flag===flag&&c.confirmed&&c.reason.trim())) issue(flag,row.id)
      } else if (!['unit_missing','section_scope_requires_review','discount_basis_unknown','currency_requires_confirmation','return_reconciliation_required'].includes(flag) && !flag.startsWith('source_sku_raw:')) issue('unsafe_source_flag',row.id)
    }
    const returned=row.returned===null?0n:quantity(row.returned.decimal)
    const decision=input.returns.find(item=>item.rowId===row.id)
    if (returned===null) issue('integer_return_quantity_required',row.id)
    else if (returned>0n) {
      if (decision?.state==='unresolved' && decision.stockImpact==='uncertain' && !decision.links.length) issue('return_prior_coverage_check_pending',row.id)
      else if (!decision || decision.state!=='linked') issue('return_reconciliation_required',row.id)
      else {
        let linked=0n
        if (!decision.links.length || !unique(decision.links.map(link=>link.returnRevisionId))) issue('invalid_return_links',row.id)
        for (const link of decision.links) {
          const q=quantity(link.quantity)
          if (!link.returnRevisionId.trim() || q===null || q===0n) issue('invalid_return_links',row.id)
          else linked+=q
        }
        let ledgerReturned:bigint|null=returned
        if (mapping.conversion) {
          const n=quantity(mapping.conversion.numerator),d=quantity(mapping.conversion.denominator)
          if (n===null || d===null || n===0n || d===0n || returned*n%d!==0n) {
            ledgerReturned=null
            issue('nonintegral_return_conversion',row.id)
          } else ledgerReturned=returned*n/d
        }
        if (ledgerReturned!==null && linked!==ledgerReturned) issue('return_link_quantity_mismatch',row.id)
        // stockImpact is a client claim, not clearance. Server must verify links and capacity.
        if (decision.stockImpact==='uncertain') issue('return_stock_impact_uncertain',row.id)
        issue('return_server_verification_required',row.id,false)
      }
    } else if (decision && (decision.state!=='none'||decision.links.length)) issue('unexpected_return_decision',row.id)
  }
  for (const id of input.omittedZeroStockKeyIds) {
    if (sums.has(id)) issue('zero_confirmation_conflicts_with_rows')
    else if (keys.has(id)) sums.set(id,0n)
  }
  for (const key of eligible) {
    const sum=sums.get(key.stockKeyId)
    if (sum===undefined) issue('omitted_sku_requires_zero')
    else {const available=quantity(key.available);if (available!==null&&sum>available) issue('quantity_exceeds_available')}
  }
  if (!rows.length && !input.omittedZeroStockKeyIds.length) issue('empty_review')
  const quantities=[...sums].map(([stockKeyId,q])=>({stockKeyId,quantity:parseQuantity(q.toString())}))
  const totalsByUnit:Record<string,Quantity>=Object.create(null)
  for (const [id,q] of sums) {const unit=keys.get(id)?.unit;if(unit) totalsByUnit[unit]=parseQuantity((BigInt(totalsByUnit[unit]??'0')+q).toString())}
  // The chosen review currency supplies missing source currency, without mutating evidence.
  const sourceAmount=summarizeSource(included.map(row=>({...row,currency:row.currency??input.currency}))).amount
  return {issues,quantities,totalsByUnit,sourceAmount,canConfirm:!issues.some(issue=>issue.blocking),canRequestServerCheck:issues.some(issue=>issue.code==='return_prior_coverage_check_pending')&&!issues.some(issue=>issue.blocking&&issue.code!=='return_prior_coverage_check_pending')}
}
