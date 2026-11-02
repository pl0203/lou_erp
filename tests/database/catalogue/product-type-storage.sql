-- Synthetic storage mechanics only; NOT authorization/concurrency acceptance.
SELECT pg_temp.type_assert((SELECT product_type IS NULL FROM public.products WHERE sku='LEGACY'),'legacy remains unclassified');
DO $$ DECLARE label text; BEGIN
  FOREACH label IN ARRAY ARRAY['Bonbon','Bak Cuci Piring','Wastafel','Batu Taman','Granite','Closet','Listello','Mosaic','Meja','Andesit','Pola','House Plint','Rumput Sintetis','Teracotta','Gentong','Air Mancur','Step Nosing'] LOOP
    INSERT INTO public.products(name,sku,product_type) VALUES('Synthetic',label,label);
  END LOOP;
END $$;
SELECT pg_temp.type_raises($q$INSERT INTO public.products(name,sku) VALUES('Missing','MISSING')$q$,'23514');
SELECT pg_temp.type_raises($q$INSERT INTO public.products(name,sku,product_type) VALUES('Invalid','INVALID','mosaic')$q$,'23514');
SELECT pg_temp.type_raises($q$UPDATE public.products SET name='Changed' WHERE sku='LEGACY'$q$,'23514');
SELECT pg_temp.type_raises($q$UPDATE public.products SET name=name WHERE sku='LEGACY'$q$,'23514');
SELECT pg_temp.type_raises($q$UPDATE public.products SET product_type=NULL WHERE sku='LEGACY'$q$,'23514');
UPDATE public.products SET is_enabled=false WHERE sku='LEGACY';
SELECT pg_temp.type_assert((SELECT product_type IS NULL AND NOT is_enabled FROM public.products WHERE sku='LEGACY'),'status only permits untouched legacy type');
UPDATE public.products SET is_enabled=true WHERE sku='LEGACY';
UPDATE public.products SET product_type='Mosaic' WHERE sku='LEGACY';
SELECT pg_temp.type_raises($q$UPDATE public.products SET product_type=NULL WHERE sku='LEGACY'$q$,'23514');
UPDATE public.products SET name='Typed edit' WHERE sku='LEGACY';
SELECT pg_temp.type_assert((SELECT product_type='Mosaic' AND name='Typed edit' FROM public.products WHERE sku='LEGACY'),'typed edits preserve classification');
SELECT 'TYPE_STORAGE_MECHANICS_PASSED';
-- Audit is private metadata, not a mutation of saved order quantities or prices.
SELECT pg_temp.type_assert((SELECT count(*)=18 FROM private.catalog_product_type_audit_v2),'17 creates plus legacy classification; name-only edit emits no type event');
SELECT pg_temp.type_assert((SELECT count(*)=1 FROM private.catalog_product_type_audit_v2 WHERE product_id=(SELECT id FROM public.products WHERE sku='LEGACY') AND old_type IS NULL AND new_type='Mosaic'),'legacy classification recorded once');

SELECT pg_temp.type_raises($q$UPDATE private.catalog_product_type_audit_v2 SET new_type='Granite'$q$,'23514');
SELECT pg_temp.type_raises($q$DELETE FROM private.catalog_product_type_audit_v2$q$,'23514');
SELECT pg_temp.type_raises($q$TRUNCATE private.catalog_product_type_audit_v2$q$,'23514');
