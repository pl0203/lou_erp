// Fictional wrapper tests only. These source bodies are never hosted release inputs.
import { DEMO_TABLES,DEMO_MIGRATIONS,DEMO_NEW_TABLES } from '../../scripts/build-demo-rollout.mjs'
export const fixtureSql=`CREATE SCHEMA private; CREATE SCHEMA storage;
CREATE TABLE public.demo_rollout_fixture_marker(purpose text PRIMARY KEY,run_id text,source_sha text);
INSERT INTO public.demo_rollout_fixture_marker(purpose) VALUES('disposable-demo-rollout');
${DEMO_TABLES.map(r=>`CREATE TABLE ${r}(id text PRIMARY KEY${r==='public.users'?',role text,is_active boolean,manager_id text':r==='public.girard_orders'?',status text':r==='private.pilot_order_requests'?',operation text,payload jsonb,result jsonb,abandoned boolean DEFAULT false':r==='storage.buckets'?',name text,public boolean,file_size_limit bigint,allowed_mime_types text[]':',value text'});`).join('\n')}
INSERT INTO public.girard_orders VALUES('pending-1','pending'),('pending-2','pending');
INSERT INTO public.promotions VALUES('legacy-promo','preserve');
INSERT INTO public.purchase_orders VALUES('legacy-po','preserve');
INSERT INTO private.pilot_order_requests VALUES('old-request','create_po','{"old":"payload"}','{"old":"receipt"}',false),('old-tombstone','abandoned','{"old":"payload"}',null,true);
INSERT INTO storage.buckets VALUES('visits','visits',false,1,ARRAY['image/jpeg']);
INSERT INTO storage.objects VALUES('evidence','immutable');
CREATE FUNCTION public.untouched() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
CREATE FUNCTION public.changed() RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
`
export const sources=DEMO_MIGRATIONS.map((path,i)=>({path,sql:`-- Synthetic body ${i}\nBEGIN;\n${[
 `ALTER TABLE private.pilot_order_requests ADD COLUMN execution_version smallint NOT NULL DEFAULT 0;\nALTER TABLE public.purchase_orders ADD COLUMN sales_attribution_state text NOT NULL DEFAULT 'legacy', ADD COLUMN sales_person_id_at_creation uuid, ADD COLUMN sales_assignment_source_id uuid, ADD COLUMN sales_attributed_at timestamptz;\nALTER TABLE public.po_line_items ADD COLUMN product_id uuid;\nALTER TABLE public.promotions ADD COLUMN stock_managed boolean NOT NULL DEFAULT false,ADD COLUMN remaining_quantity bigint NOT NULL DEFAULT 0,ADD COLUMN stock_version bigint NOT NULL DEFAULT 1,ADD COLUMN image_path text;\n${Object.entries(DEMO_NEW_TABLES).map(([r,requests])=>`CREATE TABLE ${r}(id integer PRIMARY KEY${requests?',result jsonb,abandoned boolean NOT NULL DEFAULT false':''});`).join('\n')}`,
 `ALTER TABLE public.sales_schedules ADD COLUMN version integer NOT NULL DEFAULT 1;\nALTER TABLE public.outlet_visits ADD COLUMN note_version integer NOT NULL DEFAULT 1;`,
 `CREATE OR REPLACE FUNCTION public.changed() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;`,
 `INSERT INTO storage.buckets VALUES('promotion-images','promotion-images',false,5242880,ARRAY['image/jpeg','image/png','image/webp']);`,
][i]}\nCOMMIT;\n`}))
