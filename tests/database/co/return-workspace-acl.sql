DO $return_acl$ DECLARE name text;fn regprocedure;amount integer;BEGIN
 IF current_database()<>'pilot_co_test' OR current_user<>'postgres' THEN RAISE EXCEPTION 'Disposable fixture required';END IF;
 FOREACH name IN ARRAY ARRAY['pilot_co_return_customers_v1','pilot_co_return_history_customers_v1','pilot_co_return_items_v1','pilot_co_returns_page_v1','pilot_co_return_create_v1','pilot_co_return_create_result_v1'] LOOP
  SELECT count(*) INTO amount FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  IF amount<>1 THEN RAISE EXCEPTION 'Exactly one new return endpoint required: %',name;END IF;
  SELECT p.oid::regprocedure INTO fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  IF has_function_privilege('anon',fn,'EXECUTE') OR has_function_privilege('service_role',fn,'EXECUTE') OR NOT has_function_privilege('authenticated',fn,'EXECUTE')
   OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=fn AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""'])
  THEN RAISE EXCEPTION 'Unexpected return endpoint authority: %',name;END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='private.co_return_workspace_requests'::regclass AND relowner='postgres'::regrole AND relrowsecurity)
 OR EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.co_return_workspace_requests'::regclass)
 OR has_table_privilege('anon','private.co_return_workspace_requests','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('authenticated','private.co_return_workspace_requests','SELECT,INSERT,UPDATE,DELETE')
 OR has_table_privilege('service_role','private.co_return_workspace_requests','SELECT,INSERT,UPDATE,DELETE')
 OR has_function_privilege('authenticated','private.co_return_workspace_page_v1(text,integer,integer)','EXECUTE')
 OR has_function_privilege('anon','private.co_return_workspace_page_v1(text,integer,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Unexpected private return ledger authority';END IF;
END $return_acl$;
SELECT 'CO_RETURN_WORKSPACE_ACL_PASSED';
