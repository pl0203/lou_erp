import { useState } from 'react';
import type { ExtractedReport, SourceNumberConvention, SourceRow, ManualPrintedControls } from '../../lib/co/import/types';
import { canTranscribeSource, type ManualSourceInput } from '../../lib/co/import/manual';
import { normalizeSourceNumber } from '../../lib/co/import/decimal';
import COSourcePreview from './COSourcePreview';
import { Button } from '../ui/Button';

type Entry = {
    sheet: string; page: string; row: string; section: string; sku: string; name: string;
    quantity: string; returned: string; unit: string; price: string; discount: string;
    basis: SourceRow['discountBasis']; amount: string; date: string; reference: string;
};
type ControlEntry = {
    sheet: string; row: string; section: string; coverage: number[];
    count: string | null; quantity: string | null; returned: string | null; amount: string | null;
};
const blank = (): Entry => ({ sheet: '', page: '', row: '', section: '', sku: '', name: '', quantity: '', returned: '', unit: '', price: '', discount: '', basis: null, amount: '', date: '', reference: '' });
const metrics = ['count', 'quantity', 'returned', 'amount'] as const;
const rowFields = [
    ['page', 'Halaman'], ['row', 'Nomor / label baris fisik'], ['section', 'Bagian sumber'],
    ['sku', 'SKU sumber'], ['name', 'Nama barang'], ['quantity', 'Qty asal'], ['returned', 'Retur'],
    ['unit', 'Satuan sumber'], ['price', 'Harga satuan laporan'], ['discount', 'Diskon'],
    ['amount', 'Total sumber'], ['date', 'Tanggal transaksi (YYYY-MM-DD)'], ['reference', 'Referensi transaksi'],
] as const;
type Props = { original: ExtractedReport; file: File; onTranscribe: (p: ManualSourceInput) => void; disabled: boolean };

function ManualForm({ original, file, onTranscribe, disabled }: Props) {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<Entry[]>([blank()]);
    const [convention, setConvention] = useState<SourceNumberConvention | null>(null);
    const [reason, setReason] = useState('');
    const [confirm, setConfirm] = useState(false);
    const [error, setError] = useState('');
    const [totals, setTotals] = useState<Record<string, string>>({});
    const [reviewedSheets, setReviewedSheets] = useState<string[]>([]);
    const [controls, setControls] = useState<ControlEntry[]>([]);
    const xlsx = original.format === 'xlsx';
    if (!canTranscribeSource(original)) return <p>
        Entri ulang tidak tersedia untuk kegagalan ini. XLSX manual hanya mendukung workbook nilai tanpa formula,
        sistem tanggal 1900, dengan semua sheet berformat tidak dikenali. Campuran sheet otomatis/manual,
        sistem 1904, dan sumber tidak aman tidak didukung. Batas keamanan tidak dapat dilewati.
    </p>;
    const sheetNames = original.manualWorkbook?.sheets.map(s => s.name) ?? [];
    const changeRow = (index: number, patch: Partial<Entry>) => {
        setRows(old => old.map((r, i) => i === index ? { ...r, ...patch } : r));
        setConfirm(false);
    };
    const changeControl = (index: number, patch: Partial<ControlEntry>) => {
        setControls(old => old.map((c, i) => i === index ? { ...c, ...patch } : c));
        setConfirm(false);
    };
    function submit() {
        try {
            const number = (raw: string) => convention === null ? { raw, decimal: null } : normalizeSourceNumber(raw, convention === 'decimal_comma' ? ',' : '.');
            const sourceRows: SourceRow[] = rows.map(r => {
                if ((!xlsx && !/^[1-9][0-9]*$/.test(r.page)) || (xlsx && !r.sheet) || !r.row.trim() || !r.section.trim() || !r.name.trim())
                    throw new Error('Isi halaman/sheet, baris fisik, bagian, dan nama untuk setiap baris.');
                const ref = { fileSha256: original.sha256, page: xlsx ? null : Number(r.page), sheet: xlsx ? r.sheet : null, row: r.row, section: r.section };
                return {
                    id: `${original.sha256}:${xlsx ? r.sheet : 'p' + r.page}:${r.row}:${r.section}`, ref,
                    sourceSku: r.sku || null, name: r.name, transactionDate: r.date || null, transactionReference: r.reference || null,
                    quantity: number(r.quantity), returned: r.returned ? number(r.returned) : null, unit: r.unit || null,
                    unitPrice: r.price ? number(r.price) : null, discount: r.discount ? number(r.discount) : null,
                    discountBasis: r.basis, netUnitPrice: null, amount: r.amount ? number(r.amount) : null,
                    currency: null, priceBasisLabel: null, flags: [],
                };
            });
            const sections = [...new Set(rows.map(r => r.section))].map(id => ({
                id, label: id, rowIds: sourceRows.filter(r => r.ref.section === id).map(r => r.id),
                printedTotal: totals[id] ? number(totals[id]) : null,
            }));
            let manualPrintedControls: ManualPrintedControls | undefined;
            if (xlsx) {
                if (!confirm || sheetNames.some(s => !reviewedSheets.includes(s)))
                    throw new Error('Periksa semua sheet dan kontrol tercetak, termasuk metrik yang tidak tercantum.');
                manualPrintedControls = {
                    version: 2, reviewedSheets: sheetNames, confirmed: true,
                    controls: controls.map(c => ({
                        ref: { fileSha256: original.sha256, page: null, sheet: c.sheet, row: c.row, section: c.section },
                        rowIds: c.coverage.map(i => sourceRows[i]?.id),
                        count: c.count === null ? null : number(c.count), quantity: c.quantity === null ? null : number(c.quantity),
                        returned: c.returned === null ? null : number(c.returned), amount: c.amount === null ? null : number(c.amount),
                    })),
                };
            }
            onTranscribe({ sourceRows, sections, periodCandidates: [], customerCandidates: [], reason, confirmed: true, ...(manualPrintedControls ? { manualPrintedControls } : {}) });
        } catch (e) { setError(e instanceof Error ? e.message : 'Periksa isian sumber.'); }
    }
    const last = rows.at(-1);
    const selectedRef = xlsx && last?.sheet
        ? { fileSha256: original.sha256, page: null, sheet: last.sheet, row: last.row, section: last.section }
        : last?.page ? { fileSha256: original.sha256, page: Number(last.page), sheet: null, row: last.row, section: last.section } : null;
    return <section>
        <Button variant="secondary" disabled={disabled} onClick={() => setOpen(!open)}>Transkripsikan sumber secara manual</Button>
        {open && <div className="co-import__manual-layout">
            <fieldset disabled={disabled}>
                <legend>Salin baris fisik dari {xlsx ? 'XLSX' : 'PDF'}</legend>
                <p>Ini pernyataan manusia, bukan ekstraksi berhasil. Jangan menebak angka, baris, satuan, atau tanggal. Semua pemetaan, retur, dan kelengkapan tetap diperiksa.</p>
                <label>Konvensi angka<select className="ui-control" value={convention ?? ''} onChange={e => { setConvention((e.target.value || null) as SourceNumberConvention | null); setConfirm(false); }}>
                    <option value="">Belum diketahui (angka tetap belum terselesaikan)</option>
                    <option value="decimal_dot">Desimal titik; ribuan koma</option><option value="decimal_comma">Desimal koma; ribuan titik</option>
                </select></label>
                {rows.map((r, index) => <fieldset key={index} className="co-import__editor">
                    <legend>Baris fisik {index + 1}</legend>
                    {xlsx && <label>Sheet sumber<select className="ui-control" value={r.sheet} onChange={e => changeRow(index, { sheet: e.target.value })}>
                        <option value="">Pilih sheet asli</option>{sheetNames.map(name => <option key={name}>{name}</option>)}
                    </select></label>}
                    {rowFields.filter(([key]) => !xlsx || key !== 'page').map(([key, label]) => <label key={key}>{label}
                        <input className="ui-control" maxLength={key === 'row' ? 32 : key === 'section' ? 64 : 512} value={r[key]} onChange={e => changeRow(index, { [key]: e.target.value })}/>
                    </label>)}
                    <label>Dasar diskon<select className="ui-control" value={r.basis ?? ''} onChange={e => changeRow(index, { basis: (e.target.value || null) as SourceRow['discountBasis'] })}>
                        <option value="">Tidak tercantum</option><option value="unknown">Belum diketahui</option>
                        <option value="line_amount">Nilai per baris</option><option value="unit_amount">Nilai per satuan</option><option value="percent">Persen</option>
                    </select></label>
                </fieldset>)}
                <Button variant="quiet" disabled={rows.length >= 100} onClick={() => { setRows([...rows, blank()]); setConfirm(false); }}>Tambah baris fisik</Button>
                {[...new Set(rows.map(r => r.section).filter(Boolean))].map(section => <label key={section}>
                    Total tercetak bagian {section} (kosong hanya bila tidak tercantum)
                    <input className="ui-control" value={totals[section] ?? ''} onChange={e => { setTotals({ ...totals, [section]: e.target.value }); setConfirm(false); }}/>
                </label>)}
                {xlsx && <fieldset>
                    <legend>Kontrol tercetak dan pemeriksaan semua sheet</legend>
                    <p>Tambahkan setiap total tercetak. Pilih baris yang benar-benar dicakup; pengecualian penjualan tidak mengubah cakupan.
                        Metrik tidak tercantum berbeda dari angka belum terselesaikan. Tanpa kontrol berarti Anda memeriksa dan tidak menemukan kontrol.</p>
                    {sheetNames.map(name => <label key={name}><input type="checkbox" checked={reviewedSheets.includes(name)} onChange={e => {
                        setReviewedSheets(old => e.target.checked ? [...old, name] : old.filter(n => n !== name)); setConfirm(false);
                    }}/>Sheet diperiksa: {name}</label>)}
                    {controls.map((c, index) => <fieldset key={index}>
                        <legend>Kontrol tercetak {index + 1}</legend>
                        <label>Sheet kontrol<select className="ui-control" value={c.sheet} onChange={e => changeControl(index, { sheet: e.target.value, coverage: [] })}>
                            <option value="">Pilih sheet asli</option>{sheetNames.map(name => <option key={name}>{name}</option>)}
                        </select></label>
                        {(['row', 'section'] as const).map(key => <label key={key}>{key === 'row' ? 'Baris fisik kontrol (rN)' : 'Label bagian kontrol'}
                            <input className="ui-control" maxLength={256} value={c[key]} onChange={e => changeControl(index, { [key]: e.target.value })}/>
                        </label>)}
                        {metrics.map(metric => <div key={metric}>
                            <label><input type="checkbox" checked={c[metric] !== null} onChange={e => changeControl(index, { [metric]: e.target.checked ? '' : null })}/>{metric} tercantum</label>
                            {c[metric] !== null && <label>Angka kontrol {metric}
                                <input className="ui-control" maxLength={512} value={c[metric]} onChange={e => changeControl(index, { [metric]: e.target.value })}/>
                            </label>}
                        </div>)}
                        <p>Baris fisik yang dicakup kontrol ini:</p>
                        {rows.map((r, i) => r.sheet === c.sheet && <label key={i}>
                            <input type="checkbox" checked={c.coverage.includes(i)} onChange={e => changeControl(index, { coverage: e.target.checked ? [...c.coverage, i] : c.coverage.filter(n => n !== i) })}/>
                            {r.sheet}/{r.row} · {r.name || `Baris ${i + 1}`}
                        </label>)}
                        <Button variant="quiet" onClick={() => { setControls(old => old.filter((_, i) => i !== index)); setConfirm(false); }}>Hapus kontrol {index + 1}</Button>
                    </fieldset>)}
                    <Button variant="quiet" disabled={controls.length >= 1000} onClick={() => {
                        setControls(old => [...old, { sheet: '', row: '', section: '', coverage: [], count: null, quantity: null, returned: null, amount: null }]); setConfirm(false);
                    }}>Tambah kontrol tercetak</Button>
                </fieldset>}
                <label>Alasan transkripsi<input className="ui-control" maxLength={2000} value={reason} onChange={e => { setReason(e.target.value); setConfirm(false); }}/></label>
                <label><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)}/>
                    {xlsx ? 'Saya memeriksa semua sheet, setiap baris, semua kontrol tercetak, cakupan dan metrik tidak tercantum terhadap file asli'
                        : 'Saya memeriksa setiap halaman, bagian, baris fisik dan angka terhadap file asli'}
                </label>
                {error && <p role="alert">{error}</p>}
                <Button variant="secondary" disabled={!confirm || !reason.trim()} onClick={submit}>Gunakan transkripsi manusia untuk pemeriksaan</Button>
            </fieldset>
            <COSourcePreview file={file} selectedRef={selectedRef}/>
        </div>}
    </section>;
}

/** Reset local consent and raw entries for a different original/file, never resume across scope. */
export default function COManualTranscription(props: Props) {
    const [identity, setIdentity] = useState({ original: props.original, file: props.file, epoch: 0 });
    if (identity.original !== props.original || identity.file !== props.file) {
        setIdentity({ original: props.original, file: props.file, epoch: identity.epoch + 1 });
        return null;
    }
    return <ManualForm key={identity.epoch} {...props}/>;
}
