import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './lib/AuthContext'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

// Keep the existing route and provider tree. The data-router shell enables the
// supported navigation blocker used by unsaved forms, including Back/Forward.
const router = createBrowserRouter([{ path: '*', element:
  <QueryClientProvider client={queryClient}>
    <AuthProvider><App /></AuthProvider>
  </QueryClientProvider>,
}])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
