-- Narrow new-column capability only; preserve all existing role/RLS decisions.
-- Abort rather than granting a field to an identity that cannot already edit products.
DO $$ BEGIN
  IF NOT has_column_privilege('authenticated','public.products','name','INSERT')
    OR NOT has_column_privilege('authenticated','public.products','name','UPDATE')
    OR NOT has_column_privilege('authenticated','public.products','product_type','SELECT') THEN
    RAISE EXCEPTION 'Review existing product column privileges before Tipe rollout' USING ERRCODE='55000';
  END IF;
END $$;
GRANT INSERT(product_type), UPDATE(product_type) ON public.products TO authenticated;
