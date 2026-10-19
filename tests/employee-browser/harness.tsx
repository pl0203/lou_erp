import React from 'react'
import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {createBrowserRouter,RouterProvider,Outlet,Navigate} from 'react-router-dom'
import EmployeeList from '../../src/pages/ihr/employees/EmployeeList'
import EmployeeDetail from '../../src/pages/ihr/employees/EmployeeDetail'
import EmployeeEditor from '../../src/pages/ihr/employees/EmployeeEditor'
import EmployeeReportingEditor from '../../src/pages/ihr/employees/EmployeeReportingEditor'
import {Controls} from './fixture'
import './styles.css'
import '../../src/styles/ui.css'
import './harness.css'
const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
function Layout(){return <QueryClientProvider client={client}><Outlet/><Controls/><div className="qa-banner">SYNTHETIC · source-bound component preview · no real HR data</div></QueryClientProvider>}
const router=createBrowserRouter([{element:<Layout/>,children:[{path:'/',element:<Navigate to="/ihr/employees" replace/>},{path:'/ihr/employees',element:<EmployeeList/>},{path:'/ihr/employees/new',element:<EmployeeEditor/>},{path:'/ihr/employees/:employeeId',element:<EmployeeDetail/>},{path:'/ihr/employees/:employeeId/edit',element:<EmployeeEditor/>},{path:'/ihr/employees/:employeeId/reporting',element:<EmployeeReportingEditor/>},{path:'*',element:<p>Outside the synthetic employee fixture.</p>}]}])
createRoot(document.getElementById('root')!).render(<RouterProvider router={router}/>)
