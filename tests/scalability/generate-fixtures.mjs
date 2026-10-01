import { pathToFileURL } from 'node:url'

export function buildManifest(rows = 6000) {
  if (![6000, 30000].includes(rows)) throw new Error('Fixture size must be exactly 6000 or 30000 POs')
  const teamA = rows / 2
  const base = { purchase_orders: rows, po_line_items: rows * 10, surat_jalan: rows * 2, sj_line_items: rows * 20, girard_orders: rows, girard_order_items: rows * 10, po_audit_log: rows * 2, request_ledger: rows }
  const edges = { purchase_orders: 7, po_line_items: 7, surat_jalan: 5, sj_line_items: 5, girard_orders: 7, girard_order_items: 7, po_audit_log: 7, request_ledger: 7 }
  return {
    version: 1, purpose: 'disposable-pilot-ci', mode: 'manifest-only', window: { from: rows === 6000 ? '2025-10-01' : '2021-10-01', to: '2026-09-30', pos_per_month: 500 },
    base, edges, totals: Object.fromEntries(Object.keys(base).map(key => [key, base[key] + edges[key]])),
    dimensions: { users: 8, customers: 101, products: 10, assignments: 101, schedules: 101, customer_targets: 303, sales_targets: 12 },
    base_totals: { po_value: `${rows * 1000}.00`, delivered_value: `${rows * 500}.00`, outstanding_value: `${rows * 500}.00` },
    edge_totals: { po_value: '600.00', delivered_value: '180.00', outstanding_value: '420.00' },
    role_po_counts: { executive: rows + 7, managerA: teamA + 7, managerB: rows - teamA, salesA: teamA + 7, salesB: rows - teamA },
    edge_cases: ['undelivered', 'partial', 'complete', 'cancelled', 'void_history', 'zero_price', 'old_order_current_delivery'],
    estimated_heap_bytes: rows * 6200, estimate_note: 'Rough heap estimate only; indexes, WAL, TOAST and provider overhead are excluded. Measure actual bytes after isolated load.',
    actual_bytes: null, capacity_verified: false,
    limitations: ['No hosted writes or real credentials', 'No file uploads or camera proof', 'Schedules and target history are bounded dimensions, not a visit-volume capacity claim', 'No API/browser p95 measurement implied'],
  }
}

export function generateSql(rows, { target, permit } = {}) {
  const manifest = buildManifest(rows)
  if (target !== 'local-ci' || permit !== 'disposable-pilot-ci') throw new Error('SQL emission requires --target local-ci --permit disposable-pilot-ci')
  const perMonth = 500
  const startDate = rows === 6000 ? '2025-10-01' : '2021-10-01'
  return `-- GENERATED SYNTHETIC FIXTURE. Local disposable CI only; never a hosted migration.
BEGIN;
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(84001001);
DO $guard$ DECLARE t text; occupied boolean; BEGIN
 IF current_database()<>'pilot_test' OR (SELECT count(*) FROM public.pilot_fixture_marker)<>1 OR NOT EXISTS(SELECT 1 FROM public.pilot_fixture_marker WHERE purpose='disposable-pilot-ci') THEN RAISE EXCEPTION 'Disposable pilot_test marker required'; END IF;
 IF to_regclass('public.pilot_scale_manifest') IS NOT NULL THEN RAISE EXCEPTION 'Scale fixture already exists; use a fresh disposable database'; END IF;
 FOREACH t IN ARRAY ARRAY['users','customers','products','purchase_orders','po_line_items','surat_jalan','sj_line_items','girard_orders','girard_order_items','sales_schedules','outlet_visits','visit_photos','po_audit_log','customer_manager_assignments','customer_sales_rep_assignments','customer_targets','sales_targets','promotions','orders','order_line_items','outlets'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I)',t) INTO occupied;
  IF occupied THEN RAISE EXCEPTION 'Existing business rows in %, refusing synthetic load',t; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM private.pilot_order_requests) OR EXISTS(SELECT 1 FROM storage.objects) THEN RAISE EXCEPTION 'Existing identity, request or object records'; END IF;
END $guard$;
CREATE TABLE public.pilot_scale_manifest(manifest jsonb NOT NULL,loaded_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO public.pilot_scale_manifest(manifest) VALUES('${JSON.stringify(manifest).replaceAll("'", "''")}'::jsonb);
-- Bulk fixture setup alone skips business/audit triggers. Existing real transaction suites remain mandatory.
SET LOCAL session_replication_role='replica';
INSERT INTO auth.users(id) SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid FROM generate_series(1,8) i;
INSERT INTO public.users(id,full_name,email,role,is_active,manager_id)
SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'SCALE USER '||i,'scale-fixture-'||i||'@example.invalid',
 (CASE i WHEN 1 THEN 'executive' WHEN 2 THEN 'sales_manager' WHEN 3 THEN 'sales_manager' WHEN 4 THEN 'sales_person' WHEN 5 THEN 'sales_person' WHEN 6 THEN 'po_admin' WHEN 7 THEN 'sales_head' ELSE 'executive' END)::public.user_role,
 i<>8,CASE i WHEN 4 THEN '84000000-0000-0000-0000-000000000002'::uuid WHEN 5 THEN '84000000-0000-0000-0000-000000000003'::uuid END FROM generate_series(1,8) i;
INSERT INTO public.customers(id,name,city,visit_frequency_days)
SELECT md5('scale-customer-'||i)::uuid,'SCALE CUSTOMER '||lpad(i::text,3,'0'),'Synthetic City',7 FROM generate_series(1,101) i;
INSERT INTO public.products(id,name,sku,unit_price,harga_pokok,luar_kota,dalam_kota,depo_bangunan)
SELECT md5('scale-product-'||i)::uuid,'SCALE PRODUCT '||lpad(i::text,2,'0'),'SCALE-SKU-'||i,10,10,10,10,10 FROM generate_series(1,10) i;
INSERT INTO public.customer_manager_assignments(customer_id,manager_id,assigned_by)
SELECT md5('scale-customer-'||i)::uuid,CASE WHEN i%2=1 THEN '84000000-0000-0000-0000-000000000002'::uuid ELSE '84000000-0000-0000-0000-000000000003'::uuid END,'84000000-0000-0000-0000-000000000001' FROM generate_series(1,101) i;
INSERT INTO public.sales_schedules(id,outlet_id,sales_person_id,assigned_by,scheduled_date,status)
SELECT md5('scale-schedule-'||i)::uuid,md5('scale-customer-'||i)::uuid,CASE WHEN i%2=1 THEN '84000000-0000-0000-0000-000000000004'::uuid ELSE '84000000-0000-0000-0000-000000000005'::uuid END,'84000000-0000-0000-0000-000000000001','2026-09-30','pending' FROM generate_series(1,101) i;
INSERT INTO public.customer_targets(customer_id,year_month,target_value,set_by)
SELECT md5('scale-customer-'||i)::uuid,ym,amount,'84000000-0000-0000-0000-000000000001' FROM generate_series(1,101) i CROSS JOIN (VALUES('2025-10',1000),('2026-08',2000),('2026-10',3000)) t(ym,amount);
INSERT INTO public.sales_targets(user_id,year_month,target_value,set_by)
SELECT ('84000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,ym,amount,'84000000-0000-0000-0000-000000000001' FROM generate_series(2,5) i CROSS JOIN (VALUES('2025-10',1000),('2026-08',2000),('2026-10',3000)) t(ym,amount);
CREATE TEMP TABLE scale_seed ON COMMIT DROP AS
SELECT i,md5('scale-po-'||i)::uuid AS po_id,md5('scale-customer-'||(CASE WHEN i%2=1 THEN 2*(((i-1)/2)%51)+1 ELSE 2*(((i-1)/2)%50)+2 END))::uuid AS customer_id,
 CASE WHEN i%2=1 THEN '84000000-0000-0000-0000-000000000004'::uuid ELSE '84000000-0000-0000-0000-000000000005'::uuid END AS actor,
 ('${startDate}'::date+((i-1)/${perMonth})*interval '1 month')::date AS day FROM generate_series(1,${rows}) i;
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,created_at,updated_at)
SELECT po_id,customer_id,'84000000-0000-0000-0000-000000000006','SCALE-PO-'||lpad(i::text,6,'0'),'in_progress',day,1000,day::timestamp AT TIME ZONE 'UTC',day::timestamp AT TIME ZONE 'UTC' FROM scale_seed;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5(s.po_id::text||'-line-'||n)::uuid,s.po_id,'SCALE PRODUCT '||lpad(n::text,2,'0'),'SCALE-SKU-'||n,10,10 FROM scale_seed s CROSS JOIN generate_series(1,10) n;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,reviewed_by,status,po_id,total_value,created_at)
SELECT md5(s.po_id::text||'-sales')::uuid,customer_id,actor,'84000000-0000-0000-0000-000000000006','approved',po_id,1000,day::timestamp AT TIME ZONE 'UTC' FROM scale_seed s;
INSERT INTO public.girard_order_items(order_id,product_id,product_name,sku,quantity,unit_price)
SELECT md5(s.po_id::text||'-sales')::uuid,md5('scale-product-'||n)::uuid,'SCALE PRODUCT '||lpad(n::text,2,'0'),'SCALE-SKU-'||n,10,10 FROM scale_seed s CROSS JOIN generate_series(1,10) n;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by)
SELECT md5(s.po_id::text||'-sj-'||n)::uuid,po_id,'SCALE-SJ-'||n,day+n*5,'84000000-0000-0000-0000-000000000006' FROM scale_seed s CROSS JOIN generate_series(1,2) n;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5(s.po_id::text||'-sj-'||h)::uuid,md5(s.po_id::text||'-line-'||n)::uuid,CASE h WHEN 1 THEN 2 ELSE 3 END FROM scale_seed s CROSS JOIN generate_series(1,2) h CROSS JOIN generate_series(1,10) n;
INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,old_value,new_value,changed_at)
SELECT po_id,'84000000-0000-0000-0000-000000000006','synthetic_fixture_event',NULL,'SCALE EVENT '||n,day::timestamp AT TIME ZONE 'UTC' FROM scale_seed CROSS JOIN generate_series(1,2) n;
INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,result,created_at)
SELECT '84000000-0000-0000-0000-000000000006',md5(po_id::text||'-request')::uuid,'create_po','{"synthetic_fixture":true}'::jsonb,jsonb_build_object('id',po_id),day::timestamp AT TIME ZONE 'UTC' FROM scale_seed;
CREATE TEMP TABLE scale_edges(kind text,price numeric,qty integer,delivered integer,voided boolean,status public.po_status,day date) ON COMMIT DROP;
INSERT INTO scale_edges VALUES
 ('undelivered',10,10,0,false,'confirm','2026-09-01'),('partial',10,10,3,false,'in_progress','2026-09-01'),
 ('complete',10,10,10,false,'complete','2026-09-01'),('cancelled',10,10,0,false,'cancelled','2026-09-01'),
 ('void_history',10,10,10,true,'confirm','2026-09-01'),('zero_price',0,10,5,false,'in_progress','2026-09-01'),
 ('old_order_current_delivery',10,10,5,false,'in_progress','2025-01-01');
INSERT INTO public.purchase_orders(id,customer_id,created_by,po_number,status,order_date,total_value,created_at,updated_at,completed_at)
SELECT md5('scale-edge-'||kind)::uuid,md5('scale-customer-1')::uuid,'84000000-0000-0000-0000-000000000006','SCALE-EDGE-'||kind,status,day,price*qty,day::timestamp AT TIME ZONE 'UTC',day::timestamp AT TIME ZONE 'UTC',CASE WHEN status='complete' THEN '2026-09-30T00:00:00Z'::timestamptz END FROM scale_edges;
INSERT INTO public.po_line_items(id,purchase_order_id,product_name,sku,quantity,unit_price)
SELECT md5('scale-edge-line-'||kind)::uuid,md5('scale-edge-'||kind)::uuid,'SCALE EDGE '||kind,'SCALE-EDGE-'||kind,qty,price FROM scale_edges;
INSERT INTO public.girard_orders(id,customer_id,submitted_by,reviewed_by,status,po_id,total_value,created_at)
SELECT md5('scale-edge-sales-'||kind)::uuid,md5('scale-customer-1')::uuid,'84000000-0000-0000-0000-000000000004','84000000-0000-0000-0000-000000000006',CASE WHEN status='cancelled' THEN 'cancelled' ELSE 'approved' END,md5('scale-edge-'||kind)::uuid,qty*price,'2026-09-01T00:00:00Z' FROM scale_edges;
INSERT INTO public.girard_order_items(order_id,product_name,sku,quantity,unit_price)
SELECT md5('scale-edge-sales-'||kind)::uuid,'SCALE EDGE '||kind,'SCALE-EDGE-'||kind,qty,price FROM scale_edges;
INSERT INTO public.surat_jalan(id,purchase_order_id,sj_number,sj_date,created_by,voided_at,voided_by,void_reason)
SELECT md5('scale-edge-sj-'||kind)::uuid,md5('scale-edge-'||kind)::uuid,'SCALE-EDGE-SJ','2026-09-15','84000000-0000-0000-0000-000000000006',CASE WHEN voided THEN '2026-09-16T00:00:00Z'::timestamptz END,CASE WHEN voided THEN '84000000-0000-0000-0000-000000000006'::uuid END,CASE WHEN voided THEN 'Synthetic void history' END FROM scale_edges WHERE delivered>0;
INSERT INTO public.sj_line_items(surat_jalan_id,po_line_item_id,quantity_delivered)
SELECT md5('scale-edge-sj-'||kind)::uuid,md5('scale-edge-line-'||kind)::uuid,delivered FROM scale_edges WHERE delivered>0;
INSERT INTO public.po_audit_log(purchase_order_id,changed_by,field_changed,new_value)
SELECT md5('scale-edge-'||kind)::uuid,'84000000-0000-0000-0000-000000000006','synthetic_edge',kind FROM scale_edges;
INSERT INTO private.pilot_order_requests(actor_id,request_id,operation,payload,result)
SELECT '84000000-0000-0000-0000-000000000006',md5('scale-edge-request-'||kind)::uuid,'create_po','{"synthetic_fixture":true}'::jsonb,jsonb_build_object('id',md5('scale-edge-'||kind)::uuid) FROM scale_edges;
SET LOCAL session_replication_role='origin';
ANALYZE;
-- Counts and referential checks are required before this synthetic-only transaction commits.
DO $verify$ BEGIN
 IF (SELECT count(*) FROM public.purchase_orders)<>${rows + 7} OR (SELECT count(*) FROM public.po_line_items)<>${rows * 10 + 7} OR (SELECT count(*) FROM public.surat_jalan)<>${rows * 2 + 5} OR (SELECT count(*) FROM public.sj_line_items)<>${rows * 20 + 5} THEN RAISE EXCEPTION 'Generated fixture counts mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.po_line_items l LEFT JOIN public.purchase_orders p ON p.id=l.purchase_order_id WHERE p.id IS NULL)
 OR EXISTS(SELECT 1 FROM public.sj_line_items d LEFT JOIN public.surat_jalan s ON s.id=d.surat_jalan_id LEFT JOIN public.po_line_items l ON l.id=d.po_line_item_id WHERE s.id IS NULL OR l.id IS NULL OR s.purchase_order_id<>l.purchase_order_id) THEN RAISE EXCEPTION 'Synthetic relationship mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.purchase_orders p LEFT JOIN public.customers c ON c.id=p.customer_id LEFT JOIN public.users u ON u.id=p.created_by WHERE c.id IS NULL OR u.id IS NULL)
 OR EXISTS(SELECT 1 FROM public.girard_orders o LEFT JOIN public.purchase_orders p ON p.id=o.po_id LEFT JOIN public.customers c ON c.id=o.customer_id LEFT JOIN public.users u ON u.id=o.submitted_by WHERE p.id IS NULL OR c.id IS NULL OR u.id IS NULL)
 OR EXISTS(SELECT 1 FROM public.girard_order_items l LEFT JOIN public.girard_orders o ON o.id=l.order_id LEFT JOIN public.products p ON p.id=l.product_id WHERE o.id IS NULL OR (l.product_id IS NOT NULL AND p.id IS NULL))
 OR EXISTS(SELECT 1 FROM public.po_audit_log a LEFT JOIN public.purchase_orders p ON p.id=a.purchase_order_id LEFT JOIN public.users u ON u.id=a.changed_by WHERE p.id IS NULL OR u.id IS NULL) THEN RAISE EXCEPTION 'Synthetic actor/customer/order relationship mismatch'; END IF;
 IF (SELECT sum(total_value) FROM public.purchase_orders)<>${rows * 1000 + 600} THEN RAISE EXCEPTION 'Fixture PO value mismatch'; END IF;
END $verify$;
COMMIT;
SELECT 'SYNTHETIC_SCALE_FIXTURE_LOADED' AS result,pg_database_size(current_database()) AS observed_database_bytes;
`
}

function main(args) {
  const allowed = new Set(['--rows','--target','--permit','--emit-sql'])
  const options = {}; let emit = false
  for (let i=0;i<args.length;i++) {
    const arg=args[i]; if(!allowed.has(arg)) throw new Error('Unknown fixture argument')
    if(arg==='--emit-sql') { emit=true; continue }
    if(!args[i+1] || args[i+1].startsWith('--')) throw new Error('Missing fixture argument value')
    if(options[arg]!==undefined) throw new Error('Duplicate fixture argument')
    options[arg]=args[++i]
  }
  const rows=options['--rows']===undefined?6000:Number(options['--rows'])
  process.stdout.write(emit?generateSql(rows,{target:options['--target'],permit:options['--permit']}):JSON.stringify(buildManifest(rows),null,2)+'\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)) } catch(error) { process.stderr.write(`${error.message}\n`); process.exitCode=1 }
}
