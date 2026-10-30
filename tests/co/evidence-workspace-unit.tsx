import React from 'react';
import { useUnsavedChanges } from '../../src/lib/useUnsavedChanges';
import { useCOReportWorkspace, COReportFields, type COReportWorkspace } from '../../src/components/co/COReportWorkspace';
import { COFailure } from '../../src/components/co/COShared';
import COEvidenceAttachment from '../../src/components/co/COEvidenceAttachment';
/** UNIT composition of surviving public primitives; not the current upload route.
 * No synthetic business buttons, receipt fabrication, or test-owned authority mask.
 */
export function EvidenceWorkspaceUnit({customerId,month,onWork}:{customerId:string;month:string;onWork:(work:COReportWorkspace)=>void}){
 const work=useCOReportWorkspace(customerId,month);onWork(work);
 const unsaved=useUnsavedChanges(work.dirty||work.evidenceState.dirty||work.evidenceState.pending||work.evidenceState.unresolved);
 return work.header?<>{unsaved.dialog}<COReportFields work={work}/><COEvidenceAttachment work={work} confirmDiscard={message=>unsaved.confirmDiscardDecision({message})}/></>:work.authorityError?<COFailure error={work.authorityError}/>:null;
}
