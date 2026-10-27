import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import '../../src/index.css'
import {MySalesDashboard} from '../../src/components/sales/MySalesDashboard'
import {TeamSalesDashboard} from '../../src/components/sales/TeamSalesDashboard'
import {dashboardFixture} from '../sales-dashboard/fixtures'
const params=new URLSearchParams(location.search || location.hash.slice(1)), scope=params.get('scope')==='own'?'own':params.get('scope')==='leadership'?'leadership':'team'
function Fixture(){const [month,setMonth]=useState('2026-10-01'),[search,setSearch]=useState('');const data=dashboardFixture(scope,Number(params.get('count')??5));const props={data,month,search,onMonth:setMonth,onSearch:setSearch,onPage:()=>{},onRefresh:()=>{}};return <MemoryRouter><main className="mx-auto max-w-7xl bg-brand-canvas p-4 md:p-8"><p className="mb-5 font-semibold">VERIFIKASI LOKAL · SEMUA DATA CONTOH</p>{scope==='own'?<MySalesDashboard {...props}/>:<TeamSalesDashboard {...props} metric="poDeliveryValue" onMetric={()=>{}}/>}</main></MemoryRouter>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
