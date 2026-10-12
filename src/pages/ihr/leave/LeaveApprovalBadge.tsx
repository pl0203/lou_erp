import { StatusBadge } from '../../../components/ui/Feedback'
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
 if(!query.available||!query.data)return <span role="status" className="ui-notice ui-notice--info">Jumlah belum tersedia</span>
 const count=approvalCountForFilter(query.data,filter)
 return <StatusBadge tone={count>0?'warning':'neutral'} aria-label={`${count} persetujuan menunggu`}>{count}</StatusBadge>
}
