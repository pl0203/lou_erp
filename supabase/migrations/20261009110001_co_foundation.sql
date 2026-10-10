-- Additive CO foundation. No existing PO, promotion, visit or owner evidence is changed.
BEGIN;
SET LOCAL search_path='';
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

CREATE TABLE private.co_customer_state (
 customer_id uuid PRIMARY KEY REFERENCES public.customers(id),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), effective_generation_id uuid
);
CREATE TABLE private.co_stock_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 display_sku text NOT NULL CHECK(btrim(display_sku)<>''),
 normalized_sku text GENERATED ALWAYS AS (lower(btrim(display_sku))) STORED,
 -- Original catalog identity is a snapshot, deliberately not a cascading/current catalog FK.
 product_id uuid, product_name text NOT NULL CHECK(btrim(product_name)<>''),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(customer_id,normalized_sku), UNIQUE(id,customer_id)
);
CREATE TABLE private.co_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), status text NOT NULL DEFAULT 'active' CHECK(status IN('active','closed','cancelled')),
 co_number text NOT NULL UNIQUE CHECK(btrim(co_number)<>''), order_date date NOT NULL CHECK(isfinite(order_date)),
 expected_delivery_date date CHECK(isfinite(expected_delivery_date)), notes text,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sales_person_id_at_creation uuid, sales_assignment_source_id uuid, sales_attributed_at timestamptz NOT NULL,
 sales_attribution_state text NOT NULL,
 CHECK((sales_attribution_state='assigned' AND sales_person_id_at_creation IS NOT NULL AND sales_assignment_source_id IS NOT NULL)
 OR (sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL AND sales_assignment_source_id IS NULL)),
 UNIQUE(id,customer_id)
);
CREATE INDEX co_orders_customer ON private.co_orders(customer_id,id);
CREATE TABLE private.co_order_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), co_id uuid NOT NULL, customer_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 ordered_quantity integer NOT NULL CHECK(ordered_quantity>0), resolved_undelivered_quantity integer NOT NULL DEFAULT 0 CHECK(resolved_undelivered_quantity>=0 AND resolved_undelivered_quantity<=ordered_quantity),
 unit_price numeric NOT NULL CHECK(unit_price>=0 AND unit_price<=999999999999.99 AND scale(unit_price)<=2),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(co_id,customer_id) REFERENCES private.co_orders(id,customer_id),
 FOREIGN KEY(stock_key_id,customer_id) REFERENCES private.co_stock_keys(id,customer_id),
 UNIQUE(id,co_id,customer_id,stock_key_id)
);
CREATE INDEX co_order_lines_order ON private.co_order_lines(co_id,customer_id);
CREATE INDEX co_order_lines_stock ON private.co_order_lines(stock_key_id,customer_id);

CREATE TABLE private.co_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 kind text NOT NULL CHECK(kind IN('sj','report','return')), co_id uuid,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), report_month date,
 payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object'), eligible_set_fingerprint text,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='report' AND co_id IS NULL AND report_month IS NOT NULL AND isfinite(report_month) AND extract(day FROM report_month)=1)
 OR (kind='sj' AND co_id IS NOT NULL AND report_month IS NULL)
 OR (kind='return' AND report_month IS NULL)),
 FOREIGN KEY(co_id,customer_id) REFERENCES private.co_orders(id,customer_id),
 UNIQUE(id,customer_id), UNIQUE(id,customer_id,kind)
);
CREATE INDEX co_drafts_customer ON private.co_drafts(customer_id,id);
CREATE INDEX co_drafts_order ON private.co_drafts(co_id,customer_id);
CREATE UNIQUE INDEX co_one_report_draft ON private.co_drafts(customer_id,report_month) WHERE kind='report';
CREATE TABLE private.co_report_draft_lines (
 draft_id uuid NOT NULL, customer_id uuid NOT NULL, kind text NOT NULL DEFAULT 'report' CHECK(kind='report'), stock_key_id uuid NOT NULL,
 sold_quantity integer CHECK(sold_quantity>=0), PRIMARY KEY(draft_id,stock_key_id),
 FOREIGN KEY(draft_id,customer_id,kind) REFERENCES private.co_drafts(id,customer_id,kind),
 FOREIGN KEY(stock_key_id,customer_id) REFERENCES private.co_stock_keys(id,customer_id)
);
CREATE INDEX co_draft_lines_stock ON private.co_report_draft_lines(stock_key_id,customer_id);

CREATE TABLE private.co_delivery_heads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL, co_id uuid NOT NULL,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), current_revision_id uuid,
 original_creation_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(co_id,customer_id) REFERENCES private.co_orders(id,customer_id),
 UNIQUE(id,customer_id,co_id), UNIQUE(id,customer_id,co_id,original_creation_order)
);
CREATE INDEX co_delivery_heads_order ON private.co_delivery_heads(co_id,customer_id);
CREATE TABLE private.co_delivery_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), head_id uuid NOT NULL, customer_id uuid NOT NULL, co_id uuid NOT NULL,
 revision_no bigint NOT NULL CHECK(revision_no>0), sj_number text NOT NULL CHECK(btrim(sj_number)<>''),
 sj_date date NOT NULL CHECK(isfinite(sj_date)), received_date date CHECK(isfinite(received_date)), notes text, is_void boolean NOT NULL DEFAULT false,
 reason text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(revision_no=1 OR nullif(btrim(reason),'') IS NOT NULL),
 FOREIGN KEY(head_id,customer_id,co_id) REFERENCES private.co_delivery_heads(id,customer_id,co_id),
 UNIQUE(head_id,revision_no), UNIQUE(id,head_id,customer_id,co_id)
);
ALTER TABLE private.co_delivery_heads ADD CONSTRAINT co_delivery_current_revision_fk FOREIGN KEY(current_revision_id,id,customer_id,co_id) REFERENCES private.co_delivery_revisions(id,head_id,customer_id,co_id);
CREATE TABLE private.co_delivery_revision_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision_id uuid NOT NULL, head_id uuid NOT NULL, customer_id uuid NOT NULL, co_id uuid NOT NULL,
 co_line_id uuid NOT NULL, stock_key_id uuid NOT NULL, batch_id uuid NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
 FOREIGN KEY(revision_id,head_id,customer_id,co_id) REFERENCES private.co_delivery_revisions(id,head_id,customer_id,co_id),
 FOREIGN KEY(co_line_id,co_id,customer_id,stock_key_id) REFERENCES private.co_order_lines(id,co_id,customer_id,stock_key_id),
 UNIQUE(revision_id,batch_id), UNIQUE(id,customer_id,stock_key_id,batch_id), UNIQUE(id,head_id,customer_id,co_id,co_line_id,stock_key_id,batch_id)
);
CREATE INDEX co_delivery_lines_order_line ON private.co_delivery_revision_lines(co_line_id,co_id,customer_id,stock_key_id);
CREATE INDEX co_delivery_lines_batch ON private.co_delivery_revision_lines(batch_id,customer_id,stock_key_id);

CREATE TABLE private.co_report_heads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 report_month date NOT NULL CHECK(isfinite(report_month) AND extract(day FROM report_month)=1),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), current_revision_id uuid,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(customer_id,report_month), UNIQUE(id,customer_id)
);
CREATE TABLE private.co_report_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), head_id uuid NOT NULL, customer_id uuid NOT NULL,
 revision_no bigint NOT NULL CHECK(revision_no>0), coverage_through_date date NOT NULL CHECK(isfinite(coverage_through_date)),
 is_partial_month boolean NOT NULL, reason text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(revision_no=1 OR nullif(btrim(reason),'') IS NOT NULL),
 FOREIGN KEY(head_id,customer_id) REFERENCES private.co_report_heads(id,customer_id),
 UNIQUE(head_id,revision_no), UNIQUE(id,head_id,customer_id), UNIQUE(id,customer_id)
);
ALTER TABLE private.co_report_heads ADD CONSTRAINT co_report_current_revision_fk FOREIGN KEY(current_revision_id,id,customer_id) REFERENCES private.co_report_revisions(id,head_id,customer_id);
CREATE TABLE private.co_report_revision_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision_id uuid NOT NULL, head_id uuid NOT NULL, customer_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 sold_quantity integer NOT NULL CHECK(sold_quantity>=0),
 FOREIGN KEY(revision_id,head_id,customer_id) REFERENCES private.co_report_revisions(id,head_id,customer_id),
 FOREIGN KEY(stock_key_id,customer_id) REFERENCES private.co_stock_keys(id,customer_id),
 UNIQUE(revision_id,stock_key_id), UNIQUE(id,revision_id,customer_id,stock_key_id), UNIQUE(id,customer_id,stock_key_id)
);
CREATE INDEX co_report_lines_stock ON private.co_report_revision_lines(stock_key_id,customer_id);

CREATE TABLE private.co_return_heads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), current_revision_id uuid,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(id,customer_id)
);
CREATE INDEX co_return_heads_customer ON private.co_return_heads(customer_id,id);
CREATE TABLE private.co_return_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), head_id uuid NOT NULL, customer_id uuid NOT NULL,
 revision_no bigint NOT NULL CHECK(revision_no>0), return_date date NOT NULL CHECK(isfinite(return_date)),
 reference text, notes text, is_void boolean NOT NULL DEFAULT false, reason text,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(revision_no=1 OR nullif(btrim(reason),'') IS NOT NULL),
 FOREIGN KEY(head_id,customer_id) REFERENCES private.co_return_heads(id,customer_id),
 UNIQUE(head_id,revision_no), UNIQUE(id,head_id,customer_id)
);
ALTER TABLE private.co_return_heads ADD CONSTRAINT co_return_current_revision_fk FOREIGN KEY(current_revision_id,id,customer_id) REFERENCES private.co_return_revisions(id,head_id,customer_id);

CREATE TABLE private.co_stock_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL, co_id uuid NOT NULL, co_line_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 delivery_head_id uuid NOT NULL, original_delivery_line_id uuid NOT NULL UNIQUE, original_delivery_created_order bigint NOT NULL,
 unit_price numeric NOT NULL CHECK(unit_price>=0 AND unit_price<=999999999999.99 AND scale(unit_price)<=2),
 sales_person_id_at_creation uuid, sales_assignment_source_id uuid, sales_attributed_at timestamptz NOT NULL, sales_attribution_state text NOT NULL,
 CHECK((sales_attribution_state='assigned' AND sales_person_id_at_creation IS NOT NULL AND sales_assignment_source_id IS NOT NULL)
 OR (sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL AND sales_assignment_source_id IS NULL)),
 FOREIGN KEY(co_line_id,co_id,customer_id,stock_key_id) REFERENCES private.co_order_lines(id,co_id,customer_id,stock_key_id),
 FOREIGN KEY(delivery_head_id,customer_id,co_id,original_delivery_created_order) REFERENCES private.co_delivery_heads(id,customer_id,co_id,original_creation_order),
 FOREIGN KEY(original_delivery_line_id,delivery_head_id,customer_id,co_id,co_line_id,stock_key_id,id) REFERENCES private.co_delivery_revision_lines(id,head_id,customer_id,co_id,co_line_id,stock_key_id,batch_id) DEFERRABLE INITIALLY DEFERRED,
 UNIQUE(id,customer_id,stock_key_id), UNIQUE(id,delivery_head_id,customer_id,co_id,co_line_id,stock_key_id)
);
CREATE INDEX co_batches_order_line ON private.co_stock_batches(co_line_id,co_id,customer_id,stock_key_id);
CREATE INDEX co_batches_delivery ON private.co_stock_batches(delivery_head_id,customer_id,co_id,original_delivery_created_order);
CREATE INDEX co_batches_customer_fifo ON private.co_stock_batches(customer_id,stock_key_id,original_delivery_created_order,id);
ALTER TABLE private.co_delivery_revision_lines ADD CONSTRAINT co_delivery_line_batch_fk FOREIGN KEY(batch_id,head_id,customer_id,co_id,co_line_id,stock_key_id) REFERENCES private.co_stock_batches(id,delivery_head_id,customer_id,co_id,co_line_id,stock_key_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE private.co_return_revision_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision_id uuid NOT NULL, head_id uuid NOT NULL, customer_id uuid NOT NULL,
 batch_id uuid NOT NULL, stock_key_id uuid NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
 FOREIGN KEY(revision_id,head_id,customer_id) REFERENCES private.co_return_revisions(id,head_id,customer_id),
 FOREIGN KEY(batch_id,customer_id,stock_key_id) REFERENCES private.co_stock_batches(id,customer_id,stock_key_id),
 UNIQUE(revision_id,batch_id), UNIQUE(id,customer_id,stock_key_id,batch_id)
);
CREATE INDEX co_return_lines_batch ON private.co_return_revision_lines(batch_id,customer_id,stock_key_id);

CREATE TABLE private.co_replay_generations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 version bigint NOT NULL CHECK(version>0), algorithm_version text NOT NULL CHECK(btrim(algorithm_version)<>''),
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(customer_id,version), UNIQUE(id,customer_id)
);
ALTER TABLE private.co_customer_state ADD CONSTRAINT co_effective_generation_fk FOREIGN KEY(effective_generation_id,customer_id) REFERENCES private.co_replay_generations(id,customer_id);
CREATE TABLE private.co_stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), generation_id uuid NOT NULL, customer_id uuid NOT NULL, batch_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('delivery','return','sold')), quantity_delta numeric NOT NULL CHECK(scale(quantity_delta)=0 AND quantity_delta<>0 AND abs(quantity_delta)<='2147483647'::numeric),
 effective_date date NOT NULL CHECK(isfinite(effective_date)), delivery_revision_line_id uuid, return_revision_line_id uuid, report_revision_line_id uuid,
 CHECK((kind='delivery' AND quantity_delta>0 AND delivery_revision_line_id IS NOT NULL AND return_revision_line_id IS NULL AND report_revision_line_id IS NULL)
 OR (kind='return' AND quantity_delta<0 AND return_revision_line_id IS NOT NULL AND delivery_revision_line_id IS NULL AND report_revision_line_id IS NULL)
 OR (kind='sold' AND quantity_delta<0 AND report_revision_line_id IS NOT NULL AND delivery_revision_line_id IS NULL AND return_revision_line_id IS NULL)),
 FOREIGN KEY(generation_id,customer_id) REFERENCES private.co_replay_generations(id,customer_id),
 FOREIGN KEY(batch_id,customer_id,stock_key_id) REFERENCES private.co_stock_batches(id,customer_id,stock_key_id),
 FOREIGN KEY(delivery_revision_line_id,customer_id,stock_key_id,batch_id) REFERENCES private.co_delivery_revision_lines(id,customer_id,stock_key_id,batch_id),
 FOREIGN KEY(return_revision_line_id,customer_id,stock_key_id,batch_id) REFERENCES private.co_return_revision_lines(id,customer_id,stock_key_id,batch_id),
 FOREIGN KEY(report_revision_line_id,customer_id,stock_key_id) REFERENCES private.co_report_revision_lines(id,customer_id,stock_key_id)
);
CREATE INDEX co_movements_customer ON private.co_stock_movements(customer_id,generation_id,stock_key_id,effective_date,id);
CREATE INDEX co_movements_generation ON private.co_stock_movements(generation_id,customer_id);
CREATE INDEX co_movements_batch ON private.co_stock_movements(batch_id,customer_id,stock_key_id);
CREATE INDEX co_movements_delivery ON private.co_stock_movements(delivery_revision_line_id,customer_id,stock_key_id,batch_id);
CREATE INDEX co_movements_return ON private.co_stock_movements(return_revision_line_id,customer_id,stock_key_id,batch_id);
CREATE INDEX co_movements_report ON private.co_stock_movements(report_revision_line_id,customer_id,stock_key_id);
CREATE TABLE private.co_sale_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), generation_id uuid NOT NULL, customer_id uuid NOT NULL,
 report_revision_id uuid NOT NULL, report_revision_line_id uuid NOT NULL, batch_id uuid NOT NULL, stock_key_id uuid NOT NULL,
 quantity integer NOT NULL CHECK(quantity>0), unit_price numeric NOT NULL CHECK(unit_price>=0 AND unit_price<=999999999999.99 AND scale(unit_price)<=2),
 amount numeric GENERATED ALWAYS AS (quantity::numeric*unit_price) STORED,
 sales_person_id_at_creation uuid, sales_assignment_source_id uuid, sales_attributed_at timestamptz NOT NULL, sales_attribution_state text NOT NULL,
 CHECK((sales_attribution_state='assigned' AND sales_person_id_at_creation IS NOT NULL AND sales_assignment_source_id IS NOT NULL)
 OR (sales_attribution_state='unassigned' AND sales_person_id_at_creation IS NULL AND sales_assignment_source_id IS NULL)),
 FOREIGN KEY(generation_id,customer_id) REFERENCES private.co_replay_generations(id,customer_id),
 FOREIGN KEY(report_revision_line_id,report_revision_id,customer_id,stock_key_id) REFERENCES private.co_report_revision_lines(id,revision_id,customer_id,stock_key_id),
 FOREIGN KEY(batch_id,customer_id,stock_key_id) REFERENCES private.co_stock_batches(id,customer_id,stock_key_id),
 UNIQUE(generation_id,report_revision_line_id,batch_id)
);
CREATE INDEX co_allocations_report ON private.co_sale_allocations(report_revision_line_id,report_revision_id,customer_id,stock_key_id);
CREATE INDEX co_allocations_batch ON private.co_sale_allocations(batch_id,customer_id,stock_key_id);
CREATE INDEX co_allocations_customer ON private.co_sale_allocations(customer_id,generation_id,report_revision_id);

CREATE TABLE private.co_commands (
 actor_id uuid NOT NULL, request_id uuid NOT NULL, operation text, payload_fingerprint text,
 status text NOT NULL CHECK(status IN('pending','committed','abandoned')), receipt jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,request_id),
 CHECK((status='abandoned' AND receipt IS NULL AND operation IS NULL AND payload_fingerprint IS NULL)
 OR (status IN('pending','committed') AND operation IS NOT NULL AND payload_fingerprint IS NOT NULL AND payload_fingerprint ~ '^[a-f0-9]{64}$'
 AND ((status='pending' AND receipt IS NULL) OR (status='committed' AND receipt IS NOT NULL AND jsonb_typeof(receipt)='object'))))
);
CREATE TABLE private.co_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES private.co_customer_state(customer_id),
 actor_id uuid NOT NULL, request_id uuid, operation text NOT NULL, reason text,
 before_state jsonb, after_state jsonb, delivery_revision_id uuid, report_revision_id uuid, return_revision_id uuid, generation_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(actor_id,request_id) REFERENCES private.co_commands(actor_id,request_id),
 FOREIGN KEY(generation_id,customer_id) REFERENCES private.co_replay_generations(id,customer_id)
);
CREATE INDEX co_audit_customer ON private.co_audit_events(customer_id,created_at,id);
CREATE INDEX co_audit_request ON private.co_audit_events(actor_id,request_id);
CREATE INDEX co_audit_generation ON private.co_audit_events(generation_id,customer_id);
ALTER TABLE private.co_delivery_revisions ADD UNIQUE(id,customer_id);
ALTER TABLE private.co_return_revisions ADD UNIQUE(id,customer_id);
ALTER TABLE private.co_audit_events
 ADD FOREIGN KEY(delivery_revision_id,customer_id) REFERENCES private.co_delivery_revisions(id,customer_id),
 ADD FOREIGN KEY(report_revision_id,customer_id) REFERENCES private.co_report_revisions(id,customer_id),
 ADD FOREIGN KEY(return_revision_id,customer_id) REFERENCES private.co_return_revisions(id,customer_id);
CREATE INDEX co_audit_delivery ON private.co_audit_events(delivery_revision_id,customer_id);
CREATE INDEX co_audit_report ON private.co_audit_events(report_revision_id,customer_id);
CREATE INDEX co_audit_return ON private.co_audit_events(return_revision_id,customer_id);

CREATE FUNCTION private.co_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Posted CO evidence is immutable' USING ERRCODE='55000'; END $$;
CREATE FUNCTION private.co_identity_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE allowed text[]; previous_revision bigint; next_revision bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO history cannot be deleted' USING ERRCODE='55000'; END IF;
 allowed:=CASE TG_TABLE_NAME
  WHEN 'co_orders' THEN ARRAY['version','status','co_number','order_date','expected_delivery_date','notes']
  WHEN 'co_order_lines' THEN ARRAY['ordered_quantity','resolved_undelivered_quantity']
  ELSE ARRAY['version','current_revision_id'] END;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN
  RAISE EXCEPTION 'CO source identity and creation credit are immutable' USING ERRCODE='55000';
 END IF;
 IF TG_TABLE_NAME IN('co_delivery_heads','co_report_heads','co_return_heads') THEN
  IF OLD.current_revision_id IS NOT NULL AND NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id THEN
   IF NEW.current_revision_id IS NULL THEN RAISE EXCEPTION 'Posted CO head cannot be unsealed' USING ERRCODE='55000'; END IF;
   EXECUTE format('SELECT revision_no FROM private.%I WHERE id=$1',replace(TG_TABLE_NAME,'_heads','_revisions')) INTO previous_revision USING OLD.current_revision_id;
   EXECUTE format('SELECT revision_no FROM private.%I WHERE id=$1',replace(TG_TABLE_NAME,'_heads','_revisions')) INTO next_revision USING NEW.current_revision_id;
   IF next_revision<=previous_revision THEN RAISE EXCEPTION 'Posted CO head cannot move backward' USING ERRCODE='55000'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_order_identity BEFORE UPDATE OR DELETE ON private.co_orders FOR EACH ROW EXECUTE FUNCTION private.co_identity_guard_v1();
CREATE TRIGGER co_line_identity BEFORE UPDATE ON private.co_order_lines FOR EACH ROW EXECUTE FUNCTION private.co_identity_guard_v1();
CREATE TRIGGER co_delivery_identity BEFORE UPDATE OR DELETE ON private.co_delivery_heads FOR EACH ROW EXECUTE FUNCTION private.co_identity_guard_v1();
CREATE TRIGGER co_report_identity BEFORE UPDATE OR DELETE ON private.co_report_heads FOR EACH ROW EXECUTE FUNCTION private.co_identity_guard_v1();
CREATE TRIGGER co_return_identity BEFORE UPDATE OR DELETE ON private.co_return_heads FOR EACH ROW EXECUTE FUNCTION private.co_identity_guard_v1();

-- A line may be appended while its new revision is being assembled, never after publication.
CREATE FUNCTION private.co_revision_line_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE revision_number bigint; published_number bigint;
BEGIN
 IF TG_TABLE_NAME='co_delivery_revision_lines' THEN
  SELECT r.revision_no,p.revision_no INTO revision_number,published_number FROM private.co_delivery_revisions r
  JOIN private.co_delivery_heads h ON h.id=r.head_id LEFT JOIN private.co_delivery_revisions p ON p.id=h.current_revision_id WHERE r.id=NEW.revision_id;
 ELSIF TG_TABLE_NAME='co_report_revision_lines' THEN
  SELECT r.revision_no,p.revision_no INTO revision_number,published_number FROM private.co_report_revisions r
  JOIN private.co_report_heads h ON h.id=r.head_id LEFT JOIN private.co_report_revisions p ON p.id=h.current_revision_id WHERE r.id=NEW.revision_id;
 ELSE
  SELECT r.revision_no,p.revision_no INTO revision_number,published_number FROM private.co_return_revisions r
  JOIN private.co_return_heads h ON h.id=r.head_id LEFT JOIN private.co_return_revisions p ON p.id=h.current_revision_id WHERE r.id=NEW.revision_id;
 END IF;
 IF revision_number<=published_number THEN RAISE EXCEPTION 'Posted CO revision cannot gain lines' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_delivery_lines_append BEFORE INSERT ON private.co_delivery_revision_lines FOR EACH ROW EXECUTE FUNCTION private.co_revision_line_guard_v1();
CREATE TRIGGER co_report_lines_append BEFORE INSERT ON private.co_report_revision_lines FOR EACH ROW EXECUTE FUNCTION private.co_revision_line_guard_v1();
CREATE TRIGGER co_return_lines_append BEFORE INSERT ON private.co_return_revision_lines FOR EACH ROW EXECUTE FUNCTION private.co_revision_line_guard_v1();

-- Derived evidence must carry the source agreement/credit, even at its first INSERT.
CREATE FUNCTION private.co_source_snapshot_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE source jsonb; actual jsonb; expected jsonb; keys text[]:=ARRAY['unit_price','sales_person_id_at_creation','sales_assignment_source_id','sales_attributed_at','sales_attribution_state'];
BEGIN
 IF TG_TABLE_NAME='co_stock_batches' THEN
  SELECT to_jsonb(o)||jsonb_build_object('unit_price',l.unit_price) INTO source
  FROM private.co_order_lines l JOIN private.co_orders o ON o.id=l.co_id WHERE l.id=NEW.co_line_id;
 ELSE
  SELECT to_jsonb(b) INTO source FROM private.co_stock_batches b WHERE b.id=NEW.batch_id;
 END IF;
 IF source IS NOT NULL THEN
  SELECT jsonb_object_agg(key,value) INTO actual FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(keys);
  SELECT jsonb_object_agg(key,value) INTO expected FROM jsonb_each(source) WHERE key=ANY(keys);
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'CO agreement and credit must match original source' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_batch_source_snapshot BEFORE INSERT ON private.co_stock_batches FOR EACH ROW EXECUTE FUNCTION private.co_source_snapshot_v1();
CREATE TRIGGER co_allocation_source_snapshot BEFORE INSERT ON private.co_sale_allocations FOR EACH ROW EXECUTE FUNCTION private.co_source_snapshot_v1();

CREATE FUNCTION private.co_generation_append_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target_version bigint; effective_version bigint;
BEGIN
 SELECT g.version,e.version INTO target_version,effective_version FROM private.co_replay_generations g
 JOIN private.co_customer_state c ON c.customer_id=g.customer_id
 LEFT JOIN private.co_replay_generations e ON e.id=c.effective_generation_id
 WHERE g.id=NEW.generation_id;
 IF target_version<=effective_version THEN RAISE EXCEPTION 'Effective CO generation cannot gain evidence' USING ERRCODE='55000'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_generation_append BEFORE INSERT ON private.co_stock_movements FOR EACH ROW EXECUTE FUNCTION private.co_generation_append_v1();
CREATE TRIGGER co_generation_append BEFORE INSERT ON private.co_sale_allocations FOR EACH ROW EXECUTE FUNCTION private.co_generation_append_v1();
CREATE FUNCTION private.co_customer_state_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE previous_version bigint; next_version bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO customer state cannot be deleted' USING ERRCODE='55000'; END IF;
 IF NEW.customer_id IS DISTINCT FROM OLD.customer_id OR NEW.version<OLD.version THEN RAISE EXCEPTION 'Invalid CO customer version transition' USING ERRCODE='55000'; END IF;
 IF OLD.effective_generation_id IS NOT NULL AND NEW.effective_generation_id IS DISTINCT FROM OLD.effective_generation_id THEN
  IF NEW.effective_generation_id IS NULL THEN RAISE EXCEPTION 'Effective CO generation cannot be unsealed' USING ERRCODE='55000'; END IF;
  SELECT version INTO previous_version FROM private.co_replay_generations WHERE id=OLD.effective_generation_id;
  SELECT version INTO next_version FROM private.co_replay_generations WHERE id=NEW.effective_generation_id;
  IF next_version<=previous_version THEN RAISE EXCEPTION 'Effective CO generation cannot move backward' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_customer_state_transition BEFORE UPDATE OR DELETE ON private.co_customer_state FOR EACH ROW EXECUTE FUNCTION private.co_customer_state_guard_v1();

CREATE FUNCTION private.co_actor_v1() RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor_role public.user_role:=private.demo_order_actor();
BEGIN
 IF actor_role NOT IN('co_admin','executive') THEN RAISE EXCEPTION 'CO authority required' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END $$;
CREATE FUNCTION private.co_lock_customer_v1(p_customer_id uuid,p_expected_version bigint DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE v bigint;
BEGIN
 PERFORM private.co_actor_v1();
 IF p_customer_id IS NULL OR p_expected_version<1 OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id) THEN
  RAISE EXCEPTION 'Invalid CO customer or version' USING ERRCODE='22023';
 END IF;
 INSERT INTO private.co_customer_state(customer_id) VALUES(p_customer_id) ON CONFLICT(customer_id) DO NOTHING;
 SELECT version INTO v FROM private.co_customer_state WHERE customer_id=p_customer_id FOR UPDATE;
 IF p_expected_version IS NOT NULL AND p_expected_version<>v THEN RAISE EXCEPTION 'CO_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
 RETURN v;
END $$;
CREATE FUNCTION private.co_normalize_sku_v1(p_sku text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT lower(btrim(p_sku));
$$;
CREATE FUNCTION private.co_stock_key_v1(p_customer_id uuid,p_sku text,p_product_name text,p_product_id uuid DEFAULT NULL,p_stock_key_id uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE existing private.co_stock_keys%ROWTYPE; catalog public.products%ROWTYPE; result uuid;
BEGIN
 PERFORM private.co_lock_customer_v1(p_customer_id,NULL);
 IF nullif(btrim(p_sku),'') IS NULL OR nullif(btrim(p_product_name),'') IS NULL THEN RAISE EXCEPTION 'SKU and product name required' USING ERRCODE='22023'; END IF;
 IF p_stock_key_id IS NOT NULL THEN
  SELECT * INTO existing FROM private.co_stock_keys WHERE id=p_stock_key_id AND customer_id=p_customer_id;
  IF existing.id IS NULL OR existing.normalized_sku<>private.co_normalize_sku_v1(p_sku) THEN RAISE EXCEPTION 'Invalid stock identity' USING ERRCODE='22023'; END IF;
 ELSE
  SELECT * INTO existing FROM private.co_stock_keys WHERE customer_id=p_customer_id AND normalized_sku=private.co_normalize_sku_v1(p_sku);
 END IF;
 IF existing.id IS NOT NULL THEN
  IF p_product_id IS NOT NULL AND p_product_id IS DISTINCT FROM existing.product_id THEN RAISE EXCEPTION 'Conflicting product identity' USING ERRCODE='22023'; END IF;
  RETURN existing.id;
 END IF;
 IF p_product_id IS NOT NULL THEN
  SELECT * INTO catalog FROM public.products WHERE id=p_product_id FOR SHARE;
  IF catalog.id IS NULL OR private.co_normalize_sku_v1(catalog.sku)<>private.co_normalize_sku_v1(p_sku) THEN RAISE EXCEPTION 'Invalid catalog identity' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO private.co_stock_keys(customer_id,display_sku,product_id,product_name)
 VALUES(p_customer_id,btrim(p_sku),p_product_id,coalesce(catalog.name,btrim(p_product_name))) RETURNING id INTO result;
 RETURN result;
END $$;

CREATE FUNCTION private.co_command_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'pending' THEN RAISE EXCEPTION 'Terminal CO command is immutable' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','receipt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','receipt']) OR NEW.status<>'committed' THEN
  RAISE EXCEPTION 'Invalid CO command transition' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER co_command_terminal BEFORE UPDATE OR DELETE ON private.co_commands FOR EACH ROW EXECUTE FUNCTION private.co_command_guard_v1();
CREATE FUNCTION private.co_command_finished_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM private.co_commands WHERE actor_id=NEW.actor_id AND request_id=NEW.request_id AND status='pending') THEN
  RAISE EXCEPTION 'CO command must commit atomically with its receipt' USING ERRCODE='55000';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER co_command_finished AFTER INSERT OR UPDATE ON private.co_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.co_command_finished_v1();
CREATE FUNCTION private.co_command_begin_v1(p_request_id uuid,p_operation text,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; fingerprint text;
BEGIN
 IF p_request_id IS NULL OR p_operation IS NULL OR p_operation NOT IN('create_co','edit_co','cancel_co','save_sj_draft','post_sj','save_report_draft','post_report','save_return_draft','post_return','correct_sj','correct_report','correct_return','resolve_undelivered','close_co')
 OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid CO command' USING ERRCODE='22023'; END IF;
 -- The same actor/request lock is taken before execution or abandonment. No polling window.
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.status='abandoned' THEN RAISE EXCEPTION 'CO request abandoned' USING ERRCODE='55000'; END IF;
 IF command.actor_id IS NOT NULL THEN
  IF command.operation<>p_operation OR command.payload_fingerprint<>fingerprint THEN RAISE EXCEPTION 'CO request identity mismatch' USING ERRCODE='22023'; END IF;
  IF command.status='committed' THEN RETURN command.receipt; END IF;
  RAISE EXCEPTION 'CO command already executing in this transaction' USING ERRCODE='55000';
 END IF;
 INSERT INTO private.co_commands(actor_id,request_id,operation,payload_fingerprint,status) VALUES(actor,p_request_id,p_operation,fingerprint,'pending');
 RETURN NULL;
END $$;
CREATE FUNCTION private.co_command_commit_v1(p_request_id uuid,p_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE; receipt_id uuid; customer uuid;
BEGIN
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Invalid CO command completion' USING ERRCODE='55000'; END IF;
 IF p_receipt IS NULL OR jsonb_typeof(p_receipt)<>'object'
 OR (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>5
 OR NOT (p_receipt ?& ARRAY['id','operation','version','customer_id','customer_version'])
 OR p_receipt->>'operation' IS DISTINCT FROM command.operation
 OR jsonb_typeof(p_receipt->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(p_receipt->'customer_id') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_receipt->'version') IS DISTINCT FROM 'string' OR jsonb_typeof(p_receipt->'customer_version') IS DISTINCT FROM 'string'
 OR (p_receipt->>'version') !~ '^[1-9][0-9]*$' OR (p_receipt->>'customer_version') !~ '^[1-9][0-9]*$' THEN
  RAISE EXCEPTION 'Invalid CO receipt' USING ERRCODE='22023';
 END IF;
 BEGIN
  receipt_id:=(p_receipt->>'id')::uuid; customer:=(p_receipt->>'customer_id')::uuid;
  PERFORM (p_receipt->>'version')::bigint,(p_receipt->>'customer_version')::bigint;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid CO receipt identity or version' USING ERRCODE='22023'; END;
 IF receipt_id IS NULL OR customer IS NULL OR NOT EXISTS(SELECT 1 FROM private.co_customer_state WHERE customer_id=customer AND version=(p_receipt->>'customer_version')::bigint) THEN
  RAISE EXCEPTION 'Invalid CO receipt customer version' USING ERRCODE='22023';
 END IF;
 UPDATE private.co_commands SET status='committed',receipt=p_receipt WHERE actor_id=actor AND request_id=p_request_id;
 RETURN p_receipt;
END $$;
CREATE FUNCTION private.co_command_reconcile_v1(p_request_id uuid,p_abandon boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE actor uuid:=private.co_actor_v1(); command private.co_commands%ROWTYPE;
BEGIN
 IF p_request_id IS NULL OR p_abandon IS NULL THEN RAISE EXCEPTION 'Invalid CO recovery request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('co-command:'||actor::text||':'||p_request_id::text,0));
 SELECT * INTO command FROM private.co_commands WHERE actor_id=actor AND request_id=p_request_id FOR UPDATE;
 IF command.status='committed' THEN RETURN jsonb_build_object('status','committed','operation',command.operation,'receipt',command.receipt); END IF;
 IF command.status='abandoned' THEN RETURN jsonb_build_object('status','abandoned'); END IF;
 IF command.status='pending' THEN RETURN jsonb_build_object('status','unknown'); END IF;
 IF p_abandon THEN
  INSERT INTO private.co_commands(actor_id,request_id,status) VALUES(actor,p_request_id,'abandoned');
  RETURN jsonb_build_object('status','abandoned');
 END IF;
 RETURN jsonb_build_object('status','unknown');
END $$;

-- Limit ACL/trigger changes to these new CO objects. Existing private-schema audiences stay intact.
DO $co_security$
DECLARE t text; fn regprocedure;
BEGIN
 FOREACH t IN ARRAY ARRAY['co_customer_state','co_stock_keys','co_orders','co_order_lines','co_drafts','co_report_draft_lines',
 'co_delivery_heads','co_delivery_revisions','co_delivery_revision_lines','co_report_heads','co_report_revisions','co_report_revision_lines',
 'co_return_heads','co_return_revisions','co_return_revision_lines','co_stock_batches','co_replay_generations','co_stock_movements','co_sale_allocations','co_commands','co_audit_events'] LOOP
  EXECUTE format('ALTER TABLE private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON private.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['co_stock_keys','co_delivery_revisions','co_delivery_revision_lines','co_report_revisions','co_report_revision_lines',
 'co_return_revisions','co_return_revision_lines','co_stock_batches','co_replay_generations','co_stock_movements','co_sale_allocations','co_audit_events'] LOOP
  EXECUTE format('CREATE TRIGGER co_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.co_immutable_v1()',t);
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN(
 'co_generation_append_v1','co_customer_state_guard_v1','co_immutable_v1','co_identity_guard_v1','co_revision_line_guard_v1','co_source_snapshot_v1','co_actor_v1','co_lock_customer_v1','co_normalize_sku_v1','co_stock_key_v1',
 'co_command_guard_v1','co_command_finished_v1','co_command_begin_v1','co_command_commit_v1','co_command_reconcile_v1') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',fn);
 END LOOP;
END $co_security$;
REVOKE ALL ON SEQUENCE private.co_delivery_heads_original_creation_order_seq FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
