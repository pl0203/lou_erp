// Fixed synthetic current-return baseline. No target/path override or live data.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sourceHash='4e16437026c9afff1c25578bc6f9dcf47db945b27ecd578afefbf5df553922b5';
const tables=Object.freeze({
 users:"CREATE TABLE public.users(id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,full_name text NOT NULL,email text UNIQUE NOT NULL,role public.user_role NOT NULL DEFAULT 'sales_person',created_at timestamptz NOT NULL DEFAULT now(),manager_id uuid REFERENCES public.users(id),phone text,birth_date date,is_active boolean NOT NULL DEFAULT true,invited_at timestamptz);",
 customers:"CREATE TABLE public.customers(id uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),name text NOT NULL,phone text,email text,created_at timestamptz NOT NULL DEFAULT now(),address text,visit_frequency_days integer NOT NULL DEFAULT 7,last_visit_date date,city text,pricing_tier public.pricing_tier NOT NULL DEFAULT 'luar_kota',CONSTRAINT suppliers_pkey PRIMARY KEY(id));",
 products:"CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),name text NOT NULL,sku text UNIQUE NOT NULL,size text,unit_price numeric(14,2) NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),harga_pokok numeric(14,2) NOT NULL DEFAULT 0,luar_kota numeric(14,2) NOT NULL DEFAULT 0,dalam_kota numeric(14,2) NOT NULL DEFAULT 0,depo_bangunan numeric(14,2) NOT NULL DEFAULT 0);",
 customer_manager_assignments:"CREATE TABLE public.customer_manager_assignments(id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),customer_id uuid UNIQUE NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,manager_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,assigned_by uuid NOT NULL REFERENCES public.users(id),assigned_at timestamptz NOT NULL DEFAULT now());",
 customer_sales_rep_assignments:"CREATE TABLE public.customer_sales_rep_assignments(id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),customer_id uuid UNIQUE NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,sales_rep_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,assigned_by uuid REFERENCES public.users(id),assigned_at timestamptz DEFAULT now());",
});
export function buildReturnCurrentFixture(source){
 assert.equal(createHash('sha256').update(source).digest('hex'),sourceHash,'Current return fixture source changed');
 let result=source.replace('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";', 'CREATE SCHEMA extensions AUTHORIZATION postgres;\nCREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;\nCREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;');
 result=result.replace('CREATE SCHEMA auth;','GRANT USAGE ON SCHEMA extensions TO anon,authenticated,service_role;\nCREATE SCHEMA auth;');
 for(const [name,sql] of Object.entries(tables)){
  const pattern=new RegExp('^CREATE TABLE public\\.'+name+'\\([^\\n]+$','gm');
  assert.equal([...result.matchAll(pattern)].length,1,'Exactly one fixed table declaration required: '+name);
  result=result.replace(pattern,()=>sql);
 }
 return result;
}

export function installReturnCurrentSchema({read,run,verify}){
 const sql=read('tests/database/co/return-current-schema-finalize.sql');
 assert.equal(createHash('sha256').update(sql).digest('hex'),'0f1c0753b3c8b67fcec5e15ede2fb559849499b2490a4bfe4f1fd6c266bccaee','Current schema composition changed');
 const result=run(sql);assert.equal(result.split('\n').filter(x=>x==='CO_RETURN_CURRENT_SCHEMA_COMPOSED').length,1,'Current schema composition marker required');verify();
}
