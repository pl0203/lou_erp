import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CustomerList from './source/src/pages/athel/CustomerList'
import { FixturePanel } from './fixture'
import './source/src/index.css'
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><FixturePanel/><CustomerList/></QueryClientProvider></StrictMode>)
