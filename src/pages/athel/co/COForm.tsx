import { Field } from '../../../components/ui/Field';
import { PageHeader } from '../../../components/ui/PageHeader';
import { FormActions } from '../../../components/ui/FormActions';
import { Button } from '../../../components/ui/Button';
import { ActionLink } from '../../../components/ui/ActionLink';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBeforeSignOut } from '../../../lib/AuthContext';
import { useUnsavedChanges } from '../../../lib/useUnsavedChanges';
import { POCustomerLookup, POProductLookup } from '../../../components/POLookup';
import { parseCOPriceInput, resolveCOCatalogPrice, coPlannedAmount } from '../../../lib/co/catalog';
import type { CatalogueProductRow } from '../../../lib/catalogue/contracts';
import { useCatalogueOrderOptions } from '../../../lib/catalogue/useCatalogueOrderOptions';
import { coHistoricalMaximum, requireCOCatalogueProduct, selectCOStockIdentity } from '../../../lib/co/catalogueSelection';
import { fetchCOPage, fetchCODetail, fetchCompleteCOLines, fetchCOCustomerStock, resolveCOStockKey } from '../../../lib/co/rpc';
import { useCOTransactionSender } from '../../../lib/co/transactions';
import type { COTransactionSender } from '../../../lib/co/transactions';
import type { COReceipt } from '../../../lib/co/contracts';
import { COLineRow } from '../../../components/co/COLineItems';
import type { COLineDraft, COLineField } from '../../../components/co/COLineItems';
import { CO_INPUT, COCard, COFailure, CORecoveryPanel, COPagination, enteredQuantity, useCOActor, useCORead } from '../../../components/co/COShared';
import { coKeys } from '../../../lib/co/queryKeys';
import COSourceBoundary from '../../../components/co/COSourceBoundary';
import { formatMoney } from '../../../lib/reads/money';
type Actor = ReturnType<typeof useCOActor>;
const snapshot = (customer: string, number: string, date: string, end: string, notes: string, lines: COLineDraft[]) => JSON.stringify([customer, number, date, end, notes, lines.map(({ key: _key, ...line }) => line)]);
function blankLine(): COLineDraft { const id = crypto.randomUUID(); return { key: id, id, existing: false, removable: true, product_id: null, product_name: '', sku: '', quantity: '1', agreed_price: '', minimum: '1' }; }
export default function COForm({ mode }: {
    mode: 'create' | 'edit';
}) {
    const { id } = useParams();
    const actor = useCOActor(`form:${mode}:${id ?? 'new'}`);
    return actor.enabled ? <COSourceBoundary source={actor.scope} check={async options => {
        if (mode === 'edit') return fetchCODetail(id!, null, options);
        await fetchCOPage({ p_status: 'all', p_search: '', p_page: 1, p_page_size: 1 }, options);
        return null;
    }}><COFormOwner mode={mode} id={id}/></COSourceBoundary> : null;
}
function COFormOwner({ mode, id }: { mode: 'create' | 'edit'; id?: string }) {
    const actor = useCOActor(`form:${mode}:${id ?? 'new'}`);
    return <COFormEditor key={actor.scope} mode={mode} id={id} actor={actor}/>;
}
function COFormEditor({ mode, id, actor }: {
    mode: 'create' | 'edit';
    id?: string;
    actor: Actor;
}) {
    const navigate = useNavigate();
    const today = useRef(new Date().toISOString().slice(0, 10)).current;
    const [customer, setCustomer] = useState('');
    const [number, setNumber] = useState('');
    const [date, setDate] = useState(today);
    const [end, setEnd] = useState('');
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<COLineDraft[]>([]);
    const [baseline, setBaseline] = useState(snapshot('', '', today, '', '', []));
    const [initialized, setInitialized] = useState(mode === 'create');
    const [generation, setGeneration] = useState(0);
    const [pending, setPending] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [unresolved, setUnresolved] = useState(false);
    const [failure, setFailure] = useState('');
    const [notice, setNotice] = useState('');
    const [lineError, setLineError] = useState<{
        key: string;
        message: string;
    } | null>(null);
    const [page, setPage] = useState(1);
    const [collision, setCollision] = useState<{
        source: Record<string, any>;
        draft: COLineDraft;
        replaceKey?: string;
        customer: string;
        customerVersion: string;
        generation: number;
    } | null>(null);
    const unsaved = useUnsavedChanges(initialized && snapshot(customer, number, date, end, notes, lines) !== baseline);
    useBeforeSignOut(signal => unsaved.confirmDiscardDecision({ signal }), `${actor.scope}:${generation}`);
    const customerRead = useCatalogueOrderOptions('customer', mode === 'edit' ? 'all-for-history' : 'enabled-for-order');
    const catalog = useCatalogueOrderOptions('product', mode === 'edit' ? 'all-for-history' : 'enabled-for-order');
    const customerOptions = useCatalogueOrderOptions('customer', 'enabled-for-order');
    const productOptions = useCatalogueOrderOptions('product', 'enabled-for-order');
    useEffect(() => {
        if (!actor.isCurrent()) return;
        for (const error of [customerRead.error, catalog.error, customerOptions.error, productOptions.error])
            if (error) actor.rejectAuthority(error);
    }, [actor, customerRead.error, catalog.error, customerOptions.error, productOptions.error]);
    const header = useCORead(actor, 'edit-header', { id }, o => fetchCODetail(id!, null, o), mode === 'edit' && !!id);
    const co = header.data?.co;
    const complete = useCORead(actor, 'edit-lines', { id, co_version: co?.co_version, customer_version: co?.customer_version }, o => fetchCompleteCOLines(id!, co.co_version, co.customer_version, o), mode === 'edit' && !!co && !refreshing);
    const stockArgs = { p_customer_id: customer || null, p_as_of: null, p_search: '', p_expected_customer_version: null, p_page: 1, p_page_size: 1 };
    const stock = useCORead(actor, 'customer-binding', stockArgs, o => fetchCOCustomerStock(stockArgs, o), mode === 'create' && !!customer);
    const customerVersion = mode === 'edit' ? co?.customer_version : stock.data?.customer_version;
    const savedLines = useRef<COLineDraft[]>([]);
    const initialVersion = useRef('');
    const initialCustomerVersion = useRef('');
    const editing = mode === 'edit';
    const search = useRef<HTMLInputElement>(null);
    const names = useRef<Record<string, HTMLInputElement | null>>({});
    const quantities = useRef<Record<string, HTMLInputElement | null>>({});
    const prices = useRef<Record<string, HTMLInputElement | null>>({});
    const focus = useRef<{
        key: string;
        field: 'name' | 'quantity' | 'price';
    } | null>(null);
    const busy = useRef(false);
    const restoreSearch = useRef(false);
    const live = useRef({ generation, customer, customerVersion, lines });
    live.current = { generation, customer, customerVersion, lines };
    const catalogueReady = !!customerOptions.data && !!productOptions.data && !customerOptions.isFetching && !productOptions.isFetching && !customerOptions.isError && !productOptions.isError;
    const selectedCustomer = customerRead.data?.find(row => row.id === customer);
    const catalogueLive = useRef({ catalogueReady, customers: customerOptions.data, products: productOptions.data });
    catalogueLive.current = { catalogueReady, customers: customerOptions.data, products: productOptions.data };
    const ready = catalogueReady && actor.isCurrent() && !conflict && !refreshing && initialized && !!customerVersion && !header.isFetching && !complete.isFetching && !header.isError && !complete.isError && !!customerRead.data && !!catalog.data && !customerRead.isError && !catalog.isError && !customerRead.isFetching && !catalog.isFetching && !stock.isFetching && !stock.isError && (!editing || initialVersion.current === co?.co_version && initialCustomerVersion.current === co?.customer_version) && (!editing || header.data?.allowed_operations.includes('edit_co'));
    useEffect(() => {
        if (editing && !initialized && co && complete.data && !header.isFetching && !complete.isFetching && !complete.isError && actor.isCurrent()) {
            const rows = complete.data.map(row => ({ key: row.id, id: row.id, existing: true, removable: row.removable, stock_key_id: row.stock_key_id, product_id: row.product_id, product_name: row.product_name, sku: row.display_sku, quantity: row.ordered_quantity, agreed_price: row.unit_price, minimum: (BigInt(row.delivered_quantity) + BigInt(row.resolved_undelivered_quantity) > 0n ? BigInt(row.delivered_quantity) + BigInt(row.resolved_undelivered_quantity) : 1n).toString() }));
            setCustomer(co.customer_id);
            setNumber(co.co_number);
            setDate(co.order_date);
            setEnd(co.expected_delivery_date ?? '');
            setNotes(co.notes ?? '');
            setLines(rows);
            savedLines.current = rows;
            initialVersion.current = co.co_version;
            initialCustomerVersion.current = co.customer_version;
            setBaseline(snapshot(co.customer_id, co.co_number, co.order_date, co.expected_delivery_date ?? '', co.notes ?? '', rows));
            setInitialized(true);
        }
    }, [editing, initialized, co, complete.data, header.isFetching, complete.isFetching, complete.isError, actor]);
    function focusQuantity(line: COLineDraft) { setPage(Math.floor(lines.findIndex(l => l.key === line.key) / 100) + 1); const node = quantities.current[line.key]; if (node) {
        node.focus();
        node.select();
    }
    else
        focus.current = { key: line.key, field: 'quantity' }; }
    function newProduct(productId: string | null, sku: string) {
        const current = catalogueLive.current;
        if (!current.catalogueReady || !current.customers?.some(row => row.id === live.current.customer && row.is_enabled))
            throw new Error('Barang baru memerlukan pelanggan aktif dan katalog yang sudah dimuat.');
        return requireCOCatalogueProduct(productId, sku, current.products ?? []);
    }
    function maximumFor(row: COLineDraft) {
        const saved = savedLines.current.find(line => line.id === row.id);
        return saved ? coHistoricalMaximum(saved.product_id, saved.quantity, selectedCustomer?.is_enabled === true, catalog.data ?? []) : undefined;
    }
    async function addProduct(product: CatalogueProductRow) {
        if (!ready || pending || unresolved || busy.current)
            return;
        try { product = newProduct(product.id, product.sku); }
        catch (e) { setFailure((e as Error).message); return; }
        const duplicate = lines.find(l => l.sku.trim().toLowerCase() === product.sku.trim().toLowerCase());
        if (duplicate) {
            setNotice(`${product.sku} sudah ada. Jumlah dan harga tetap.`);
            focusQuantity(duplicate);
            return;
        }
        const selected = customerRead.data?.find(c => c.id === customer);
        const draft = { ...blankLine(), product_id: product.id, product_name: product.name, sku: product.sku, agreed_price: resolveCOCatalogPrice(product, selected?.pricing_tier) ?? '' };
        const captured = live.current;
        busy.current = true;
        setPending(true);
        setFailure('');
        try {
            const source = await resolveCOStockKey(customer, product.sku, customerVersion, { isCurrent: () => actor.isCurrent() && live.current.customer === captured.customer && live.current.generation === captured.generation });
            if (!actor.isCurrent() || (live.current.lines !== captured.lines || live.current.generation !== captured.generation || live.current.customer !== captured.customer || live.current.customerVersion !== captured.customerVersion))
                return;
            const selectedProduct = newProduct(draft.product_id, draft.sku);
            if (source) {
                selectCOStockIdentity(selectedProduct, source);
                setCollision({ source, draft, customer, customerVersion, generation });
            }
            else {
                setPage(Math.floor(captured.lines.length / 100) + 1);
                setLines(prev => [...prev, draft]);
                restoreSearch.current = true;
            }
        }
        catch (e) {
            if (actor.isCurrent() && live.current.generation === captured.generation && live.current.customer === captured.customer) actor.rejectAuthority(e);
            if (actor.isCurrent() && live.current.generation === captured.generation)
                setFailure((e as Error).message);
        }
        finally {
            busy.current = false;
            if (actor.isCurrent())
                setPending(false);
        }
    }
    useEffect(() => { if (!pending && restoreSearch.current) {
        restoreSearch.current = false;
        search.current?.focus();
    } }, [pending]);
    function reuse() {
        if (!collision || !ready || pending || unresolved || busy.current) return;
        const { source, draft, replaceKey } = collision;
        const current = live.current;
        const row = replaceKey ? current.lines.find(line => line.key === replaceKey) : draft;
        // Identity acceptance is scoped to its checked row/customer, never a saved copy of editable values.
        if (collision.customer !== current.customer || collision.customerVersion !== current.customerVersion || collision.generation !== current.generation || !row || row.existing || row.sku.trim().toLowerCase() !== draft.sku.trim().toLowerCase() || row.stock_key_id !== draft.stock_key_id || row.product_id !== draft.product_id) {
            setCollision(null);
            setFailure('Pilihan identitas stok sudah tidak sesuai. Periksa barang dan pilih kembali.');
            return;
        }
        let identity;
        try { identity = selectCOStockIdentity(newProduct(row.product_id, row.sku), source); }
        catch (e) { setCollision(null); setFailure((e as Error).message); return; }
        setLines(previous => replaceKey ? previous.map(line => line.key === replaceKey ? { ...line, ...identity } : line) : [...previous, { ...draft, ...identity }]);
        setCollision(null);
        setNotice('Identitas stok lama dipakai secara eksplisit; harga kesepakatan dipertahankan.');
        search.current?.focus();
    }
    function change(key: string, field: COLineField, text: string) {
        if (field !== 'quantity' && field !== 'agreed_price') return;
        setLines(prev => prev.map(l => l.key === key && !(l.existing && field === 'agreed_price') ? { ...l, [field]: text } : l));
        setLineError(null);
    }
    async function save(sender: COTransactionSender) {
        if (!ready || busy.current || unresolved)
            return;
        const captured = live.current;
        const g = generation;
        busy.current = true;
        setPending(true);
        setFailure('');
        try {
            if (!selectedCustomer || !editing && !selectedCustomer.is_enabled)
                throw new Error('Pilih pelanggan aktif terlebih dahulu.');
            if (!number.trim())
                throw new Error('Nomor CO wajib diisi.');
            if (!lines.length) {
                search.current?.focus();
                throw new Error('CO harus memiliki minimal satu barang.');
            }
            const normalized = new Set<string>();
            const payloadLines = [];
            for (const row of lines) {
                let offending: 'name' | 'quantity' | 'price' = 'name';
                try {
                    if (!row.sku.trim() || !row.product_name.trim())
                        throw new Error('SKU dan nama produk wajib diisi.');
                    const sku = row.sku.trim().toLowerCase();
                    if (normalized.has(sku))
                        throw new Error('SKU sudah ada; periksa barang yang sama.');
                    normalized.add(sku);
                    offending = 'quantity';
                    const quantity = enteredQuantity(row.quantity);
                    if (BigInt(quantity) < BigInt(row.minimum))
                        throw new Error('Jumlah kurang dari sumber terkirim atau sisa yang telah diselesaikan.');
                    if (row.existing) {
                        const saved = savedLines.current.find(line => line.id === row.id);
                        if (!saved || row.stock_key_id !== saved.stock_key_id || row.product_id !== saved.product_id || row.sku !== saved.sku || row.product_name !== saved.product_name || row.agreed_price !== saved.agreed_price)
                            throw new Error('Identitas dan harga barang tersimpan tidak boleh diganti.');
                        const maximum = maximumFor(row);
                        if (maximum !== undefined && BigInt(quantity) > BigInt(maximum))
                            throw new Error('Jumlah barang untuk katalog nonaktif tidak boleh melebihi jumlah tersimpan pada baris ini.');
                        payloadLines.push({ id: row.id, ordered_quantity: quantity });
                        continue;
                    }
                    const product = newProduct(row.product_id, row.sku);
                    if (savedLines.current.some(saved => saved.id === row.id))
                        throw new Error('Identitas barang tersimpan tidak boleh dipakai untuk barang baru.');
                    offending = 'price';
                    const price = parseCOPriceInput(row.agreed_price);
                    if (price === null)
                        throw new Error('Harga wajib diisi; nol harus dimasukkan secara sengaja.');
                    if (!row.stock_key_id) {
                        const source = await resolveCOStockKey(customer, row.sku, customerVersion, { isCurrent: () => actor.isCurrent() && live.current.generation === g && live.current.customer === customer });
                        if (!actor.isCurrent() || live.current.generation !== g || live.current.customer !== captured.customer || live.current.customerVersion !== captured.customerVersion) return;
                        const currentProduct = newProduct(product.id, row.sku);
                        if (source) {
                            selectCOStockIdentity(currentProduct, source);
                            setCollision({ source, draft: row, replaceKey: row.key, customer, customerVersion, generation: g });
                            return;
                        }
                    }
                    payloadLines.push({ id: row.id, sku: row.sku.trim(), product_name: row.product_name.trim(), product_id: row.product_id, ordered_quantity: quantity, unit_price: price, ...(row.stock_key_id ? { stock_key_id: row.stock_key_id } : {}) });
                }
                catch (e) {
                    setPage(Math.floor(lines.indexOf(row) / 100) + 1);
                    setLineError({ key: row.key, message: (e as Error).message });
                    const field = offending;
                    focus.current = { key: row.key, field };
                    const node = (field === 'name' ? names : field === 'quantity' ? quantities : prices).current[row.key];
                    if (node && !node.disabled) { node.focus(); focus.current = null; }
                    throw e;
                }
            }
            if (!actor.isCurrent() || (live.current.lines !== captured.lines || live.current.generation !== captured.generation || live.current.customer !== captured.customer || live.current.customerVersion !== captured.customerVersion))
                return;
            // A catalogue refresh may finish while a stock-key read is awaited.
            for (const row of lines) if (!row.existing) newProduct(row.product_id, row.sku);
            const receipt = await sender(editing ? 'edit_co' : 'create_co', { ...(editing ? { co_id: id, expected_co_version: initialVersion.current } : { customer_id: customer }), expected_customer_version: customerVersion, co_number: number.trim(), order_date: date, expected_delivery_date: end || null, notes: notes || null, lines: payloadLines });
            if (actor.isCurrent() && live.current.generation === g) {
                actor.client.invalidateQueries({ queryKey: coKeys.identity(actor.identity) });
                unsaved.runWithoutPrompt(() => navigate(`/athel/co/${receipt.id}`));
            }
        }
        catch (e) {
            if (actor.isCurrent() && live.current.generation === g) actor.rejectAuthority(e);
            if (actor.isCurrent() && live.current.generation === g) {
                setFailure((e as Error).message);
                if ((e as { code?: string }).code === 'PT409') setConflict(true);
            }
        }
        finally {
            busy.current = false;
            if (actor.isCurrent())
                setPending(false);
        }
    }
    async function recovered(receipt: COReceipt, sender: COTransactionSender) {
        if (busy.current || refreshing) return false;
        if (!['create_co', 'edit_co'].includes(receipt.operation) || receipt.customer_id !== customer || (editing && receipt.id !== id))
            throw new Error('Hasil pemulihan tidak sesuai editor CO ini.');
        const g = generation;
        const accepted = await unsaved.confirmDiscardDecision({ message: 'Permintaan sebelumnya tersimpan. Buang isian saat ini dan lihat hasil tersimpan?' });
        if (!accepted || busy.current || !actor.isCurrent() || live.current.generation !== g)
            return false;
        busy.current = true;
        setPending(true);
        try {
            await sender.acknowledgeRecovered();
        }
        finally {
            busy.current = false;
            if (actor.isCurrent())
                setPending(false);
        }
        if (actor.isCurrent() && live.current.generation === g) {
            actor.client.invalidateQueries({ queryKey: coKeys.identity(actor.identity) });
            unsaved.runWithoutPrompt(() => navigate(`/athel/co/${receipt.id}`));
            return true;
        }
        return false;
    }
    function reload() {
        if (busy.current || pending || unresolved || !actor.isCurrent()) return;
        const g = generation;
        unsaved.confirmDiscard(() => { if (actor.isCurrent() && live.current.generation === g) void refreshAfterDecision(); });
    }
    async function refreshAfterDecision() {
        if(refreshing || busy.current || pending || unresolved || !actor.isCurrent()) return;
        const g = generation;
        const selectedCustomer = customer;
        const isCurrent = () => actor.isCurrent() && live.current.generation === g && live.current.customer === selectedCustomer;
        busy.current = true;
        setRefreshing(true);
        setFailure('');
        try {
            if (!editing) {
                const fresh = await stock.refetch();
                if (!fresh.isError && fresh.data && isCurrent()) setConflict(false);
                return;
            }
            const fresh = await header.refetch();
            if(fresh.isError || !fresh.data || !isCurrent()) return;
            const next = fresh.data.co;
            const args = { id, co_version: next.co_version, customer_version: next.customer_version };
            await actor.client.fetchQuery({
                queryKey: coKeys.read(actor.identity, 'edit-lines', args),
                queryFn: ({signal}) => fetchCompleteCOLines(id!, next.co_version, next.customer_version, {signal,isCurrent}),
                retry:false,
            });
            if(isCurrent()) {setConflict(false);setInitialized(false);setGeneration(g=>g+1);setPage(1);setCollision(null);}
        } catch(e) { if (isCurrent()) { actor.rejectAuthority(e); setFailure((e as Error).message); } }
        finally {busy.current = false;if(actor.isCurrent())setRefreshing(false);}
    }

    let total: string | null = null;
    try {
        const amount = coPlannedAmount(lines.map(l => ({ quantity: enteredQuantity(l.quantity), unit_price: parseCOPriceInput(l.agreed_price) })));
        total = amount === null ? null : formatMoney(amount, 'full');
    }
    catch { }
    const disabled = pending || unresolved || !ready;
    const visible = lines.slice((page - 1) * 100, page * 100);
    if (editing && !initialized)
        return <div className="max-w-4xl mx-auto space-y-4">{unsaved.dialog}{header.isError || complete.isError ? <COFailure error={header.error ?? complete.error} retry={refreshing ? undefined : reload}/> : <p role="status">Memuat seluruh barang CO…</p>}</div>;
    return <div className="max-w-4xl mx-auto space-y-6">{unsaved.dialog}<PageHeader title={editing ? `Ubah ${number}` : 'CO Baru'} actions={<ActionLink variant="quiet" size="compact" to={editing ? `/athel/co/${id}` : '/athel/co'}>Kembali</ActionLink>}/>
    {(header.isError || complete.isError || editing && (co?.co_version !== initialVersion.current || co?.customer_version !== initialCustomerVersion.current)) && <COFailure error={header.error ?? complete.error ?? new Error('CO atau sumber pelanggan berubah. Periksa isian dan muat ulang sebelum menyimpan.')} retry={refreshing ? undefined : reload}/>} {(customerRead.isError || catalog.isError || customerOptions.isError || productOptions.isError || stock.isError) && <COFailure error={customerRead.error ?? catalog.error ?? customerOptions.error ?? productOptions.error ?? stock.error} retry={refreshing ? undefined : () => { void customerRead.refetch(); void catalog.refetch(); void customerOptions.refetch(); void productOptions.refetch(); void stock.refetch(); }}/>}
    <COCard title="Detail Pesanan">
    <fieldset disabled={pending || unresolved || refreshing || editing && !ready} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
    <div>
    <label className="ui-field__label block mb-1">Pelanggan</label>
    <POCustomerLookup customers={customerOptions.data ?? []} selectedId={customer} selectedLabel={co?.customer_name} disabled={editing || pending || unresolved || refreshing || !customerOptions.data || customerOptions.isFetching || customerOptions.isError} onSelect={c => { if (c.id === customer)
        return; unsaved.confirmDiscard(() => { setCustomer(c.id); setLines([]); setCollision(null); setLineError(null); setGeneration(g => g + 1); }, { when: lines.length > 0, message: 'Mengganti pelanggan akan menghapus barang dan harga yang sudah diisi. Lanjutkan?' }); }}/>{editing && <p className="mt-2 text-[13px] text-brand-secondary">Pelanggan dan PIC asli terkunci: <span>{co?.sales_person_name ?? 'Unassigned'}</span>
        </p>}{selectedCustomer && !selectedCustomer.is_enabled && <p role="status" className="mt-2 text-[13px] text-amber-800">Pelanggan nonaktif: barang baru tidak dapat ditambahkan dan jumlah setiap barang tidak boleh melebihi jumlah tersimpan.</p>}</div>
      <Field id="co-form-number" label="Nomor CO">{control => <input {...control} aria-label="Nomor CO" className={CO_INPUT} value={number} onChange={e => setNumber(e.target.value)}/>}</Field>
    <Field id="co-form-date" label="Tanggal CO">{control => <input {...control} aria-label="Tanggal CO" type="date" className={CO_INPUT} value={date} onChange={e => setDate(e.target.value)}/>}</Field>
    <Field id="co-form-end" label="Tanggal akhir CO (opsional)">{control => <input {...control} aria-label="Tanggal akhir CO" type="date" className={CO_INPUT} value={end} onChange={e => setEnd(e.target.value)}/>}</Field>
    <Field id="co-form-notes" label="Catatan" className="sm:col-span-2">{control => <textarea {...control} aria-label="Catatan" className={CO_INPUT} value={notes} onChange={e => setNotes(e.target.value)} rows={2}/>}</Field>
    </fieldset>
    </COCard>
    <COCard title="Daftar Barang">
    <div className="mb-4">
    <POProductLookup products={productOptions.data ?? []} onSelect={p => void addProduct(p)} inputRef={search} disabled={disabled || !selectedCustomer?.is_enabled}/>
    <p className="text-[13px] text-brand-secondary mt-2">Cari SKU tepat lalu Enter, atau pilih hasil. Harga baru mengikuti tier pelanggan; harga kesepakatan tetap dipertahankan.</p>{notice && <p role="status" className="mt-2 text-[13px] text-blue-700">{notice}</p>}</div>
      {collision && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-3 text-base">
        <p>SKU sudah memiliki identitas stok: {collision.source.display_sku} · {collision.source.product_name}. Pilihan katalog tidak mengganti identitas lama.</p>
        <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="compact" disabled={disabled} onClick={reuse}>Gunakan identitas stok lama</Button>
        <Button type="button" variant="quiet" size="compact" disabled={pending || unresolved || refreshing} onClick={() => setCollision(null)}>Batal pilihan</Button>
        </div>
        </div>}
      <div className="space-y-2">{visible.map(l => <COLineRow key={l.key} line={l} disabled={disabled} identityLocked maximum={maximumFor(l)} change={(f, t) => change(l.key, f, t)} remove={() => setLines(prev => prev.filter(row => row.key !== l.key))} error={lineError?.key === l.key ? lineError.message : undefined} refs={{ name: node => { names.current[l.key] = node; if (node && !node.disabled && focus.current?.key === l.key && focus.current.field === 'name') {
                node.focus();
                focus.current = null;
            } }, quantity: node => { quantities.current[l.key] = node; if (node && !node.disabled && focus.current?.key === l.key && focus.current.field === 'quantity') {
                node.focus();
                node.select();
                focus.current = null;
            } }, price: node => { prices.current[l.key] = node; if (node && !node.disabled && focus.current?.key === l.key && focus.current.field === 'price') { node.focus(); focus.current = null; } } }}/>)}</div>{!lines.length && <p className="p-6 text-center text-base text-brand-secondary">Belum ada barang. Cari SKU atau nama untuk menambahkan barang.</p>}
      {lines.length > 100 && <COPagination page={page} pageSize={100} total={String(lines.length)} pending={pending} onPage={setPage}/>}<div className="mt-4 pt-4 border-t border-brand-divider flex flex-wrap justify-between gap-3">
    <p className="text-base break-words">Nilai rencana CO: <strong>{total === null ? 'Harga / jumlah belum lengkap' : `Rp ${total}`}</strong>
    </p>
    </div>
    <p className="text-[13px] text-brand-secondary mt-3">Barang baru wajib dipilih dari katalog aktif. Barang manual lama tetap tersimpan dengan identitas dan harga asli.</p>
    <p className="text-[13px] text-brand-secondary mt-2">Nilai rencana bukan pendapatan. Pendapatan muncul dari penjualan bulanan yang diposting.</p>
    </COCard>
    {failure && <COFailure error={new Error(failure)} retry={conflict && !refreshing ? reload : undefined}/>}<FormActions>
    <ActionLink variant="quiet" size="compact" to={editing ? `/athel/co/${id}` : '/athel/co'}>Batal</ActionLink>{customer && <COFormCommands key={customer} customer={customer} coId={editing ? id : undefined} editing={editing} actor={actor} refreshing={refreshing} ready={ready && !pending} save={save} recovered={recovered} unresolved={setUnresolved}/>}</FormActions>
  </div>;
}
function COFormCommands({ customer, coId, editing, actor, refreshing, ready, save, recovered, unresolved }: {
    customer: string;
    coId?: string;
    editing: boolean;
    actor: Actor;
    refreshing: boolean;
    ready: boolean;
    save: (sender: COTransactionSender) => Promise<void>;
    recovered: (r: COReceipt, s: COTransactionSender) => Promise<boolean>;
    unresolved: (v: boolean) => void;
}) {
    const sender = useCOTransactionSender({ formScope: editing ? `edit:${coId}` : 'create', customerId: customer, coId });
    const [pending, setPending] = useState(false);
    const blocked = sender.hasUnresolved();
    useEffect(() => unresolved(blocked), [blocked, unresolved]);
    return <>
    <fieldset disabled={refreshing} className="contents"><CORecoveryPanel pending={pending} sender={sender} current={() => actor.isCurrent() && !refreshing} accept={r => recovered(r, sender)}/></fieldset>
    <Button type="button"  disabled={!ready || blocked || pending} onClick={() => { setPending(true); void save(sender).finally(() => setPending(false)); }}>{pending ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Simpan CO'}</Button>
    </>;
}

