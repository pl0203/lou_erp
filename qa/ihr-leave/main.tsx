// Candidate-only entry. Fictional data; no backend connection or mutation sender.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {createBrowserRouter,RouterProvider,Link} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import LeaveManagement from '../../src/pages/ihr/LeaveManagement'
import './candidate.css'
const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
const router=createBrowserRouter([{path:'/ihr/leave',element:<LeaveManagement/>},{path:'/',element:<LeaveManagement/>},{path:'*',element:<div className="p-8">Synthetic module destination. <Link to="/ihr/leave">Return to leave</Link></div>}]);
createRoot(document.getElementById('root')!).render(<><aside className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-950">Synthetic QA only · Changes are never saved. <a className="underline" href="/ihr/leave?role=manager">Manager</a> · <a className="underline" href="/ihr/leave?role=employee">Employee</a> · <a className="underline" href="/narrow.html">390px view</a><span className="ml-3">Revision: {import.meta.env.VITE_QA_REVISION}</span></aside><QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider></>);
