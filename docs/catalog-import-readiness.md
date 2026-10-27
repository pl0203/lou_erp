# Nullable catalog prices and Others

The approved import mapping leaves every price on newly imported products unknown and maps customer groups outside the four existing tiers to Others. Existing products and historical PO line prices keep their values. Original source category and row identity remain in the private import manifest.

Migration `202610010010_nullable_catalog_prices.sql` adds `others` to the existing enum, removes defaults and NOT NULL from the five product price columns, and removes the promotion fallback from an unknown tier to Luar Kota. Its preflight pins the existing transaction function body, owner/access boundary and column/enum contracts. It does not grant new rights or change regular sales-item manual-price permissions.

The matching client must distinguish a missing price from a legitimate zero. Selecting an unpriced catalog item leaves the price blank and requires explicit entry before an order is submitted. Ordinary sales items retain their existing manual-price behavior. Promotions require the actual promotion override for the customer's known tier; Others and missing overrides are unavailable. Historical order prices do not depend on current catalog values.

## Staging sequence and stop states

1. Review and pass the normal disposable PostgreSQL/app tests, including direct RPC price behavior and migration drift checks. No hosted schema change follows merely from local tests.
2. Obtain specific staging approval for the exact reviewed migration. Apply this additive schema change without importing rows or changing existing catalog values. Commit the enum addition before any statement uses the new Others value.
3. Deploy and verify the compatible guarded staging client. Check product null display/editing, Others customer selection, explicit regular prices, legitimate zero promotions and rejection of missing prices.
4. Only then request approval for exact clean master/PO counts and the private state-pinned import packet. Preserve existing synthetic masters and orders. Imported customers receive no invented manager or salesperson assignments; visibility continues to follow existing RLS.

If schema application fails, stop before the client/import step and inspect the transaction outcome. If client verification fails before import, retain the additive schema and repair the client; the existing data values have not changed. Once any NULL/Others rows are imported, the old client is unsafe because it may crash or invent fallback prices. Recovery must keep a compatible client and preserve current data, normally through a forward fix. Do not automatically restore NOT NULL/default-zero constraints, remove enum values, rewrite missing prices or delete imported rows. Any destructive recovery needs its own reviewed scope and user approval.

The import itself is a separate reviewed operation. Historical prices with unsupported precision, unknown units, ambiguous SKU/customer identity, conflicting PO numbers or unreconciled delivery records remain held as whole POs. Catalogue price blanks alone do not invalidate otherwise valid historical PO prices. No private workbook data or contact information belongs in this public repository.
