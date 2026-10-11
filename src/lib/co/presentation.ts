/** CO reporting periods are calendar months, independent of the browser timezone. */
export function formatCOReportMonth(value: string | null | undefined): string {
    if (!value || !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value)) return 'Belum ada';
    return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`));
}

export const CO_AUDIT_ACTIONS: Record<string, string> = {
    create_co: 'membuat CO', edit_co: 'mengubah CO', cancel_co: 'membatalkan CO',
    save_sj_draft: 'menyimpan draft Surat Jalan', post_sj: 'memposting pengiriman',
    save_report_draft: 'menyimpan draft laporan penjualan bulanan', post_report: 'memposting laporan penjualan bulanan',
    save_return_draft: 'menyimpan draft retur barang', post_return: 'memposting retur barang',
    correct_sj: 'mengoreksi pengiriman', correct_report: 'mengoreksi laporan penjualan bulanan',
    correct_return: 'mengoreksi retur barang', resolve_undelivered: 'menyelesaikan sisa belum dikirim',
    close_co: 'menutup CO', register_evidence: 'mendaftarkan lampiran laporan',
    finalize_evidence: 'memasang lampiran laporan', remove_evidence: 'melepas lampiran laporan',
};
