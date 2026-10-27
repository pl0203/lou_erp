import {isCOAuthorityError} from '../../lib/co/authority';
import { useEffect, useRef, useState } from 'react';
import type { ReviewInput, SourceRow } from '../../lib/co/import/types';
import type { ImportContextSnapshot } from './useCOImportReview';
import { fetchCompleteCOReturn } from '../../lib/co/rpc';
import { readReturnCandidates } from '../../lib/co/import/rpc';
import type { ReturnCandidate } from '../../lib/co/import/returnCandidates';
import { parseQuantity } from '../../lib/co/validation';
import { useCOActor, useCORead, COFailure } from './COShared';
import { Button } from '../ui/Button';
import COReturnDialog from './COReturnDialog';
export default function COReturnReconciliation({ input, onChange, context, onRefresh, disabled = false, onAuthorityFailure }: {
    input: ReviewInput;
    onChange: (v: ReviewInput) => void;
    context?: ImportContextSnapshot | null;
    onRefresh?: () => Promise<void>;
    disabled?: boolean;
    onAuthorityFailure?: (e: unknown) => void;
}) {
    const [open, setOpen] = useState(false), [record, setRecord] = useState<ImportContextSnapshot | null>(null);
    const trigger = useRef<HTMLElement | null>(null);
    const pin = JSON.stringify([context?.scope, context?.context]);
    const rows = input.extracted.sourceRows.filter(r => r.returned && r.returned.decimal !== '0');
    return <section className="co-import"><Button variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open}>Cocokkan retur ({rows.length})</Button>{open && <><p>Retur tetap transaksi terpisah. Pilih bukti retur yang sudah tercatat; tautan tidak dibuat otomatis.</p><Button variant="secondary" disabled={disabled || !context} onClick={() => { trigger.current = document.activeElement as HTMLElement; setRecord(context??null); }}>Catat retur terpisah</Button>{rows.map(row => { const key = input.mappings.find(m => m.rowId === row.id)?.stockKeyId; return context && key ? <ReturnRow key={`${pin}:${row.id}:${key}`} row={row} stockKeyId={key} input={input} context={context} onChange={onChange} disabled={disabled} onAuthorityFailure={onAuthorityFailure}/> : <p key={row.id}>{row.sourceSku} · {row.ref.row}: cocokkan SKU dan muat konteks sebelum memilih retur.</p>; })}</>}{record && <COReturnDialog customerId={input.scope.customerId} customerVersion={record.context.customerVersion} blocked={disabled} requireActualDate returnFocus={trigger.current} onAuthorityFailure={onAuthorityFailure} onClose={() => setRecord(null)} onSaved={receipt => { if(receipt.operation==='save_return_draft')return;setRecord(null); onChange({ ...input, returns: input.returns.map(r => ({ ...r, state: 'unresolved', stockImpact: 'uncertain', links: [] })) }); void onRefresh?.(); }}/>}</section>;
}
function ReturnRow({ input, row, stockKeyId, context, onChange, disabled, onAuthorityFailure }: {
    input: ReviewInput;
    row: SourceRow;
    stockKeyId: string;
    context: ImportContextSnapshot;
    onChange: (v: ReviewInput) => void;
    disabled: boolean;
    onAuthorityFailure?: (e: unknown) => void;
}) {
    const actor = useCOActor(`import-return-candidates:${JSON.stringify(context.scope)}:${context.context.customerVersion}:${stockKeyId}`);
    const [page, setPage] = useState(1), [selected, setSelected] = useState<(ReturnCandidate & {readGeneration:number}) | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<unknown>(null);
    const generation = useRef(0), selecting = useRef(false);
    const latest = useRef({input,disabled}); latest.current={input,disabled};
    useEffect(() => () => { generation.current++; }, []);
    const args = { customerId: input.scope.customerId, stockKeyId, version: context.context.customerVersion, page };
    const candidates = useCORead(actor, 'import-return-candidates', args, o => readReturnCandidates(args.customerId, stockKeyId, args.version, page, o), !disabled);
    useEffect(()=>{if(actor.isCurrent()&&isCOAuthorityError(candidates.error))onAuthorityFailure?.(candidates.error)},[candidates.error,actor.scope,onAuthorityFailure]);
    async function choose(candidate: ReturnCandidate) { if(!canChange())return; const g = ++generation.current; selecting.current=true; setPending(true); setSelected(null); setError(null); const live = () => actor.isCurrent() && generation.current === g; try {
        const canonical = await fetchCompleteCOReturn({ p_customer_id: input.scope.customerId, p_target_id: candidate.headId, p_view: 'effective', p_expected_customer_version: context.context.customerVersion, p_expected_draft_version: null }, { isCurrent: live });
        if (!live())
            return;
        const qty = canonical.lines.filter(l => l.stock_key_id === stockKeyId).reduce((sum, l) => sum + BigInt(l.quantity), 0n).toString();
        if (canonical.header.is_void || canonical.header.customer_id !== input.scope.customerId || canonical.header.revision_id !== candidate.revisionId || canonical.header.return_date !== candidate.date || canonical.header.head_version !== candidate.version || qty !== candidate.quantity)
            throw new Error('Bukti retur berubah. Muat konteks terbaru.');
        setSelected({...candidate,readGeneration:g});
    }
    catch (e) {
        if (live()) {
            setError(e);
            actor.rejectAuthority(e);
            onAuthorityFailure?.(e);
        }
    }
    finally {
        if (live()) { selecting.current=false; setPending(false); }
    } }
    function canChange() {
        const current=latest.current.input;
        return actor.isCurrent()&&!latest.current.disabled&&!selecting.current
          && current.scope.actorId===context.scope.actorId&&current.scope.customerId===context.scope.customerId
          && current.scope.reportMonth===context.scope.reportMonth&&current.scope.epoch===context.scope.epoch
          && current.mappings.find(mapping=>mapping.rowId===row.id)?.stockKeyId===stockKeyId;
    }
    function confirmLink(quantity:ReturnType<typeof parseQuantity>,note:string) {
        if(!canChange()||!selected||generation.current!==selected.readGeneration)return;
        const current=latest.current.input, existing=current.returns.find(decision=>decision.rowId===row.id);
        const links=[...(existing?.links??[]).filter(link=>link.returnRevisionId!==selected.revisionId),{returnRevisionId:selected.revisionId,quantity,confirmation:{physicalReturnDate:selected.date,basis:'selected_existing_return_evidence' as const,confirmed:true,note}}];
        onChange({...current,returns:[...current.returns.filter(decision=>decision.rowId!==row.id),{rowId:row.id,state:'linked',stockImpact:'clear',note,links}]});
        setSelected(null);
    }
    function removeLink(revisionId:string) {
        if(!canChange())return;
        const current=latest.current.input,existing=current.returns.find(decision=>decision.rowId===row.id);
        if(!existing)return;
        const links=existing.links.filter(link=>link.returnRevisionId!==revisionId);
        onChange({...current,returns:[...current.returns.filter(decision=>decision.rowId!==row.id),{...existing,links,state:links.length?'linked':'unresolved',stockImpact:links.length?'clear':'uncertain'}]});
        setSelected(null); generation.current++;
    }
    const decision = input.returns.find(r => r.rowId === row.id);
    const cited = (revision: string) => input.returns.filter(d => d.rowId !== row.id && input.mappings.find(m=>m.rowId===d.rowId)?.stockKeyId===stockKeyId).flatMap(d => d.links).filter(l => l.returnRevisionId === revision).reduce((sum, l) => sum + BigInt(l.quantity), 0n).toString();
    return <fieldset disabled={disabled || pending}><legend>{row.sourceSku} · {row.ref.row} · retur sumber {row.returned?.raw}</legend>{(error || candidates.error) && <COFailure error={error || candidates.error}/>}<label>Retur tercatat untuk SKU ini<select className="ui-control" value={selected?.revisionId ?? ''} onChange={e => { const candidate = candidates.data?.rows.find(r => r.revisionId === e.target.value); if (candidate)
        void choose(candidate); }}><option value="">Pilih bukti tanggal / jumlah retur</option>{candidates.data?.rows.map(c => <option key={c.revisionId} value={c.revisionId}>{c.date} · {c.reference ?? 'Tanpa referensi'} · {c.displaySku} · {c.quantity} {c.unit ?? '(satuan belum diketahui)'}</option>)}</select></label>{candidates.isFetching && <p>Memuat bukti retur…</p>}{candidates.data?.total === '0' && <p>Belum ada retur tercatat untuk SKU ini.</p>}<div><Button variant="quiet" disabled={page === 1 || candidates.isFetching} onClick={() => { setSelected(null); setPage(page - 1); }}>Sebelumnya</Button><Button variant="quiet" disabled={!candidates.data || BigInt(page * 25) >= BigInt(candidates.data.total) || candidates.isFetching} onClick={() => { setSelected(null); setPage(page + 1); }}>Berikutnya</Button></div>{selected && <><p>Bukti kanonis: {selected.date} · {selected.reference ?? 'Tanpa referensi'} · {selected.quantity} {selected.unit ?? 'satuan belum diketahui'}. Dikutip baris lain di pemeriksaan ini: {cited(selected.revisionId)}. Ini bukan pengurangan kapasitas retur global.</p><ReturnLink key={selected.revisionId} available={selected.quantity} onConfirm={confirmLink}/></>}<Button variant="secondary" onClick={()=>{if(!canChange())return;const current=latest.current.input;onChange({...current,returns:[...current.returns.filter(r=>r.rowId!==row.id),{rowId:row.id,state:'unresolved',stockImpact:'uncertain',links:[],note:'Meminta pemeriksaan server atas cakupan retur terdahulu; belum dicocokkan manusia.'}]});}}>Periksa cakupan retur terdahulu</Button><p>Pilih bukti berbeda untuk menambah tautan; pilih bukti yang sama untuk memperbarui jumlah atau catatannya. Tidak perlu memecah baris sumber.</p>{!!decision?.links.length&&<><ul aria-label="Bukti retur yang dicocokkan">{decision.links.map(link=><li key={link.returnRevisionId}><span>{link.confirmation?.physicalReturnDate??'Tanggal belum dikonfirmasi'} · {link.quantity} {input.mappings.find(mapping=>mapping.rowId===row.id)?.ledgerUnit??'satuan belum diketahui'} · {link.confirmation?.note}</span><Button variant="quiet" size="compact" onClick={()=>removeLink(link.returnRevisionId)} aria-label={`Hapus tautan retur ${link.confirmation?.physicalReturnDate??link.returnRevisionId}`}>Hapus tautan</Button></li>)}</ul><p>Total dicocokkan: {decision.links.reduce((sum,link)=>sum+BigInt(link.quantity),0n).toString()} {input.mappings.find(mapping=>mapping.rowId===row.id)?.ledgerUnit??'satuan belum diketahui'}</p></>}<p>{decision?.state === 'linked'  ? 'Bukti dipilih; server masih memverifikasi kesesuaian dan dampak stok.' : 'Perlu rekonsiliasi — menunggu pemeriksaan server. Tanpa cakupan retur tercatat yang terverifikasi, pencatatan tetap terhalang.'}</p></fieldset>;
}
function ReturnLink({ available, onConfirm }: {
    available: string;
    onConfirm: (quantity: ReturnType<typeof parseQuantity>, note: string) => void;
}) { const [raw, setRaw] = useState(''), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false); let quantity: ReturnType<typeof parseQuantity> | null = null; try {
    quantity = parseQuantity(raw);
    if (BigInt(quantity) > BigInt(available) || quantity === '0')
        quantity = null;
}
catch { /* unresolved */ } return <><label>Jumlah yang dicocokkan<input className="ui-control" value={raw} onChange={e => { setRaw(e.target.value); setConfirmed(false); }} inputMode="numeric"/></label><label>Dasar pencocokan<input className="ui-control" value={note} onChange={e => { setNote(e.target.value); setConfirmed(false); }}/></label><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Tanggal, barang dan jumlah retur fisik sesuai bukti terpilih</label><Button variant="secondary" disabled={!confirmed || !quantity || !note.trim()} onClick={() => onConfirm(quantity!, note)}>Konfirmasi tautan retur</Button></>; }
