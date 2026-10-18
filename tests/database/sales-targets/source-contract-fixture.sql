-- Exact source helper bodies from the fixed d7 baseline, used only in the slim synthetic model.
CREATE FUNCTION private.pilot_store_owner_guard_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=NEW.manager_id AND u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive'))
 THEN RAISE EXCEPTION 'Active sales responsible person required' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' THEN NEW.version:=OLD.version+1; ELSE NEW.version:=1; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.pilot_store_owner_guard_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.demo_capture_credit(customer uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE assignment record; credit jsonb;
BEGIN
 LOCK TABLE public.users IN SHARE MODE;
 LOCK TABLE public.customer_manager_assignments IN SHARE MODE;
 SELECT a.id,a.manager_id INTO assignment FROM public.customer_manager_assignments a
 JOIN public.users u ON u.id=a.manager_id WHERE a.customer_id=customer AND u.is_active AND u.role IN('sales_person','sales_manager','sales_head','executive');
 credit:=jsonb_build_object('sales_person_id_at_creation',assignment.manager_id,'sales_assignment_source_id',assignment.id);
 RETURN credit||jsonb_build_object('sales_attribution_state',CASE WHEN assignment.id IS NOT NULL THEN 'assigned' ELSE 'unassigned' END,'sales_attributed_at',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION private.demo_capture_credit(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.demo_immutable_credit() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF ROW(NEW.sales_person_id_at_creation,NEW.sales_assignment_source_id,NEW.sales_attributed_at,NEW.sales_attribution_state)
 IS DISTINCT FROM ROW(OLD.sales_person_id_at_creation,OLD.sales_assignment_source_id,OLD.sales_attributed_at,OLD.sales_attribution_state)
 THEN RAISE EXCEPTION 'Creation sales attribution is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.demo_immutable_credit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER store_owner_guard_v1 BEFORE INSERT OR UPDATE ON public.customer_manager_assignments FOR EACH ROW EXECUTE FUNCTION private.pilot_store_owner_guard_v1();
CREATE TRIGGER demo_credit_immutable BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION private.demo_immutable_credit();
