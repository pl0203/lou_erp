import {supabase} from './supabase'
import {readCompleteQuery} from './reads/completeQuery'
export const MAX_VISIT_NOTE_LENGTH=2000
export type VisitRequest={id:string;requester_id:string;kind:'new'|'amendment';customer_id:string;scheduled_date:string;notes:string|null;source_schedule_id:string|null;base_version:number|null;status:'pending'|'approved'|'rejected'|'withdrawn';version:number;reviewer_id:string|null;created_at:string}
export type VisitPlan={customer_id:string;scheduled_date:string;notes:string}
export async function fetchVisitCustomers(signal?:AbortSignal){return readCompleteQuery((offset,limit)=>supabase.from('customers').select('id,name',{count:'exact'}).order('name').order('id').range(offset,offset+limit-1),row=>row.id,signal)}
export async function fetchVisitRequests(page:number){const {data,error,count}=await supabase.from('visit_requests').select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id').range((page-1)*20,page*20-1);if(error)throw error;if(count===null)throw new Error('Jumlah permintaan belum tersedia.');return {items:data as VisitRequest[],total:count}}
export async function fetchVisitPeople(ids:string[],signal?:AbortSignal){return readCompleteQuery((offset,limit)=>supabase.from('users').select('id,full_name',{count:'exact'}).in('id',ids).order('id').range(offset,offset+limit-1),row=>row.id,signal)}
