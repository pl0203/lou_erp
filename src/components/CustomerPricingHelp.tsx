export default function CustomerPricingHelp({ id }: { id: string }) {
  return <div id={id} className="mt-2 space-y-1 text-xs text-gray-600">
    <p>Tier memilih kolom harga katalog saat barang ditambahkan ke pesanan. Mengubah tier tidak memperbarui harga barang yang sudah tercatat pada pesanan.</p>
    <p>Luar Kota adalah pilihan awal untuk pelanggan baru; pastikan sesuai kesepakatan harga pelanggan.</p>
    <p>Others atau harga tier yang belum diisi memerlukan harga manual pada pesanan.</p>
  </div>
}
