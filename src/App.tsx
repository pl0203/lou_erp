import HRRouteLease from './components/HRRouteLease'
import SessionLoading from './components/SessionLoading'
import { Routes, Route, Navigate, matchPath, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from './lib/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import COMonthlyReports from './pages/athel/co/COMonthlyReports'
import COMonthlyReport from './pages/athel/co/COMonthlyReport'
import COCustomerStock from './pages/athel/co/COCustomerStock'
import COStockReturns from './pages/athel/co/COStockReturns'
import COLayout from './pages/athel/co/COLayout'
import COOrders from './pages/athel/co/COOrders'
import COForm from './pages/athel/co/COForm'
import CODetail from './pages/athel/co/CODetail'

import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Landing from './pages/Landing'

import POList from './pages/athel/POList'
import PODetail from './pages/athel/PODetail'
import PONew from './pages/athel/PONew'
import POEdit from './pages/athel/POEdit'
import AthelDashboard from './pages/athel/Dashboard'
import CustomerList from './pages/athel/CustomerList'
import ProductList from './pages/athel/ProductList'
import SalesOrders from './pages/athel/SalesOrders'
import AthelPromotions from './pages/athel/Promotions'
import OwnVisitHistory from './pages/girard/OwnVisitHistory'

import DailySchedule from './pages/girard/DailySchedule'
import VisitRequests from './pages/girard/VisitRequests'
import ManagerSchedule from './pages/girard/ManagerSchedule'
import VisitPage from './pages/girard/VisitPage'
import GirardCustomerDetail from './pages/girard/GirardCustomerDetail'
import OutletDetail from './pages/girard/OutletDetail'
import GirardCustomers from './pages/girard/GirardCustomers'
import GirardManagers from './pages/girard/GirardManagers'
import GirardTeam from './pages/girard/GirardTeam'
import ManagerCustomers from './pages/girard/ManagerCustomers'
import MySalesSummary from './pages/girard/MySalesSummary'
import SalesTargets from './pages/girard/SalesTargets'
import MyVisits from './pages/girard/MyVisits'
import GirardDashboard from './pages/girard/GirardDashboard'
import Promotions from './pages/girard/Promotions'

import { useEmployeeIdentityBoundary } from './lib/employees/useEmployeeContext'
import EmployeeList from './pages/ihr/employees/EmployeeList'
import EmployeeDetail from './pages/ihr/employees/EmployeeDetail'
import EmployeeEditor from './pages/ihr/employees/EmployeeEditor'
import EmployeeReportingEditor from './pages/ihr/employees/EmployeeReportingEditor'
import UserManagement from './pages/ihr/UserManagement'
import LeaveManagement from './pages/ihr/LeaveManagement'

const PO_ROLES = ['po_admin', 'executive']
const CO_ROLES = ['co_admin', 'executive']
const MASTER_ROLES = ['po_admin', 'co_admin', 'executive']
const GIRARD_ROLES   = ['sales_person', 'sales_manager', 'sales_head', 'executive']
const EXECUTIVE_ONLY = ['executive']
const MANAGER_UP     = ['sales_manager', 'sales_head', 'executive']
const HEAD_UP        = ['sales_head', 'executive']

function RoleBasedSchedule() {
  const { profile } = useAuth()
  if (profile?.role === 'sales_person') return <DailySchedule />
  return <ManagerSchedule />
}

const routeTitles: [string, string][] = [
  ['/ihr/employees/new', 'Tambah karyawan'], ['/ihr/employees/:employeeId/edit', 'Ubah karyawan'],
  ['/ihr/employees/:employeeId/reporting', 'Atasan pelaporan'], ['/ihr/employees/:employeeId', 'Detail karyawan'], ['/ihr/employees', 'Data karyawan'],
  ['/login', 'Masuk'], ['/forgot-password', 'Reset kata sandi'], ['/reset-password', 'Buat kata sandi baru'],
  ['/landing', 'Pilih sistem'], ['/athel/dashboard', 'Dashboard Procurement'],
  ['/athel/po/new', 'Buat purchase order'], ['/athel/po/:id/edit', 'Ubah purchase order'],
  ['/athel/po/:id', 'Detail purchase order'], ['/athel/po', 'Purchase order'],
  ['/athel/customers', 'Daftar pelanggan Procurement'], ['/athel/products', 'Daftar barang'],
  ['/athel/sales-orders', 'Pesanan penjualan'], ['/athel/promotions', 'Promosi Procurement'],
  ['/athel/co/reports/:customerId/:month', 'Laporan konsinyasi bulanan'],
  ['/athel/co/reports', 'Laporan konsinyasi'], ['/athel/co/stock/*', 'Stok konsinyasi'], ['/athel/co/returns', 'Stock Return'],
  ['/athel/co/new', 'Buat pesanan konsinyasi'], ['/athel/co/:id/edit', 'Ubah pesanan konsinyasi'],
  ['/athel/co/:id', 'Detail pesanan konsinyasi'], ['/athel/co', 'Pesanan konsinyasi'],
  ['/girard/visit-requests', 'Permintaan kunjungan'], ['/girard/visit-history', 'Riwayat kunjungan saya'],
  ['/girard/schedule', 'Jadwal kunjungan'], ['/girard/visit/:scheduleId', 'Detail kunjungan'],
  ['/girard/customer/:id', 'Detail pelanggan Sales'], ['/girard/outlet/:id', 'Detail outlet'],
  ['/girard/targets', 'Target Penjualan'], ['/girard/my-sales', 'Ringkasan penjualan saya'], ['/girard/my-orders', 'Jadwal kunjungan'],
  ['/girard/my-visits', 'Kunjungan saya'], ['/girard/team', 'Tim Sales'],
  ['/girard/dashboard', 'Dashboard Sales'], ['/girard/my-customers', 'Pelanggan saya'],
  ['/girard/customers', 'Daftar pelanggan Sales'], ['/girard/managers', 'Manajer Sales'],
  ['/girard/promotions', 'Promosi Sales'], ['/ihr/users', 'Akun & Akses'], ['/ihr/leave', 'Manajemen cuti'],
]

export default function App() {
  useEmployeeIdentityBoundary()
  const { loading } = useAuth()
  const { pathname } = useLocation()
  useEffect(() => {
    const title = routeTitles.find(([path]) => matchPath(path, pathname))?.[1]
    document.title = title ? `${title} | Padiwan` : 'Padiwan'
  }, [pathname])

  // Keep the public login card mounted while its own sign-in is being verified.
  // All private routes remain behind the unchanged authorization guards.
  if (loading && !matchPath('/login', pathname)) return <SessionLoading />

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Executive landing */}
      <Route path="/landing" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}>
          <Landing />
        </ProtectedRoute>
      } />

      {/* Athel */}
      <Route path="/athel/dashboard" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><AthelDashboard /></ProtectedRoute>
      } />
      <Route path="/athel/po" element={
        <ProtectedRoute allowedRoles={PO_ROLES}><POList /></ProtectedRoute>
      } />
      <Route path="/athel/po/new" element={
        <ProtectedRoute allowedRoles={PO_ROLES}><PONew /></ProtectedRoute>
      } />
      <Route path="/athel/po/:id" element={
        <ProtectedRoute allowedRoles={PO_ROLES}><PODetail /></ProtectedRoute>
      } />
      <Route path="/athel/po/:id/edit" element={
        <ProtectedRoute allowedRoles={PO_ROLES}><POEdit /></ProtectedRoute>
      } />
      <Route path="/athel/customers" element={
        <ProtectedRoute allowedRoles={MASTER_ROLES}><CustomerList /></ProtectedRoute>
      } />
      <Route path="/athel/products" element={
        <ProtectedRoute allowedRoles={MASTER_ROLES}><ProductList /></ProtectedRoute>
      } />
      <Route path="/athel/sales-orders" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><SalesOrders /></ProtectedRoute>
      } />

      <Route path="/athel/promotions" element={<ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><AthelPromotions /></ProtectedRoute>} />

      {/* Task 8 installs the order screens inside this checked route family. */}
      <Route path="/athel/co" element={<ProtectedRoute allowedRoles={CO_ROLES}><COLayout /></ProtectedRoute>}>
        <Route index element={<COOrders />} />
        <Route path="new" element={<COForm mode="create" />} />
        <Route path="reports" element={<COMonthlyReports />} />
        <Route path="reports/:customerId/:month" element={<COMonthlyReport />} />
        <Route path="stock/*" element={<COCustomerStock />} />
        <Route path="returns" element={<COStockReturns />} />
        <Route path=":id/edit" element={<COForm mode="edit" />} />
        <Route path=":id" element={<CODetail />} />
      </Route>

      {/* Girard — all roles */}
      <Route path="/girard/visit-requests" element={<ProtectedRoute allowedRoles={GIRARD_ROLES}><VisitRequests /></ProtectedRoute>} />
      <Route path="/girard/visit-history" element={<ProtectedRoute allowedRoles={GIRARD_ROLES}><OwnVisitHistory /></ProtectedRoute>} />
      <Route path="/girard/schedule" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}>
          <RoleBasedSchedule />
        </ProtectedRoute>
      } />
      <Route path="/girard/visit/:scheduleId" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><VisitPage /></ProtectedRoute>
      } />
      <Route path="/girard/customer/:id" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><GirardCustomerDetail /></ProtectedRoute>
      } />
      <Route path="/girard/outlet/:id" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><OutletDetail /></ProtectedRoute>
      } />
      <Route path="/girard/targets" element={<ProtectedRoute allowedRoles={GIRARD_ROLES}><SalesTargets /></ProtectedRoute>} />
      <Route path="/girard/my-sales" element={<ProtectedRoute allowedRoles={['sales_person']}><MySalesSummary /></ProtectedRoute>} />
      {/* Retired legacy history: old bookmarks return to the current Sales workspace. */}
      <Route path="/girard/my-orders" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><Navigate to="/girard/schedule" replace /></ProtectedRoute>
      } />
      
      {/* Girard — manager and above */}
      <Route path="/girard/my-visits" element={
        <ProtectedRoute allowedRoles={MANAGER_UP}><MyVisits /></ProtectedRoute>
      } />
      <Route path="/girard/team" element={
        <ProtectedRoute allowedRoles={MANAGER_UP}><GirardTeam /></ProtectedRoute>
      } />
      <Route path="/girard/dashboard" element={
        <ProtectedRoute allowedRoles={MANAGER_UP}><GirardDashboard /></ProtectedRoute>
      } />
      <Route path="/girard/my-customers" element={
        <ProtectedRoute allowedRoles={MANAGER_UP}><ManagerCustomers /></ProtectedRoute>
      } />

      {/* Girard — sales head and executive */}
      <Route path="/girard/customers" element={
        <ProtectedRoute allowedRoles={HEAD_UP}><GirardCustomers /></ProtectedRoute>
      } />
      <Route path="/girard/managers" element={
        <ProtectedRoute allowedRoles={HEAD_UP}><GirardManagers /></ProtectedRoute>
      } />
      <Route path="/girard/promotions" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><Promotions /></ProtectedRoute>
      } />

      {/* Keep HR navigation authority mounted across sibling pages, not outside HR. */}
      <Route element={<ProtectedRoute><HRRouteLease /></ProtectedRoute>}>
      {/* User administration stays executive-only; leave authority is server-controlled. */}
      <Route path="/ihr/users" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><UserManagement /></ProtectedRoute>
      } />
      <Route path="/ihr/leave" element={
        <ProtectedRoute><LeaveManagement /></ProtectedRoute>
      } />

      <Route path="/ihr/employees" element={<ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><EmployeeList /></ProtectedRoute>} />
      <Route path="/ihr/employees/new" element={<ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><EmployeeEditor /></ProtectedRoute>} />
      <Route path="/ihr/employees/:employeeId" element={<ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><EmployeeDetail /></ProtectedRoute>} />
      <Route path="/ihr/employees/:employeeId/edit" element={<ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><EmployeeEditor /></ProtectedRoute>} />
      <Route path="/ihr/employees/:employeeId/reporting" element={<ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><EmployeeReportingEditor /></ProtectedRoute>} />

      </Route>

      {/* Default */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
