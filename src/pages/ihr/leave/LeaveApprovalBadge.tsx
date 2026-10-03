import type { LeaveContext } from '../../../lib/leave/contracts'
import type { ApprovalCountFilter } from '../../../lib/leave/readContracts'
import { approvalCountForFilter, useLeaveApprovalCounts } from '../../../lib/leave/useLeaveReads'
type Props={actorId:string;context:LeaveContext;filter?:ApprovalCountFilter;readState?:'ready'|'pending'|'error'}
export default function LeaveApprovalBadge(props:Props){
 if(!props.context.capabilities.approve)return null
 return <ApprovalBadge {...props}/>
}
function ApprovalBadge({actorId,context,filter='all',readState='ready'}:Props){
 const query=useLeaveApprovalCounts(actorId,context,filter,readState==='ready')
 if(!query.available||!query.data)return <span role="status" className="text-xs text-gray-600">Jumlah belum tersedia</span>
 const count=approvalCountForFilter(query.data,filter)
 return <span aria-label={`${count} persetujuan menunggu`} className="inline-flex min-w-6 justify-center rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">{count}</span>
}
