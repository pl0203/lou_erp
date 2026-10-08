/** Persistent synthetic backend: mutations change rows separately from their acknowledgement. */
export function customerBackend() {
  const state = {
    customers: [{ id: 'c', name: 'Alpha shop', address: null, city: 'Jakarta', phone: null, email: null, pricing_tier: 'luar_kota', customer_category: null, visit_frequency_days: 7, last_visit_date: null }] as any[],
    assignments: [] as any[],
    writes: [] as { table: string; op: string; payload: any; filters: any }[],
    reads: [] as { table: string; projection: string }[],
    customerResponse: 'ok', assignmentResponse: 'ok', readError: false,
    rpcReads: 0,
  }
  function from(table: string) {
    let op = 'read', payload: any, projection = '*', filters: Record<string, any> = {}, start = 0, end = Infinity, single = false
    const q: any = {
      select: (value = '*') => { projection = value; return q },
      insert: (value: any) => { op = 'insert'; payload = value; return q },
      update: (value: any) => { op = 'update'; payload = value; return q },
      upsert: (value: any) => { op = 'upsert'; payload = value; return q },
      delete: () => { op = 'delete'; return q },
      eq: (key: string, value: any) => { filters[key] = value; return q },
      order: () => q, in: () => q, or: () => q, abortSignal: () => q,
      range: (a: number, b: number) => { start = a; end = b; return q },
      single: () => { single = true; return q },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        const rows = table === 'customers' ? state.customers : table === 'customer_manager_assignments' ? state.assignments
          : table === 'users' ? [{ id: 'm', full_name: 'Manager One', is_active: true }, { id: 'm2', full_name: 'Manager Two', is_active: true }]
          : table === 'products' ? [{ id: 'p', sku: 'SKU', name: 'Product p', size: null, unit_price: 100, harga_pokok: 0, luar_kota: 20, dalam_kota: 30, depo_bangunan: 40 }]
          : table === 'purchase_orders' ? [{ id: 'po', po_number: 'PO', customer_id: 'c', customers: { name: 'Alpha shop' }, status: 'in_progress', order_date: '2026-10-01', updated_at: '2026-10-01T00:00:00Z', total_value: 246.9, notes: null, expected_delivery_date: null }] : []
        const matching = (row: any) => Object.entries(filters).every(([k, v]) => row[k] === v)
        let returned: any[]
        if (op === 'read') {
          state.reads.push({ table, projection })
          if (table === 'customers' && state.readError) return { data: null, error: new Error('Read denied'), count: null }
          returned = rows.filter(matching)
        } else {
          state.writes.push({ table, op, payload: payload && { ...payload }, filters: { ...filters } })
          const mode = table === 'customers' ? state.customerResponse : state.assignmentResponse
          if (mode === 'denied' || mode === 'error') return { data: null, error: new Error(mode === 'denied' ? 'Permission denied' : 'Save failed') }
          if (op === 'insert') { const row = { id: payload.id ?? 'generated', ...payload }; rows.push(row); returned = [row] }
          else if (op === 'update') { returned = rows.filter(matching); returned.forEach(row => Object.assign(row, payload)) }
          else if (op === 'upsert') {
            const row = rows.find(row => row.customer_id === payload.customer_id)
            if (row) Object.assign(row, payload)
            else rows.push({ id: 'assignment', ...payload })
            returned = rows.filter(row => row.customer_id === payload.customer_id)
          } else { returned = rows.filter(matching); returned.forEach(row => rows.splice(rows.indexOf(row), 1)) }
          if (mode === 'transport') throw new Error('Connection lost after commit')
          if (mode === 'null') return { data: null, error: null }
          if (mode === 'empty') return { data: [], error: null }
          if (mode === 'mismatch') return { data: [{ id: 'unrelated', customer_id: 'unrelated', manager_id: 'unrelated' }], error: null }
        }
        const count = returned.length
        const data = returned.slice(start, end + 1).map(row => {
          const copy = { ...row }
          if (table === 'customer_manager_assignments') copy.managers = { id: copy.manager_id, full_name: copy.manager_id === 'm2' ? 'Manager Two' : 'Manager One' }
          if (projection === '*') return copy
          return Object.fromEntries(Object.entries(copy).filter(([key]) => projection.split(',').some(part => part.trim() === key || part.trim().startsWith(`${key}(`) || part.trim().startsWith(`${key}:`))))
        })
        return { data: single ? data[0] ?? null : data, error: null, count }
      }).then(resolve, reject),
    }
    return q
  }
  function rpc(_name: string, args: any) {
    const q: any = { abortSignal: () => q, then: (resolve: any) => {
      state.rpcReads++
      return Promise.resolve({ data: { version: 1, as_of: '2026-10-01T00:00:00Z', page: args.p_page, page_size: 100, total: 1, po_updated_at: '2026-10-01T00:00:00Z', po_has_delivery_history: true,
        items: [{ id: 'historical', product_id:null,product_name: 'Historical', sku: 'OLD', quantity: 2, unit_price: '123.45', line_total: '246.90', delivered_quantity: 1, has_delivery_history: true }] }, error: null }).then(resolve)
    } }
    return q
  }
  return { state, from, rpc, auth: { getUser: async () => ({ data: { user: { id: 'actor' } } }) } }
}
