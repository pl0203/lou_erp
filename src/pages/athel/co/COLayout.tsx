import { MainContent } from '../../../components/ui/MainContent';
import { Outlet } from 'react-router-dom';
import AthelNav from '../../../components/AthelNav';
export default function COLayout() {
    return <div className="min-h-screen bg-brand-canvas">
    <AthelNav />
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
