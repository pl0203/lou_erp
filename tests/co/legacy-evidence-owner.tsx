/** Exercises the retained nested/source-correction evidence owner, not the new monthly route. */
import {useCOReportWorkspace,COReportFields} from '../../src/components/co/COReportWorkspace';
import COEvidenceAttachment from '../../src/components/co/COEvidenceAttachment';
import {COFailure} from '../../src/components/co/COShared';
import {useUnsavedChanges} from '../../src/lib/useUnsavedChanges';
import {useBeforeSignOut} from '../../src/lib/AuthContext';
import {Button} from '../../src/components/ui/Button';
import {customer,month} from './report-ui-harness';
export default function LegacyEvidenceOwner(){const work=useCOReportWorkspace(customer,month);const guard=useUnsavedChanges(work.dirty);useBeforeSignOut(signal=>guard.confirmDiscardDecision({signal}),work.actor.scope);if(work.denied)return <COFailure error={work.authorityError}/>;return <>{guard.dialog}{work.header&&<><COReportFields work={work}/><COEvidenceAttachment work={work} confirmDiscard={message=>guard.confirmDiscardDecision({message})}/><Button disabled={work.frozen||!!work.rowsRead.error} onClick={()=>void work.save().catch(()=>{})}>Simpan Draft</Button></>}</>}
