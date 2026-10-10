-- Read-only aggregate preview. Run again immediately before a separately approved rollout.
-- No customer names, user names, order numbers, contacts or item contents are returned.
WITH canonical AS MATERIALIZED (
 SELECT c.id AS customer_id,a.id AS assignment_id,a.manager_id,
 CASE WHEN u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive') THEN a.manager_id END AS owner_id,
 CASE WHEN u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive') THEN a.id END AS source_id,
 u.role,u.manager_id AS reporting_manager_id
 FROM public.customers c LEFT JOIN public.customer_manager_assignments a ON a.customer_id=c.id LEFT JOIN public.users u ON u.id=a.manager_id),
 planned AS MATERIALIZED (
 SELECT p.id,p.customer_id,p.sales_person_id_at_creation AS old_owner,p.sales_assignment_source_id AS old_source,p.sales_attribution_state AS old_state,
 c.owner_id,c.source_id,CASE WHEN c.owner_id IS NULL THEN 'unassigned' ELSE 'assigned' END AS new_state,
 EXISTS(SELECT 1 FROM public.girard_orders g WHERE g.po_id=p.id) AS linked
 FROM public.purchase_orders p JOIN canonical c ON c.customer_id=p.customer_id)
SELECT jsonb_build_object(
 'observed_at',statement_timestamp(),
 'customers',(SELECT count(*) FROM canonical),
 'explicit_assignments',(SELECT count(*) FROM canonical WHERE assignment_id IS NOT NULL),
 'eligible_owners',(SELECT count(*) FROM canonical WHERE owner_id IS NOT NULL),
 'ineligible_existing_owners',(SELECT count(*) FROM canonical WHERE assignment_id IS NOT NULL AND owner_id IS NULL),
 'secondary_assignments',(SELECT count(*) FROM public.customer_sales_rep_assignments),
 'conflicting_secondary_assignments',(SELECT count(*) FROM public.customer_sales_rep_assignments s JOIN canonical c ON c.customer_id=s.customer_id WHERE s.sales_rep_id IS DISTINCT FROM c.manager_id),
 'purchase_orders',(SELECT count(*) FROM planned),
 'owner_id_changes',(SELECT count(*) FROM planned WHERE old_owner IS DISTINCT FROM owner_id),
 'assignment_source_or_state_changes',(SELECT count(*) FROM planned WHERE ROW(old_source,old_state) IS DISTINCT FROM ROW(source_id,new_state)),
 'assigned_after',(SELECT count(*) FROM planned WHERE owner_id IS NOT NULL),
 'unassigned_after',(SELECT count(*) FROM planned WHERE owner_id IS NULL),
 'legacy_linked_pos',(SELECT count(*) FROM planned WHERE linked),
 'duplicate_legacy_links',(SELECT count(*) FROM (SELECT po_id FROM public.girard_orders WHERE po_id IS NOT NULL GROUP BY po_id HAVING count(*)>1) x),
 'mismatched_legacy_customers',(SELECT count(*) FROM public.girard_orders g JOIN public.purchase_orders p ON p.id=g.po_id WHERE g.customer_id<>p.customer_id),
 'owner_role_counts',(SELECT coalesce(jsonb_object_agg(role,n),'{}') FROM (SELECT role::text,count(*) n FROM canonical WHERE owner_id IS NOT NULL GROUP BY role) x),
 'mapping_fingerprint',(SELECT md5(coalesce(string_agg(to_jsonb(c)::text,'|' ORDER BY customer_id),'')) FROM canonical c),
 'credit_fingerprint',(SELECT md5(coalesce(string_agg(to_jsonb(p)::text,'|' ORDER BY id),'')) FROM planned p)
) AS store_owner_preview;
