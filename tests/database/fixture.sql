-- FICTIONAL, MINIMAL TEST CONTRACT. Not a production export or a deployable baseline.
-- No real records, project identifiers or credentials. auth/storage are local API stubs.
-- Broad fixture policies intentionally exercise restrictive candidate policies.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE TYPE public.user_role AS ENUM ('po_admin','sales_person','sales_manager','sales_head','executive');
CREATE TYPE public.pricing_tier AS ENUM ('harga_pokok','luar_kota','dalam_kota','depo_bangunan');
CREATE TYPE public.po_status AS ENUM ('draft','confirmed','shipped','delivered','delayed','cancelled','confirm','in_progress','complete');
CREATE TYPE public.schedule_status AS ENUM ('pending','completed','missed');
CREATE TABLE public.users(id uuid PRIMARY KEY REFERENCES auth.users(id),full_name text NOT NULL,email text UNIQUE NOT NULL,role public.user_role NOT NULL DEFAULT 'sales_person',is_active boolean NOT NULL DEFAULT true,manager_id uuid REFERENCES public.users(id),phone text,birth_date date,created_at timestamptz NOT NULL DEFAULT now(),invited_at timestamptz);
CREATE TABLE public.customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,address text,city text,phone text,email text,pricing_tier public.pricing_tier NOT NULL DEFAULT 'luar_kota',visit_frequency_days integer NOT NULL DEFAULT 7,last_visit_date date,created_at timestamptz DEFAULT now());
CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,sku text UNIQUE NOT NULL,size text,unit_price numeric(14,2) NOT NULL DEFAULT 0,harga_pokok numeric(14,2) NOT NULL DEFAULT 0,luar_kota numeric(14,2) NOT NULL DEFAULT 0,dalam_kota numeric(14,2) NOT NULL DEFAULT 0,depo_bangunan numeric(14,2) NOT NULL DEFAULT 0);
CREATE TABLE public.customer_manager_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid UNIQUE NOT NULL REFERENCES public.customers(id),manager_id uuid NOT NULL REFERENCES public.users(id),assigned_by uuid NOT NULL REFERENCES public.users(id),assigned_at timestamptz DEFAULT now());
CREATE TABLE public.customer_sales_rep_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid UNIQUE NOT NULL REFERENCES public.customers(id),sales_rep_id uuid NOT NULL REFERENCES public.users(id),assigned_by uuid REFERENCES public.users(id));
CREATE TABLE public.customer_targets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES public.customers(id),year_month text NOT NULL,target_value numeric(14,2) DEFAULT 0,set_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(customer_id,year_month));
CREATE TABLE public.sales_targets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),year_month text NOT NULL,target_value numeric(14,2) DEFAULT 0,set_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,year_month));
CREATE TABLE public.sales_schedules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outlet_id uuid NOT NULL REFERENCES public.customers(id),sales_person_id uuid NOT NULL REFERENCES public.users(id),assigned_by uuid NOT NULL REFERENCES public.users(id),scheduled_date date NOT NULL,status public.schedule_status NOT NULL DEFAULT 'pending',notes text,created_at timestamptz DEFAULT now(),UNIQUE(outlet_id,scheduled_date));
CREATE TABLE public.outlet_visits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outlet_id uuid NOT NULL REFERENCES public.customers(id),sales_person_id uuid NOT NULL REFERENCES public.users(id),schedule_id uuid REFERENCES public.sales_schedules(id),checked_in_at timestamptz NOT NULL DEFAULT now(),lat numeric(9,6),lng numeric(9,6),notes text);
CREATE TABLE public.visit_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),visit_id uuid NOT NULL REFERENCES public.outlet_visits(id),storage_path text NOT NULL,lat numeric(9,6),lng numeric(9,6),taken_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.purchase_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES public.customers(id),created_by uuid NOT NULL REFERENCES public.users(id),po_number text UNIQUE NOT NULL,status public.po_status NOT NULL DEFAULT 'draft',order_date date NOT NULL DEFAULT CURRENT_DATE,expected_delivery_date date,total_value numeric(14,2) NOT NULL DEFAULT 0,notes text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE TABLE public.po_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,product_name text NOT NULL,sku text,quantity integer NOT NULL CHECK(quantity>0),unit_price numeric(14,2) NOT NULL CHECK(unit_price>=0),line_total numeric(14,2) GENERATED ALWAYS AS (quantity::numeric*unit_price) STORED);
CREATE TABLE public.po_audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),changed_by uuid NOT NULL REFERENCES public.users(id),field_changed text NOT NULL,old_value text,new_value text,changed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.promotions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_id uuid NOT NULL REFERENCES public.products(id),start_date date NOT NULL,end_date date NOT NULL,harga_pokok numeric(14,2) NOT NULL DEFAULT 0,luar_kota numeric(14,2) NOT NULL DEFAULT 0,dalam_kota numeric(14,2) NOT NULL DEFAULT 0,depo_bangunan numeric(14,2) NOT NULL DEFAULT 0,created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz DEFAULT now(),is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.girard_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES public.customers(id),visit_id uuid REFERENCES public.outlet_visits(id),submitted_by uuid NOT NULL REFERENCES public.users(id),reviewed_by uuid REFERENCES public.users(id),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),rejection_note text,po_id uuid REFERENCES public.purchase_orders(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),total_value numeric(14,2) NOT NULL DEFAULT 0,source text NOT NULL DEFAULT 'sales_initiated');
CREATE TABLE public.girard_order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.girard_orders(id),product_id uuid REFERENCES public.products(id),product_name text NOT NULL,sku text,quantity integer NOT NULL CHECK(quantity>0),unit_price numeric(14,2) NOT NULL DEFAULT 0,is_promo boolean NOT NULL DEFAULT false,promotion_id uuid REFERENCES public.promotions(id));
CREATE TABLE public.surat_jalan(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id),sj_number text NOT NULL,sj_date date NOT NULL,sj_date_received date,sj_date_returned date,created_by uuid NOT NULL REFERENCES public.users(id),created_at timestamptz DEFAULT now(),UNIQUE(purchase_order_id,sj_number));
CREATE TABLE public.sj_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),surat_jalan_id uuid NOT NULL REFERENCES public.surat_jalan(id) ON DELETE CASCADE,po_line_item_id uuid NOT NULL REFERENCES public.po_line_items(id),quantity_delivered integer NOT NULL CHECK(quantity_delivered>=0));
-- Legacy compatibility shells only; not an attempted recreation of old product behavior.
CREATE TABLE public.outlets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,last_visit_date date);
CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outlet_id uuid REFERENCES public.outlets(id),sales_person_id uuid REFERENCES public.users(id),purchase_order_id uuid REFERENCES public.purchase_orders(id));
CREATE TABLE public.order_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES public.orders(id));
CREATE FUNCTION public.current_user_role() RETURNS public.user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT role FROM public.users WHERE id=auth.uid() $$;
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT ALL ON public.%I TO anon,authenticated,service_role',t);
  IF t<>'outlet_visits' THEN EXECUTE format('CREATE POLICY fixture_read ON public.%I FOR SELECT TO authenticated USING(true)',t); END IF;
 END LOOP;
END $$;
CREATE POLICY fixture_visit_read ON public.outlet_visits FOR SELECT TO authenticated USING(public.current_user_role() IN ('sales_manager','sales_head','executive') OR sales_person_id=auth.uid());
CREATE POLICY fixture_users_update ON public.users FOR UPDATE TO authenticated USING(id=auth.uid() OR public.current_user_role()='executive') WITH CHECK(id=auth.uid() OR public.current_user_role()='executive');
CREATE POLICY fixture_users_admin ON public.users FOR INSERT TO authenticated WITH CHECK(public.current_user_role()='executive');
CREATE POLICY promotions_write ON public.promotions FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY customer_targets_write ON public.customer_targets FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY sales_targets_write ON public.sales_targets FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY cma_head_all ON public.customer_manager_assignments FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY sched_manager_all ON public.sales_schedules FOR ALL TO authenticated USING(false) WITH CHECK(false);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customers','products','outlets','girard_orders','girard_order_items','purchase_orders','po_line_items','surat_jalan','sj_line_items','visit_photos','orders','order_line_items','customer_sales_rep_assignments'] LOOP
  EXECUTE format('CREATE POLICY fixture_write ON public.%I FOR ALL TO authenticated USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
-- Minimal audit/total hooks needed by migration interfaces; these are not exported production bodies.
CREATE FUNCTION public.log_line_item_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed) VALUES(coalesce(NEW.purchase_order_id,OLD.purchase_order_id),auth.uid(),'fixture_line_write'); RETURN coalesce(NEW,OLD); END $$;
CREATE FUNCTION public.log_sj_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed) VALUES(coalesce(NEW.purchase_order_id,OLD.purchase_order_id),auth.uid(),'fixture_delivery_write'); RETURN coalesce(NEW,OLD); END $$;
CREATE FUNCTION public.log_po_changes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at:=now(); RETURN NEW; END $$;
CREATE FUNCTION public.recalculate_po_total() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE public.purchase_orders SET total_value=(SELECT coalesce(sum(line_total),0) FROM public.po_line_items WHERE purchase_order_id=coalesce(NEW.purchase_order_id,OLD.purchase_order_id)) WHERE id=coalesce(NEW.purchase_order_id,OLD.purchase_order_id); RETURN coalesce(NEW,OLD); END $$;
CREATE FUNCTION public.check_po_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN coalesce(NEW,OLD); END $$;
CREATE FUNCTION public.update_outlet_last_visit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_log_po_changes BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.log_po_changes();
CREATE TRIGGER fixture_log_lines AFTER INSERT OR UPDATE OR DELETE ON public.po_line_items FOR EACH ROW EXECUTE FUNCTION public.log_line_item_changes();
CREATE TRIGGER fixture_recalculate AFTER INSERT OR UPDATE OR DELETE ON public.po_line_items FOR EACH ROW EXECUTE FUNCTION public.recalculate_po_total();
CREATE TRIGGER trg_check_po_completion AFTER INSERT OR UPDATE OR DELETE ON public.sj_line_items FOR EACH ROW EXECUTE FUNCTION public.check_po_completion();
CREATE TRIGGER fixture_log_sj AFTER INSERT OR UPDATE OR DELETE ON public.surat_jalan FOR EACH ROW EXECUTE FUNCTION public.log_sj_changes();
CREATE TRIGGER fixture_last_visit AFTER INSERT ON public.outlet_visits FOR EACH ROW EXECUTE FUNCTION public.update_outlet_last_visit();
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,public boolean NOT NULL DEFAULT false);
INSERT INTO storage.buckets VALUES('visits',false);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text NOT NULL,owner_id text,UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
GRANT ALL ON storage.objects TO anon,authenticated,service_role;
CREATE POLICY visits_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='visits' AND auth.uid() IS NOT NULL);
CREATE POLICY visits_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='visits' AND auth.uid() IS NOT NULL);

CREATE POLICY fixture_visit_insert ON public.outlet_visits FOR INSERT TO authenticated WITH CHECK(true);
CREATE TABLE public.pilot_fixture_marker(purpose text PRIMARY KEY);
INSERT INTO public.pilot_fixture_marker VALUES('disposable-pilot-ci');
