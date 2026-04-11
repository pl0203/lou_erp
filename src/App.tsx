import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'

import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Landing from './pages/Landing'

import POList from './pages/athel/POList'
import PODetail from './pages/athel/PODetail'
import PONew from './pages/athel/PONew'
import POEdit from './pages/athel/POEdit'
import CustomerList from './pages/athel/CustomerList'
import ProductList from './pages/athel/ProductList'

import DailySchedule from './pages/girard/DailySchedule'
import OutletDetail from './pages/girard/OutletDetail'
import ManagerDashboard from './pages/girard/ManagerDashboard'
import GirardCustomers from './pages/girard/GirardCustomers'
import GirardManagers from './pages/girard/GirardManagers'
import GirardPerformance from './pages/girard/GirardPerformance'
import GirardRevenue from './pages/girard/GirardRevenue'

import UserManagement from './pages/ihr/UserManagement'
import LeaveManagement from './pages/ihr/LeaveManagement'

import VisitPage from './pages/girard/VisitPage'
import GirardCustomerDetail from './pages/girard/GirardCustomerDetail'

const ATHEL_ROLES    = ['po_admin', 'executive']
const GIRARD_ROLES   = ['sales_person', 'sales_manager', 'sales_head', 'executive']
const EXECUTIVE_ONLY = ['executive']
const MANAGER_UP     = ['sales_manager', 'sales_head', 'executive']
const HEAD_UP        = ['sales_head', 'executive']

export default function App() {
  const { loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

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
      <Route path="/athel/po" element={
        <ProtectedRoute allowedRoles={ATHEL_ROLES}><POList /></ProtectedRoute>
      } />
      <Route path="/athel/po/new" element={
        <ProtectedRoute allowedRoles={ATHEL_ROLES}><PONew /></ProtectedRoute>
      } />
      <Route path="/athel/po/:id" element={
        <ProtectedRoute allowedRoles={ATHEL_ROLES}><PODetail /></ProtectedRoute>
      } />
      <Route path="/athel/po/:id/edit" element={
        <ProtectedRoute allowedRoles={ATHEL_ROLES}><POEdit /></ProtectedRoute>
      } />
      <Route path="/athel/customers" element={
        <ProtectedRoute allowedRoles={ATHEL_ROLES}><CustomerList /></ProtectedRoute>
      } />
      <Route path="/athel/products" element={
        <ProtectedRoute allowedRoles={ATHEL_ROLES}><ProductList /></ProtectedRoute>
      } />

      {/* Girard — all sales roles */}
      <Route path="/girard/schedule" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><DailySchedule /></ProtectedRoute>
      } />
      <Route path="/girard/outlet/:id" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><OutletDetail /></ProtectedRoute>
      } />
      <Route path="/girard/dashboard" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><ManagerDashboard /></ProtectedRoute>
      } />

      {/* Girard — manager and above */}
      <Route path="/girard/team" element={
        <ProtectedRoute allowedRoles={MANAGER_UP}><GirardManagers /></ProtectedRoute>
      } />
      <Route path="/girard/performance" element={
        <ProtectedRoute allowedRoles={MANAGER_UP}><GirardPerformance /></ProtectedRoute>
      } />

      {/* Girard — sales head and executive */}
      <Route path="/girard/customers" element={
        <ProtectedRoute allowedRoles={HEAD_UP}><GirardCustomers /></ProtectedRoute>
      } />
      <Route path="/girard/managers" element={
        <ProtectedRoute allowedRoles={HEAD_UP}><GirardManagers /></ProtectedRoute>
      } />
      <Route path="/girard/revenue" element={
        <ProtectedRoute allowedRoles={HEAD_UP}><GirardRevenue /></ProtectedRoute>
      } />

      {/* iHR — executive only */}
      <Route path="/ihr/users" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><UserManagement /></ProtectedRoute>
      } />
      <Route path="/ihr/leave" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><LeaveManagement /></ProtectedRoute>
      } />

      <Route path="/girard/visit/:scheduleId" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><VisitPage /></ProtectedRoute>
      } />
      <Route path="/girard/customer/:id" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><GirardCustomerDetail /></ProtectedRoute>
      } />

      {/* Default */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}