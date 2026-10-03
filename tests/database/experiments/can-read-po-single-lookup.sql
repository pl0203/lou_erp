-- EXPERIMENT ONLY. Installed only inside guarded disposable rollback transactions.
-- No parent existence, actor activity/role, customer assignment or order-status filter.
CREATE OR REPLACE FUNCTION private.pilot_can_read_po(po uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.users caller
  WHERE caller.id=auth.uid() AND caller.is_active AND caller.role IS NOT NULL
  AND (
   caller.role IN ('po_admin','sales_head','executive')
   OR EXISTS (
    SELECT 1 FROM public.girard_orders linked
    LEFT JOIN public.users actor ON actor.id=linked.submitted_by
    WHERE linked.po_id=po AND (linked.submitted_by=caller.id
     OR (caller.role='sales_manager' AND actor.manager_id=caller.id)))
   OR EXISTS (
    SELECT 1 FROM public.orders linked
    LEFT JOIN public.users actor ON actor.id=linked.sales_person_id
    WHERE linked.purchase_order_id=po AND (linked.sales_person_id=caller.id
     OR (caller.role='sales_manager' AND actor.manager_id=caller.id)))
  )
 );
$$;
