import type { ReactNode } from 'react'

// Small original inline icons follow the stroke style already used by the app.
// Labels belong to the enclosing links/buttons, keeping SVGs decorative.
const shapes = {
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  purchase: <><path d="M8 4H5v17h14V4h-3M8 3h8v4H8zM8 12h8M8 16h5" /></>,
  orders: <><path d="M4 4h16v16H4zM4 14h5l2 3h2l2-3h5M12 6v6m-3-3 3 3 3-3" /></>,
  customers: <><path d="M3 10h18l-2-6H5zM5 10v11h14V10M9 21v-6h6v6M4 10v2m5-2v2m6-2v2m5-2v2" /></>,
  products: <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Zm0 0 9 4 9-4M12 11v10M7 5l10 4" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M7 14h3m4 0h3m-10 3h3" /></>,
  visit: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  people: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3" /></>,
  manager: <><circle cx="12" cy="6" r="3" /><path d="M6 21v-4a6 6 0 0 1 12 0v4M10 12l2 3 2-3m-2 3-1 5 1 1 1-1-1-5" /></>,
  promotion: <><path d="M3 4h8l10 10-7 7L3 10V4Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
  leave: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18m-13 5 3 3 5-5" /></>,
  sales: <><path d="M4 20V4M4 20h17M8 15l4-5 4 2 5-7m-5 0h5v5" /></>,
  home: <><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" /></>,
  logout: <><path d="M10 3H4v18h6m0-9h11m-4-4 4 4-4 4" /></>,
} satisfies Record<string, ReactNode>

export type NavigationIconName = keyof typeof shapes
export default function NavigationIcon({ name, className = '' }: { name: NavigationIconName; className?: string }) {
  return <svg aria-hidden="true" focusable="false" className={`navigation-icon ${className}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>
}
