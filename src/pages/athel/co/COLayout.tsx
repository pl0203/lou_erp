import { Link, Outlet, useLocation } from 'react-router-dom';
import AthelNav from '../../../components/AthelNav';
export default function COLayout() {
    const location = useLocation();
    const selected = location.pathname.startsWith('/athel/co/reports') ? 'reports' : location.pathname.startsWith('/athel/co/stock') ? 'stock' : 'orders';
    return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />
    <header className="bg-white border-b border-gray-200 px-4 md:px-8 pt-5">
    <h1 className="text-xl font-semibold text-gray-900">Consignment Order</h1>
    <nav aria-label="Bagian Consignment Order" className="mt-4 flex gap-4 overflow-x-auto text-sm">{[['orders', '/athel/co', 'Orders'], ['reports', '/athel/co/reports', 'Monthly Sales Reports'], ['stock', '/athel/co/stock', 'Customer Stock']].map(([tab, to, label]) => <Link key={tab} to={to} aria-current={selected === tab ? 'page' : undefined} className={`shrink-0 border-b-2 pb-3 ${selected === tab ? 'border-brand-primary text-brand-primary' : 'border-transparent text-gray-500'}`}>{label}</Link>)}</nav>
    </header>
    <main className="px-4 md:px-8 py-6">
    <Outlet />
    </main>
    </div>;
}
export function COStageUnavailable({ subject }: {
    subject: string;
}) {
    return <div className="rounded-xl border border-gray-200 bg-white p-6">
    <h2 className="font-medium">{subject}</h2>
    <p className="mt-2 text-sm text-gray-600">Penyiapan dan peninjauan modul ini belum selesai. Belum ada tindakan stok atau pendapatan yang dapat dikirim dari halaman ini.</p>
    </div>;
}
