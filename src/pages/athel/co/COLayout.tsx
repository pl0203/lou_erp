import { MainContent } from '../../../components/ui/MainContent';
import { Outlet, useLocation } from 'react-router-dom';
import { ActionLink } from '../../../components/ui/ActionLink';
import AthelNav from '../../../components/AthelNav';
export default function COLayout() {
    const location = useLocation();
    const selected = location.pathname.startsWith('/athel/co/reports') ? 'reports' : location.pathname.startsWith('/athel/co/stock') ? 'stock' : 'orders';
    return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />
    <header className="bg-brand-surface border-b border-brand-divider px-4 md:px-8 pt-5">
    <p className="text-xl font-semibold text-brand-primary">Pesanan konsinyasi (CO)</p>
    <nav aria-label="Bagian pesanan konsinyasi" className="mt-4 -mx-1.5 flex gap-2 overflow-x-auto p-1.5">{[['orders', '/athel/co', 'Pesanan CO'], ['reports', '/athel/co/reports', 'Laporan penjualan bulanan'], ['stock', '/athel/co/stock', 'Stok pelanggan']].map(([tab, to, label]) => <ActionLink variant="quiet" size="compact" key={tab} to={to} aria-current={selected === tab ? 'page' : undefined} className={`shrink-0 rounded-none border-x-0 border-t-0 border-b-2 ${selected === tab ? 'border-brand-primary text-brand-primary' : 'border-transparent text-brand-secondary'}`}>{label}</ActionLink>)}</nav>
    </header>
    <MainContent className="px-4 md:px-8 py-6">
    <Outlet />
    </MainContent>
    </div>;
}
export function COStageUnavailable({ subject }: {
    subject: string;
}) {
    return <div className="rounded-[14px] border border-brand-divider bg-brand-surface p-6">
    <h2 className="font-medium">{subject}</h2>
    <p className="mt-2 text-base text-brand-secondary">Penyiapan dan peninjauan modul ini belum selesai. Belum ada tindakan stok atau pendapatan yang dapat dikirim dari halaman ini.</p>
    </div>;
}
