import {Dialog} from '../ui/Dialog';
import {Button} from '../ui/Button';
import {COFailure,useCOActor,useCORead} from './COShared';
import COReturnDialog from './COReturnDialog';
import {fetchCOCustomerStock} from '../../lib/co/rpc';
import {legacyReturnState} from '../../lib/co/returnLegacyRecovery';
import {CO_BACKEND} from '../../lib/co/queryKeys';
/** Opens only an actual retained actor/backend/customer request. No new legacy draft entry. */
export default function COReturnLegacyRecovery({customerId,returnFocus,onClose,onResolved}:{customerId:string;returnFocus:HTMLElement|null;onClose:()=>void;onResolved:()=>void}){
 const actor=useCOActor(`legacy-return-only:${customerId}`);
 let state='absent',failure:unknown=null;
 try{if(actor.enabled)state=legacyReturnState(window.localStorage,actor.identity.actorId,customerId,CO_BACKEND);}catch(e){failure=e;}
 const read=useCORead(actor,'legacy-return-recovery-version',{customerId},o=>fetchCOCustomerStock({p_customer_id:customerId,p_as_of:null,p_search:'',p_expected_customer_version:null,p_page:1,p_page_size:1},o),state==='pending');
 if(!actor.enabled)return null;
 if(state==='pending'&&!read.error&&read.data)return <COReturnDialog recoveryOnly customerId={customerId} customerVersion={read.data.customer_version!} returnFocus={returnFocus} onClose={()=>{onResolved();onClose();}} onSaved={()=>{onResolved();onClose();}} blocked={read.isFetching} onAuthorityFailure={actor.rejectAuthority}/>;
 return <Dialog labelledBy="legacy-return-title" pending={false} onClose={onClose} returnFocus={returnFocus} fallbackFocus={()=>document.querySelector('h1')} className="co-return-dialog"><div className="co-return-dialog__body"><h2 id="legacy-return-title">Pulihkan retur sebelumnya</h2>{failure||read.error?<COFailure error={failure||read.error} retry={()=>void read.refetch()}/>:state==='malformed'?<COFailure error={new Error('Data pemulihan lama tidak dapat diverifikasi. Jangan membuat retur pengganti; hubungi administrator.')}/>:state==='pending'?<p role="status">Memeriksa sumber retur sebelumnya…</p>:<p>Permintaan lama tidak lagi menunggu pemulihan.</p>}<Button variant="secondary" onClick={()=>{onResolved();onClose();}}>Tutup</Button></div></Dialog>;
}
