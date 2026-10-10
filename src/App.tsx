import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import COMonthlyReports from './pages/athel/co/COMonthlyReports'
import COMonthlyReport from './pages/athel/co/COMonthlyReport'
import COCustomerStock from './pages/athel/co/COCustomerStock'
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
import MyOrders from './pages/girard/MyOrders'
import MySalesSummary from './pages/girard/MySalesSummary'
import MyVisits from './pages/girard/MyVisits'
import GirardDashboard from './pages/girard/GirardDashboard'
import Promotions from './pages/girard/Promotions'

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
      <Route path="/girard/my-sales" element={<ProtectedRoute allowedRoles={['sales_person']}><MySalesSummary /></ProtectedRoute>} />
      <Route path="/girard/my-orders" element={
        <ProtectedRoute allowedRoles={GIRARD_ROLES}><MyOrders /></ProtectedRoute>
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

      {/* User administration stays executive-only; leave authority is server-controlled. */}
      <Route path="/ihr/users" element={
        <ProtectedRoute allowedRoles={EXECUTIVE_ONLY}><UserManagement /></ProtectedRoute>
      } />
      <Route path="/ihr/leave" element={
        <ProtectedRoute><LeaveManagement /></ProtectedRoute>
      } />

      {/* Default */}
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}
