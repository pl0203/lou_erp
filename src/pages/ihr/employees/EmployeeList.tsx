import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ActionLink } from '../../../components/ui/ActionLink'
import { Field } from '../../../components/ui/Field'
import { useEmployeePage } from '../../../lib/employees/useEmployeeReads'
import type { EmployeeStatus } from '../../../lib/employees/contracts'
import { characterCount,characterError,EmployeeShell,EmployeeReadState,EmptyState,Pagination,RecordedStatus } from './EmployeeUI'

export default function EmployeeList() {
 const [query,setQuery]=useState(''),[status,setStatus]=useState<EmployeeStatus|null>(null),[page,setPage]=useState(1)
 const read=useEmployeePage({query,status,page}),data=read.displayData,ready=read.authorityReady&&!!read.data
 return <EmployeeShell ready={ready} displayReady={!!data} refreshing={read.refreshing} draftGeneration={read.draftGeneration} title="Data Karyawan" description="Data dasar dan riwayat pelaporan. Status dan tanggal berakhir membatasi akses akun tertaut." actions={data?<ActionLink aria-disabled={!ready||undefined} tabIndex={ready?undefined:-1} onClick={event=>{if(!ready)event.preventDefault()}} to="/ihr/employees/new">Tambah karyawan</ActionLink>:undefined}>
 {(read.authorityReady||data)&&<div className="employee-filters"><Field id="employee-search" label="Cari nama atau nomor karyawan" hint={characterCount(query,120)} error={characterError(query,120)}>{props=><input {...props} disabled={!read.authorityReady||read.refreshing} type="search" value={query} onChange={event=>{setQuery(event.target.value);setPage(1)}}/>}</Field><Field id="employee-status" label="Status">{props=><select {...props} disabled={!read.authorityReady||read.refreshing} value={status??''} onChange={event=>{setStatus((event.target.value||null)as EmployeeStatus|null);setPage(1)}}><option value="">Semua status</option><option value="draft">Draf</option><option value="active">Aktif</option><option value="inactive">Non-aktif</option><option value="ended">Berakhir tercatat</option></select>}</Field></div>}
 {data?<>{!data.rows.length?<EmptyState title={query||status?'Tidak ada karyawan yang cocok':'Belum ada data karyawan'}>Coba kata pencarian lain, atau tambahkan catatan karyawan tanpa membuat akun login.</EmptyState>:<table className="employee-directory"><caption className="sr-only">Daftar data karyawan</caption><thead><tr><th scope="col">Nama dan nomor</th><th scope="col">Jabatan</th><th scope="col">Tim</th><th scope="col">Status</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.id}><td data-label="Karyawan"><Link aria-disabled={!ready||undefined} tabIndex={ready?undefined:-1} onClick={event=>{if(!ready)event.preventDefault()}} className="employee-name" to={`/ihr/employees/${row.id}`}>{row.name}</Link><p className="employee-support">{row.employeeNumber||'Nomor belum diisi'}</p></td><td data-label="Jabatan">{row.jobTitle||'Belum diisi'}</td><td data-label="Tim">{row.team||'Belum diisi'}</td><td data-label="Status"><RecordedStatus status={row.recordedStatus}/></td></tr>)}</tbody></table>}<Pagination page={page} total={data.total} onPage={setPage} disabled={!ready}/></>:<EmployeeReadState state={read}/>}
 </EmployeeShell>
}
