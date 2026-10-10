import type { Ref } from 'react';
import { coLineAmount, parseCOPriceInput } from '../../lib/co/catalog';
import { formatMoney } from '../../lib/reads/money';
import { CO_INPUT, enteredQuantity } from './COShared';
export type COLineDraft = {
    key: string;
    id: string;
    existing: boolean;
    stock_key_id?: string;
    removable: boolean;
    product_id: string | null;
    product_name: string;
    sku: string;
    quantity: string;
    agreed_price: string;
    minimum: string;
};
export type COLineField = 'sku' | 'product_name' | 'quantity' | 'agreed_price';
export function lineSubtotal(line: COLineDraft) {
    try {
        const price = parseCOPriceInput(line.agreed_price);
        return price === null ? 'Harga belum diisi' : `Rp ${formatMoney(coLineAmount(enteredQuantity(line.quantity), price), 'full')}`;
    }
    catch {
        return 'Isian belum lengkap';
    }
}
export function COLineRow({ line, disabled, change, remove, refs, error }: {
    line: COLineDraft;
    disabled: boolean;
    change: (field: COLineField, text: string) => void;
    remove: () => void;
    refs: {
        name: Ref<HTMLInputElement>;
        quantity: Ref<HTMLInputElement>;
        price: Ref<HTMLInputElement>;
    };
    error?: string;
}) {
    const name = line.product_name || 'barang baru';
    return <div data-co-line={line.key} className="rounded-lg border border-gray-100 p-3 min-w-0 space-y-2">
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_minmax(0,.8fr)_minmax(0,1.3fr)_2.5rem] items-end">
    <label className="min-w-0 text-xs text-gray-500">SKU<input className={`${CO_INPUT} font-mono`} aria-label={`SKU ${name}`} value={line.sku} disabled={disabled || line.existing || !!line.stock_key_id} onChange={e => change('sku', e.target.value)}/>
    </label>
    <label className="min-w-0 text-xs text-gray-500">Nama produk<input className={CO_INPUT} aria-label={`Nama produk ${name}`} ref={refs.name} value={line.product_name} disabled={disabled || line.existing || !!line.stock_key_id} onChange={e => change('product_name', e.target.value)}/>
    </label>
    <label className="min-w-0 text-xs text-gray-500">Qty<input className={CO_INPUT} type="text" inputMode="numeric" aria-label={`Qty ${name}`} ref={refs.quantity} value={line.quantity} disabled={disabled} onChange={e => change('quantity', e.target.value)}/>
    </label>
    <label className="min-w-0 text-xs text-gray-500">Harga satuan (Rp)<input className={CO_INPUT} type="text" inputMode="decimal" aria-label={`Harga satuan ${name}`} ref={refs.price} value={line.agreed_price} disabled={disabled || line.existing} placeholder="Harga belum diisi" onChange={e => change('agreed_price', e.target.value)}/>
    </label>
    <button type="button" aria-label={`Hapus ${name}`} disabled={disabled || !line.removable} onClick={remove} className="h-10 w-10 justify-self-end rounded-lg text-xl text-gray-400 hover:bg-red-50 disabled:opacity-30">×</button>
  </div>{line.existing && <p className="text-xs text-gray-500">Identitas dan harga asli terkunci. Jumlah minimum {line.minimum}; penghapusan mengikuti riwayat sumber.</p>}{error && <p role="alert" className="text-xs text-red-700">{error}</p>}<p className="text-right text-xs text-gray-500 break-words">Subtotal: <span className="text-gray-900">{lineSubtotal(line)}</span>
    </p>
    </div>;
}
