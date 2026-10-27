import { Fragment, memo, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type Ref } from 'react';
import type { MappingDecision, ReviewInput, ReviewValidation, SourceRef } from '../../lib/co/import/types';
import type { ImportContextSnapshot } from './useCOImportReview';
import { parseQuantity, quantityForInput } from '../../lib/co/validation';
import { Button } from '../ui/Button';
import './co-import.css';
export type ReviewTableProps = {
    input: ReviewInput;
    validation: ReviewValidation;
    onChange: (next: ReviewInput) => void;
    context?: ImportContextSnapshot | null;
    onSource?: (ref: SourceRef) => void;
    onDeclareUnit?: (stockKeyId: string, unit: string, reason: string) => void;
    disabled?: boolean;
    summaryRef?:Ref<HTMLElement>;
};
const issueText:Record<string,string>={return_prior_coverage_check_pending:'Perlu rekonsiliasi — menunggu pemeriksaan server',source_controls_required:'Pilih ulang workbook agar seluruh kontrol tercetak dapat diperiksa.',source_control_identity_mismatch:'Referensi kontrol tercetak tidak sesuai sumber.',source_control_count_mismatch:'Jumlah baris tidak sama dengan kontrol tercetak.',source_control_quantity_mismatch:'Qty sumber tidak sama dengan kontrol tercetak.',source_control_returned_mismatch:'Retur sumber tidak sama dengan kontrol tercetak.',source_control_amount_mismatch:'Total sumber tidak sama dengan kontrol tercetak.',mapping_required:'Pilih SKU Padiwan untuk baris ini.',mapping_confirmation_required:'Konfirmasikan pemetaan barang dan jumlah.',eligible_stock_key_required:'Pilih barang dari konteks toko saat ini.',eligible_unit_required:'Nyatakan atau cocokkan satuan buku.',integer_source_quantity_required:'Qty asal belum berupa bilangan bulat yang dapat dipastikan.',mapped_quantity_required:'Isi jumlah terjual dalam satuan buku.',currency_required:'Isi mata uang sumber.',completeness_required:'Konfirmasikan kelengkapan semua barang dan bagian sumber.',return_reconciliation_required:'Cocokkan retur dengan bukti pengembalian tercatat.',return_link_quantity_mismatch:'Jumlah tautan retur belum sama dengan retur sumber setelah konversi.',return_stock_impact_uncertain:'Periksa bukti retur dan dampak stok.',source_amount_mismatch:'Periksa harga, diskon, dan total pada sumber.',section_printed_total_mismatch:'Total baris tidak sama dengan total tercetak bagian sumber.',section_selection_required:'Pilih bagian sumber untuk baris yang disertakan.',exclusion_reason_required:'Jelaskan mengapa baris tidak disertakan.',invalid_eligible_unit_or_quantity:'Konteks satuan atau ketersediaan barang belum lengkap.',parser_manual_review_required:'Format sumber perlu pemeriksaan manual yang didukung.'};
const message=(issue:ReviewValidation['issues'][number])=>issueText[issue.code]??issue.message;
export default function COImportReviewTable({ input, validation, onChange, context, onSource, onDeclareUnit, disabled = false, summaryRef }: ReviewTableProps) {
    const [onlyIssues, setOnlyIssues] = useState(false), [expanded, setExpanded] = useState<string | null>(null);
    // Raw intent belongs to the source owner, not the expandable editor DOM.
    // Invalid input stays visible across collapse/filter changes but never enters the wire quantity.
    const [rawQuantities, setRawQuantities] = useState<Record<string, string>>({});
    const editors = useRef(new Map<string, HTMLFieldSetElement>());
    const [focusIssue, setFocusIssue] = useState<{rowId:string;code:string;sequence:number}|null>(null);
    useEffect(() => {
        if(!focusIssue)return;
        const editor=editors.current.get(focusIssue.rowId);
        const quantity=['mapped_quantity_required','integer_source_quantity_required','quantity_mapping_mismatch'].includes(focusIssue.code);
        const target=editor?.querySelector<HTMLElement>(quantity?'[data-co-input="quantity"]':'select,input:not([type="checkbox"]),button');
        target?.focus();
    },[focusIssue]);
    const id = useId();
    const patch = (changes: Partial<ReviewInput>) => onChange({ ...input, ...changes });
    const mapping = (rowId: string): MappingDecision => input.mappings.find(m => m.rowId === rowId) ?? { rowId, stockKeyId: null, ledgerUnit: null, quantity: null, conversion: null, included: true, exclusionReason: null, confirmed: false };
    const change = (rowId: string, p: Partial<MappingDecision>) => patch({ mappings: [...input.mappings.filter(m => m.rowId !== rowId), { ...mapping(rowId), ...p }] });
    const blocked = validation.issues.filter(i => i.blocking);
    const unitsByKey = new Map(context?.units.map(unit => [unit.stockKeyId,unit.declaration]));
    const omittedZeros = new Set(input.omittedZeroStockKeyIds);
    const omitted = context?.rows.filter(r => !input.mappings.some(m => m.included && m.stockKeyId === r.stock_key_id)) ?? [];
    // Stable row callbacks read only the latest committed owner intent. This avoids
    // reconciling every omitted control for each explicit zero without capturing
    // an old input, declaration authority, or context version.
    const current = useRef({ input, onChange, onDeclareUnit, disabled, omitted });
    useLayoutEffect(() => { current.current = { input, onChange, onDeclareUnit, disabled, omitted }; });
    const changeZero = useCallback((stockKeyId: string, checked: boolean) => {
        const latest = current.current;
        if (latest.disabled || !latest.omitted.some(row => row.stock_key_id === stockKeyId)) return;
        const zeros = latest.input.omittedZeroStockKeyIds.filter(key => key !== stockKeyId);
        latest.onChange({ ...latest.input, omittedZeroStockKeyIds: checked ? [...zeros, stockKeyId] : zeros });
    }, []);
    const declareOmitted = useCallback((stockKeyId: string, unit: string, reason: string) => {
        const latest = current.current;
        if (!latest.disabled && latest.omitted.some(row => row.stock_key_id === stockKeyId)) latest.onDeclareUnit?.(stockKeyId, unit, reason);
    }, []);
    return <div className="co-import"><section ref={summaryRef} role="region" aria-label="Hal yang perlu diperiksa" tabIndex={-1} id={`${id}-errors`} className="co-import__issues"><strong>{blocked.length ? `${blocked.length} hal menghalangi pencatatan` : 'Pemeriksaan sumber lengkap'}</strong>{blocked.length > 0 && <details open><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Lihat pemeriksaan</summary><ul>{blocked.map((issue, i) => <li key={i}><a onClick={event=>{
        if(!issue.rowId)return;
        event.preventDefault();setOnlyIssues(false);setExpanded(issue.rowId);
        setFocusIssue(value=>({rowId:issue.rowId!,code:issue.code,sequence:(value?.sequence??0)+1}));
    }} href={issue.rowId ? `#${id}-${issue.rowId}` : `#${id}-completeness`}>{message(issue)}</a></li>)}</ul></details>}</section>
 <fieldset disabled={disabled} className="co-import__sections"><legend>Bagian sumber</legend>{input.extracted.sections.map(s => <label key={s.id}><input type="checkbox" checked={input.includedSectionIds.includes(s.id)} onChange={e => patch({ includedSectionIds: e.target.checked ? [...input.includedSectionIds, s.id] : input.includedSectionIds.filter(v => v !== s.id) })}/>{s.label}</label>)}</fieldset>
 <div className="co-import__toolbar"><p>Data dari file · Harga dan total sumber adalah bukti, bukan pendapatan CO.</p><label><input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)}/>Tampilkan yang perlu diperiksa</label></div>
 <div className="co-import__scroll" role="region" aria-label="Tabel pemeriksaan laporan" tabIndex={0}><table><caption className="sr-only">Baris sumber dan keputusan penjualan</caption><thead><tr>{['SKU sumber / barang', 'SKU Padiwan / barang', 'Qty asal', 'Retur', 'Terjual', 'Satuan', 'Harga satuan laporan', 'Diskon', 'Total sumber', 'Referensi', 'Pemeriksaan'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{input.extracted.sourceRows.filter(r => !onlyIssues || validation.issues.some(i => i.rowId === r.id && i.blocking)).map(row => { const m = mapping(row.id), matched = context?.rows.find(r => r.stock_key_id === m.stockKeyId), issues = validation.issues.filter(i => i.rowId === row.id); const peers = input.extracted.sourceRows.filter(r => r.sourceSku === row.sourceSku); const diverse = new Set(peers.map(r => r.unitPrice?.decimal)).size > 1; return <Fragment key={row.id}><tr id={`${id}-${row.id}`} tabIndex={-1}><th scope="row"><span>{row.sourceSku ?? 'SKU tidak tersedia'}</span><small>{row.name}</small></th><td>{matched ? <><span>{matched.display_sku}</span><small>{matched.product_name}</small>{!m.confirmed && <small>Belum dikonfirmasi</small>}</> : m.stockKeyId ? 'Pemetaan perlu konteks terkini' : 'Belum dipetakan'}</td><td>{row.quantity.raw}</td><td>{row.returned?.raw ?? '—'}</td><td>{m.quantity ?? 'Belum ditentukan'}</td><td>{row.unit ?? 'Belum diketahui'}{m.ledgerUnit && m.ledgerUnit !== row.unit && <small>→ {m.ledgerUnit}</small>}</td><td>{row.unitPrice?.raw ?? '—'}{diverse && <details><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Beragam</summary>{peers.map(p => <p key={p.id}>{p.ref.row}: {p.unitPrice?.raw ?? '—'}</p>)}</details>}</td><td>{row.discount?.raw ?? '—'}<small>{row.discountBasis ?? ''}</small></td><td>{row.amount?.raw ?? '—'}</td><td><Button variant="quiet" size="compact" className="co-import__link" onClick={() => onSource?.(row.ref)}>{row.ref.row}</Button><small>{row.ref.sheet ?? `Hal. ${row.ref.page ?? '?'}`}</small></td><td><Button variant="quiet" size="compact" disabled={disabled} aria-expanded={expanded === row.id} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{!m.stockKeyId ? 'Pilih SKU' : !m.ledgerUnit ? 'Atur satuan' : issues.some(i => i.blocking) ? 'Periksa baris' : 'Sesuai'}</Button></td></tr>{expanded === row.id && <tr><td colSpan={11}><fieldset ref={node=>{if(node)editors.current.set(row.id,node);else editors.current.delete(row.id)}} disabled={disabled} className="co-import__editor"><legend>{row.sourceSku} · Cocokkan barang dan atur satuan</legend><label>SKU Padiwan<select className="ui-control" value={m.stockKeyId ?? ''} onChange={e => { const key = e.target.value; change(row.id, { stockKeyId: key || null, ledgerUnit: context?.units.find(u => u.stockKeyId === key)?.declaration?.unit ?? null, confirmed: false }); }}><option value="">Pilih SKU</option>{m.stockKeyId&&!context?.rows.some(r=>r.stock_key_id===m.stockKeyId)&&<option value={m.stockKeyId}>Pemetaan tersimpan · perlu konteks terkini</option>}{context?.rows.map(r => <option key={r.stock_key_id} value={r.stock_key_id}>{r.display_sku} · {r.product_name}</option>)}</select></label><label>Jumlah terjual (tidak dikurangi retur)<input className="ui-control" data-co-input="quantity" inputMode="numeric" value={rawQuantities[row.id] ?? m.quantity ?? ''} onChange={e => {
        if (disabled) return;
        const raw = e.target.value;
        setRawQuantities(values => ({ ...values, [row.id]: raw }));
        let quantity: MappingDecision['quantity'] = null;
        try { quantityForInput(raw, true); quantity = parseQuantity(raw); } catch { /* unresolved raw text is retained locally */ }
        change(row.id, { quantity, confirmed: false });
    }}/></label><details><summary className="ui-action ui-action--quiet ui-action--compact list-item cursor-pointer text-left">Atur satuan</summary><p>Satuan buku: {m.ledgerUnit ?? 'Belum dinyatakan'}. Jangan menebak satuan.</p>{!m.ledgerUnit && m.stockKeyId && onDeclareUnit && <UnitEditor onSave={(unit, reason) => onDeclareUnit(m.stockKeyId!, unit, reason)}/>}<label>Pembilang konversi<input className="ui-control" value={m.conversion?.numerator ?? ''} onChange={e => change(row.id, { conversion: { numerator: e.target.value, denominator: m.conversion?.denominator ?? '', reason: m.conversion?.reason ?? '' }, confirmed: false })}/></label><label>Penyebut konversi<input className="ui-control" value={m.conversion?.denominator ?? ''} onChange={e => change(row.id, { conversion: { numerator: m.conversion?.numerator ?? '', denominator: e.target.value, reason: m.conversion?.reason ?? '' }, confirmed: false })}/></label><label>Alasan konversi<input className="ui-control" value={m.conversion?.reason ?? ''} onChange={e => change(row.id, { conversion: { numerator: m.conversion?.numerator ?? '', denominator: m.conversion?.denominator ?? '', reason: e.target.value }, confirmed: false })}/></label><Button variant="quiet" onClick={() => change(row.id, { conversion: null, confirmed: false })}>Tanpa konversi</Button></details><label><input type="checkbox" checked={m.included} onChange={e => change(row.id, { included: e.target.checked, confirmed: false })}/>Masukkan sebagai penjualan</label>{!m.included && <label>Alasan tidak disertakan<input className="ui-control" value={m.exclusionReason ?? ''} onChange={e => change(row.id, { exclusionReason: e.target.value, confirmed: false })}/></label>}<label><input type="checkbox" checked={m.confirmed} onChange={e => change(row.id, { confirmed: e.target.checked })}/>Saya sudah memeriksa pemetaan dan jumlah ini</label>{row.flags.filter((f): f is 'formula_cache_requires_confirmation' | 'source_sku_format_requires_confirmation' => f === 'formula_cache_requires_confirmation' || f === 'source_sku_format_requires_confirmation').map(flag => <SourceCheck key={flag} flag={flag} rowId={row.id} input={input} onChange={onChange}/>)}{issues.map((issue, i) => <p key={i}>{message(issue)}</p>)}</fieldset></td></tr>}</Fragment>; })}</tbody></table></div>
 <p className="co-import__note">Retur adalah barang belum terjual yang kembali ke gudang. Tidak mengurangi Qty asal, Terjual, atau Total sumber. Import tidak membuat retur.</p>
 <fieldset disabled={disabled} id={`${id}-completeness`}><legend>Kelengkapan laporan</legend><label>Mata uang sumber<input className="ui-control" value={input.currency ?? ''} placeholder="Contoh: IDR" maxLength={3} onChange={e => patch({ currency: e.target.value.toUpperCase() || null })}/></label>{omitted.map(r => <OmittedStockRow key={r.stock_key_id} stockKeyId={r.stock_key_id} sku={r.display_sku} name={r.product_name} checked={omittedZeros.has(r.stock_key_id)} unit={unitsByKey.get(r.stock_key_id)?.unit ?? null} customerVersion={context?.context.customerVersion ?? ''} canDeclare={!!onDeclareUnit} onZero={changeZero} onDeclare={declareOmitted}/>)}<label><input type="checkbox" checked={input.completenessConfirmed} onChange={e => patch({ completenessConfirmed: e.target.checked })}/>Semua barang dan bagian sumber sudah diperiksa; barang yang tidak tercantum tidak dianggap nol otomatis</label><label>Alasan perubahan (wajib untuk Edit)<input className="ui-control" value={input.reason ?? ''} onChange={e => patch({ reason: e.target.value || null })}/></label></fieldset>
 <div className="co-import__totals">{Object.entries(validation.totalsByUnit).map(([unit, quantity]) => <span key={unit}>Terjual: {quantity} {unit}</span>)}<strong>Total sumber: {validation.sourceAmount ?? 'Belum dapat dihitung'} {input.currency ?? ''}</strong></div></div>;
}
const OmittedStockRow = memo(function OmittedStockRow({ stockKeyId, sku, name, checked, unit, customerVersion, canDeclare, onZero, onDeclare }: {
    stockKeyId: string; sku: string; name: string; checked: boolean; unit: string | null; customerVersion: string; canDeclare: boolean;
    onZero: (stockKeyId: string, checked: boolean) => void;
    onDeclare: (stockKeyId: string, unit: string, reason: string) => void;
}) {
    return <div><label><input type="checkbox" checked={checked} onChange={event => onZero(stockKeyId, event.target.checked)}/>Nol penjualan: {sku} · {name}</label><p>Satuan buku: {unit ?? 'Belum dinyatakan'}</p>{unit === null && canDeclare && <fieldset key={`${stockKeyId}:${customerVersion}`}><legend>Nyatakan satuan {sku} · {name}</legend><UnitEditor onSave={(nextUnit, reason) => onDeclare(stockKeyId, nextUnit, reason)}/></fieldset>}</div>;
});

function UnitEditor({ onSave }: {
    onSave: (unit: string, reason: string) => void;
}) { const [unit, setUnit] = useState(''), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false); return <><label>Satuan buku baru<input className="ui-control" value={unit} onChange={e => setUnit(e.target.value)}/></label><label>Dasar pernyataan satuan<input className="ui-control" value={reason} onChange={e => setReason(e.target.value)}/></label><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Saya memastikan satuan buku ini</label><Button variant="secondary" disabled={!confirmed || !unit.trim() || !reason.trim()} onClick={() => onSave(unit, reason)}>Nyatakan satuan</Button></>; }
function SourceCheck({ flag, rowId, input, onChange }: {
    flag: 'formula_cache_requires_confirmation' | 'source_sku_format_requires_confirmation';
    rowId: string;
    input: ReviewInput;
    onChange: (v: ReviewInput) => void;
}) { const value = input.sourceConfirmations?.find(c => c.rowId === rowId && c.flag === flag); const update = (p: {
    reason?: string;
    confirmed?: boolean;
}) => onChange({ ...input, sourceConfirmations: [...(input.sourceConfirmations ?? []).filter(c => c.rowId !== rowId || c.flag !== flag), { rowId, flag, reason: value?.reason ?? '', confirmed: value?.confirmed ?? false, ...p }] }); return <div><p>{flag === 'formula_cache_requires_confirmation' ? 'Periksa nilai tersimpan formula terhadap dokumen sumber' : 'Periksa format SKU sumber'}</p><label>Dasar pemeriksaan<input className="ui-control" value={value?.reason ?? ''} onChange={e => update({ reason: e.target.value, confirmed: false })}/></label><label><input type="checkbox" checked={value?.confirmed ?? false} onChange={e => update({ confirmed: e.target.checked })}/>Nilai sumber sudah diperiksa</label></div>; }
