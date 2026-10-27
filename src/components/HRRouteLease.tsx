import { Outlet } from 'react-router-dom'
import { useEmployeeContext } from '../lib/employees/useEmployeeContext'

/** Own the finite HR feature lease across sibling routes. Page-local observers
 * may come and go without mistaking navigation for a complete HR feature exit.
 * Leaving HR still releases the last owner and retires all display/authority. */
export default function HRRouteLease() {
  useEmployeeContext()
  return <Outlet />
}
