import type { HrHistoryCursor } from './adminContracts'
import { leaveKeys } from './queryKeys'
export const adminKeys={
 rotaContext:(actor:string,scope:string,calendar:string)=>leaveKeys.private(actor,scope,'admin','rota-context',calendar),
 hrRequests:(actor:string,scope:string,employee:string,before:number|null,limit:number)=>leaveKeys.private(actor,scope,'admin','hr-requests',employee,{before,limit}),
 hrRequest:(actor:string,scope:string,employee:string,request:string)=>leaveKeys.private(actor,scope,'admin','hr-request',employee,request),
 hrHistory:(actor:string,scope:string,employee:string,request:string,before:HrHistoryCursor|null,limit:number)=>leaveKeys.private(actor,scope,'admin','hr-history',employee,request,{before,limit}),
 writeContext:(actor:string,scope:string,employee:string)=>leaveKeys.private(actor,scope,'admin','write-context',employee),
 targets:(actor:string,scope:string,page:number,size:number)=>leaveKeys.private(actor,scope,'admin','targets',{page,size}),
 settings:(actor:string,scope:string,employee:string)=>leaveKeys.private(actor,scope,'admin','settings',employee),
 access:(actor:string,scope:string,employee:string)=>leaveKeys.private(actor,scope,'admin','access',employee),
 requests:(actor:string,scope:string,employee:string,before:number|null,limit:number)=>leaveKeys.private(actor,scope,'admin','requests',employee,{before,limit}),
}
