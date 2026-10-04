// @vitest-environment node
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'

const file = resolve('src/lib/reads/contracts.ts')
const contracts = existsSync(file) ? await import(file) : {}

test('the canonical read protocol fixes version and bounded page sizes', () => {
  expect(contracts.READ_CONTRACT_VERSION).toBe(1)
  expect(contracts.ORDINARY_PAGE_SIZE_LIMIT).toBe(100)
  expect(contracts.DAILY_PAGE_SIZE_LIMIT).toBe(366)
  expect(contracts.COMPLETE_READ_CHUNK).toBe(500)
  expect(contracts.RELATED_ID_CHUNK).toBe(100)
})

test('every approved read endpoint has one canonical name and parameter list', () => {
  expect(Object.keys(contracts.READ_RPC_DEFINITIONS ?? {}).sort()).toEqual([
    'pilot_athel_daily_v1', 'pilot_athel_summary_v1', 'pilot_customer_performance_v1',
    'pilot_customer_stats_v1', 'pilot_manager_customers_v1', 'pilot_po_lines_v1',
    'pilot_po_page_v1', 'pilot_revenue_v1', 'pilot_sales_order_page_v1',
    'pilot_sales_performance_v1', 'pilot_team_activity_v1',
  ])
  expect(contracts.READ_RPC_DEFINITIONS?.pilot_po_page_v1.params).toEqual(['p_status', 'p_search', 'p_page', 'p_page_size'])
  expect(contracts.READ_RPC_DEFINITIONS?.pilot_manager_customers_v1.params).toEqual(['p_manager_id', 'p_visit_from', 'p_as_of', 'p_page', 'p_page_size'])
  expect(contracts.READ_RPC_DEFINITIONS?.pilot_athel_daily_v1.pageLimit).toBe(366)
})

test('all-status results retain legacy PO statuses without adding new filter options', () => {
  expect(contracts.PO_OUTPUT_STATUSES).toEqual(['draft', 'confirmed', 'shipped', 'delivered', 'delayed', 'cancelled', 'confirm', 'in_progress', 'complete'])
  expect(contracts.PO_FILTER_STATUSES).toEqual(['all', 'draft', 'confirm', 'in_progress', 'complete', 'cancelled'])
})
