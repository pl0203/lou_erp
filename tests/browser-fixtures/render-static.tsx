import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {MemoryRouter} from 'react-router-dom'
import {MySalesDashboard} from '../../src/components/sales/MySalesDashboard'
import {TeamSalesDashboard} from '../../src/components/sales/TeamSalesDashboard'
import {dashboardFixture} from '../sales-dashboard/fixtures'
import {writeFileSync} from 'node:fs'
for(const scope of ['own','team','leadership'] as const){const data=dashboardFixture(scope,5);const props={data,month:data.month,search:'',onMonth:()=>{},onSearch:()=>{},onPage:()=>{},onRefresh:()=>{}};writeFileSync(`/tmp/sales-browser/static/${scope}-body.html`,renderToStaticMarkup(<MemoryRouter><main className="mx-auto max-w-7xl bg-brand-canvas p-4 md:p-8"><p className="mb-5 font-semibold">VERIFIKASI STATIS · DATA CONTOH</p>{scope==='own'?<MySalesDashboard {...props}/>:<TeamSalesDashboard {...props} metric="poDeliveryValue" onMetric={()=>{}}/>}</main></MemoryRouter>))}
