-- Hand-written synthetic projections of exact repository source columns.
-- This is NOT a hosted-schema parity proof. No real records or credentials.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon;
CREATE TYPE public.user_role AS ENUM('sales_person','sales_manager','sales_head','executive','po_admin','co_admin');
CREATE TABLE public.users(id uuid PRIMARY KEY,full_name text NOT NULL,role public.user_role NOT NULL,is_active boolean NOT NULL DEFAULT true,manager_id uuid REFERENCES public.users(id));
CREATE TABLE public.customers(id uuid PRIMARY KEY,name text NOT NULL,created_at timestamptz DEFAULT now());
CREATE TABLE public.customer_manager_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid UNIQUE REFERENCES public.customers(id),manager_id uuid REFERENCES public.users(id),version bigint NOT NULL DEFAULT 1);
CREATE TABLE public.purchase_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid REFERENCES public.customers(id),order_date date,status text,total_value numeric,sales_person_id_at_creation uuid,sales_attribution_state text,sales_assignment_source_id uuid,sales_attributed_at timestamptz);
CREATE TABLE public.po_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid REFERENCES public.purchase_orders(id),unit_price numeric);
CREATE TABLE public.surat_jalan(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid REFERENCES public.purchase_orders(id),sj_date date,voided_at timestamptz);
CREATE TABLE public.sj_line_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),surat_jalan_id uuid REFERENCES public.surat_jalan(id),po_line_item_id uuid REFERENCES public.po_line_items(id),quantity_delivered integer);
CREATE TABLE public.sales_schedules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outlet_id uuid,sales_person_id uuid,scheduled_date date,status text);
CREATE TABLE public.outlet_visits(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outlet_id uuid,sales_person_id uuid,checked_in_at timestamptz,schedule_id uuid);
CREATE TABLE public.visit_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),requester_id uuid,customer_id uuid,scheduled_date date,status text);
CREATE TABLE public.sales_targets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,year_month text,target_value numeric);
CREATE TABLE private.co_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,status text,sales_person_id_at_creation uuid,sales_attribution_state text);
CREATE TABLE private.co_customer_state(customer_id uuid PRIMARY KEY,effective_generation_id uuid);
CREATE TABLE private.co_delivery_heads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,co_id uuid,current_revision_id uuid);
CREATE TABLE private.co_delivery_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),head_id uuid,customer_id uuid,co_id uuid,sj_date date,is_void boolean NOT NULL DEFAULT false);
CREATE TABLE private.co_delivery_revision_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),revision_id uuid,customer_id uuid,co_id uuid,quantity integer, batch_id uuid);
CREATE TABLE private.co_report_heads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,report_month date,current_revision_id uuid);
CREATE TABLE private.co_report_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),head_id uuid,customer_id uuid,coverage_through_date date,is_partial_month boolean);
CREATE TABLE private.co_stock_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid,co_id uuid,unit_price numeric,sales_person_id_at_creation uuid);
CREATE TABLE private.co_sale_allocations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),generation_id uuid,customer_id uuid,report_revision_id uuid,batch_id uuid,quantity integer,amount numeric,sales_person_id_at_creation uuid);
CREATE TABLE private.co_stock_movements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),generation_id uuid,customer_id uuid,batch_id uuid,effective_date date,quantity_delta numeric);
INSERT INTO public.users VALUES
('10000000-0000-4000-8000-000000000001','Executive','executive',true,null),
('10000000-0000-4000-8000-000000000002','Head','sales_head',true,'10000000-0000-4000-8000-000000000001'),
('10000000-0000-4000-8000-000000000003','Manager','sales_manager',true,'10000000-0000-4000-8000-000000000002'),
('10000000-0000-4000-8000-000000000004','Rep A','sales_person',true,'10000000-0000-4000-8000-000000000003'),
('10000000-0000-4000-8000-000000000005','Rep B','sales_person',true,'10000000-0000-4000-8000-000000000003'),
('10000000-0000-4000-8000-000000000006','Other Head','sales_head',true,null),
('10000000-0000-4000-8000-000000000007','Other Manager','sales_manager',true,'10000000-0000-4000-8000-000000000006'),
('10000000-0000-4000-8000-000000000008','Predecessor','sales_person',true,'10000000-0000-4000-8000-000000000007'),
('10000000-0000-4000-8000-000000000009','Inactive','sales_person',false,'10000000-0000-4000-8000-000000000003'),
('10000000-0000-4000-8000-000000000010','Admin','po_admin',true,null);
INSERT INTO public.customers VALUES
('20000000-0000-4000-8000-000000000001','Transferred store','2020-01-01'),
('20000000-0000-4000-8000-000000000002','Second store','2020-01-01'),
('20000000-0000-4000-8000-000000000003','Manager exclusive store','2020-01-01');
INSERT INTO public.customer_manager_assignments(customer_id,manager_id) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003');
INSERT INTO public.purchase_orders(customer_id,order_date,status,total_value,sales_person_id_at_creation,sales_attribution_state)
SELECT c,('2026-04-01'::date + (n||' months')::interval)::date,'confirm',v[n+1],'10000000-0000-4000-8000-000000000008','assigned'
FROM (VALUES('20000000-0000-4000-8000-000000000001'::uuid,ARRAY[10,20,30,60,80,100]),('20000000-0000-4000-8000-000000000002'::uuid,ARRAY[10,20,30,20,40,60])) x(c,v),generate_series(0,5)n;
CREATE FUNCTION public.test_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message; END IF;END$$;
CREATE FUNCTION public.test_denied(statement text,message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege THEN RETURN; END; RAISE EXCEPTION 'EXPECTED DENIED: %',message;END$$;
CREATE FUNCTION public.test_rejected(statement text,message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE statement; EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE '23514' OR SQLSTATE '40001' OR SQLSTATE '55000' OR SQLSTATE '23505' THEN RETURN; END; RAISE EXCEPTION 'EXPECTED REJECTED: %',message;END$$;
CREATE FUNCTION public.test_lines() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_agg(jsonb_build_object('personId',person,'metric',metric,'amount','120.00','applicability','target','reason','Manual synthetic review, incomplete or adjusted baseline'))
 FROM unnest(ARRAY['10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005'])person CROSS JOIN unnest(ARRAY['po_order_value','po_delivery_value','co_sale_value'])metric
$$;
CREATE FUNCTION public.test_payload(month date) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN jsonb_build_object('month',month,'managerId','10000000-0000-4000-8000-000000000003','expectedVersion',NULL,'rosterHash',public.pilot_sales_target_baseline_v1(month,'10000000-0000-4000-8000-000000000003')->>'rosterHash','lines',public.test_lines()); END
$$;
