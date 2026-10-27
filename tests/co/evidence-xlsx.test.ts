// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { inspectEvidenceBytes } from '../../supabase/functions/_shared/co-evidence';
import { createEvidenceUploadHandler } from '../../supabase/functions/co-evidence-upload/index';
import { createEvidenceDownloadHandler } from '../../supabase/functions/co-evidence-download/index';
import { guardWorkbook, inspectWorkbook } from '../../src/lib/co/import/workbookGuard';
import { zip, parts, transaction, header, group } from './import/fixtures/xlsx-layout';
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const id='11111111-1111-4111-8111-111111111111', oid='22222222-2222-4222-8222-222222222222';
const config={url:'https://project.example',anonKey:'public',serviceKey:'secret'};
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const context=(b:Uint8Array)=>({version:'1',id,actor_id:id,bucket:'co-evidence',path:`${id}.xlsx`,filename:`evidence-${id}.xlsx`,mime_type:mime,byte_size:b.length,sha256:digest(b),state:'pending',object:null as any});
const request=(bytes:Uint8Array)=>new Request('https://edge.example',{method:'POST',headers:{authorization:'Bearer user','x-evidence-id':id},body:bytes});
test.each([false,true])('XLSX validates actual stored/deflated bytes (%s), retaining original identity',async deflate=>{
 const bytes=zip(parts().map(p=>({...p,deflate})));const canonical=(await guardWorkbook(bytes,new AbortController().signal)).canonicalBytes;
 expect(await inspectEvidenceBytes(bytes)).toEqual({mime_type:mime,byte_size:bytes.length,sha256:digest(bytes)});
 if(deflate)expect(digest(bytes)).not.toBe(digest(canonical));
});
test('cached formula text remains inert during evidence verification',async()=>{
 const bytes=zip(parts(header+group+transaction(6).replace('<v>2</v>','<f>WEBSERVICE("https://invalid.example")</f><v>2</v>')));
 expect((await inspectEvidenceBytes(bytes)).mime_type).toBe(mime);expect(fetch).not.toHaveBeenCalled();
});
const corpus: [string,()=>Uint8Array][]=[
 ['generic ZIP',()=>zip([{name:'data.xml',text:'<x/>'}])],
 ['macro type',()=>zip(parts().map((p,i)=>i? p:{...p,text:p.text!.replace('spreadsheetml.sheet.main+xml','ms-excel.sheet.macroEnabled.main+xml')}))],
 ['macro part',()=>zip([...parts(),{name:'xl/vbaProject.bin',text:'x'}])],
 ['external part',()=>zip([...parts(),{name:'xl/externalLinks/externalLink1.xml',text:'x'}])],
 ['external relationship',()=>zip(parts().map((p,i)=>i!==3?p:{...p,text:p.text!.replace('Target="styles.xml"','Target="https://invalid.example" TargetMode="External"')}))],
 ['encrypted',()=>zip(parts().map((p,i)=>i?p:{...p,flags:1}))],
 ['CRC',()=>zip(parts().map((p,i)=>i?p:{...p,crc:0}))],
 ['deflated CRC',()=>zip(parts().map((p,i)=>i?{...p,deflate:true}:{...p,deflate:true,crc:0}))],
 ['deflated forged size',()=>zip(parts().map((p,i)=>i?{...p,deflate:true}:{...p,deflate:true,size:1}))],
 ['forged size',()=>zip(parts().map((p,i)=>i?p:{...p,size:1}))],
 ['expansion',()=>zip([...parts(),{name:'docProps/bomb.xml',text:'x'.repeat(1048576),deflate:true,size:1}])],
 ['aggregate cap',()=>zip(parts().map((p,i)=>i?p:{...p,size:52428801}))],
 ['duplicate',()=>zip([...parts(),parts()[0]])],
 ['traversal',()=>zip([...parts(),{name:'../a.xml',text:'x'}])],
 ['overlapping local offsets',()=>{const b=zip(parts()),v=new DataView(b.buffer);const offset=v.getUint32(b.length-6,true),next=offset+46+v.getUint16(offset+28,true);v.setUint32(next+42,0,true);return b;}],
 ['local disagreement',()=>{const b=zip(parts());b[30]^=1;return b;}],
 ['DTD',()=>zip(parts().map((p,i)=>i!==5?p:{...p,text:'<!DOCTYPE worksheet [<!ENTITY a "x">]>'+p.text}))],
 ['malformed XML',()=>zip(parts().map((p,i)=>i!==5?p:{...p,text:p.text!.replace('</sheetData>','')}))],
 ['resource limit',()=>zip(parts().map((p,i)=>i!==5?p:{...p,text:p.text!.replace('A1:K100','A1:XFD1048576')}))],
];
test.each(corpus)('browser and Edge reject %s before any Storage write/attestation',async(_name,build)=>{
 const bytes=build();expect((await inspectWorkbook(bytes)).issues.length).toBeGreaterThan(0);await expect(inspectEvidenceBytes(bytes)).rejects.toThrow();
 const f=vi.fn(async()=>Response.json(context(bytes)));expect((await createEvidenceUploadHandler(config,f)(request(bytes))).status).not.toBe(200);expect(f).toHaveBeenCalledTimes(1);
});
test('unsupported native raw deflate fails closed',async()=>{
 const bytes=zip(parts().map(p=>({...p,deflate:true})));vi.stubGlobal('DecompressionStream',class{constructor(){throw Error('unsupported')}});
 try{await expect(inspectEvidenceBytes(bytes)).rejects.toThrow('raw_deflate_unavailable');}finally{vi.unstubAllGlobals();}
});
test.each(['ok','provider','providerhash','expired','identity','version','sha','size','mime','path'])('XLSX upload independently re-reads and reauthorizes (%s)',async mode=>{
 const bytes=zip(parts().map(p=>({...p,deflate:true}))),ctx=context(bytes);let exists=false,reads=0;const calls:any[]=[];
 const f=vi.fn(async(u:any,o:any)=>{calls.push([String(u),o]);if(String(u).includes('context')){reads++;if(mode==='expired'&&reads>1)return Response.json({code:'42501'},{status:403});return Response.json({...ctx,...(mode==='sha'?{sha256:'a'.repeat(64)}:mode==='size'?{byte_size:1}:mode==='mime'?{mime_type:'application/pdf',path:`${id}.pdf`,filename:`evidence-${id}.pdf`}:mode==='path'?{path:'../x'}:{}),object:exists?{id:mode==='identity'&&reads>3?id:oid,version:mode==='version'&&reads>3?'v2':'v1'}:null});}if(String(u).includes('attest'))return Response.json({id,state:'verified'});if(o.method==='POST'){exists=true;return Response.json({});}return new Response(mode==='provider'?zip([{name:'bad.xml',text:'<x/>'}]):mode==='providerhash'?zip(parts()):bytes);});
 const result=await createEvidenceUploadHandler(config,f)(request(bytes));const writes=calls.filter(([u,o])=>u.includes('/storage/')&&o.method==='POST'),attests=calls.filter(([u])=>u.includes('attest'));
 if(mode==='ok'){expect(result.status).toBe(200);expect(writes).toHaveLength(1);expect(new Uint8Array(writes[0][1].body)).toEqual(bytes);expect(writes[0][1].headers['x-upsert']).toBe('false');expect(JSON.parse(attests[0][1].body)).toMatchObject({p_sha256:digest(bytes),p_mime_type:mime,p_byte_size:bytes.length});}
 else {expect(result.status).not.toBe(200);expect(attests).toHaveLength(0);if(['expired','sha','size','mime','path'].includes(mode))expect(writes).toHaveLength(0);}
});
test.each(['finalized','pending','verified','tampered'])('XLSX download revalidates original bytes and finalized authority (%s)',async mode=>{
 const bytes=zip(parts().map(p=>({...p,deflate:true}))),ctx={...context(bytes),state:mode==='tampered'?'finalized':mode,object:{id:oid,version:'v1'}};
 const f=vi.fn(async(u:any)=>String(u).includes('/rpc/')?Response.json(ctx):new Response(mode==='tampered'?zip(parts()):bytes));
 const response=await createEvidenceDownloadHandler(config,f)(new Request('https://edge.example',{method:'POST',headers:{authorization:'Bearer user','content-type':'application/json'},body:JSON.stringify({evidence_id:id})}));
 if(mode==='finalized'){expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);expect(response.headers.get('content-disposition')).toBe(`attachment; filename="evidence-${id}.xlsx"`);expect(response.headers.get('content-type')).toBe('application/octet-stream');expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('x-content-type-options')).toBe('nosniff');}else expect(response.status).not.toBe(200);
});

test('XLSX input bound is exactly 10 MiB inclusive, independent of XML expansion checks',async()=>{
 const p=[...parts(),...Array.from({length:180},(_,i)=>({name:`docProps/p${i}.xml`,text:'<root><!----></root>'}))];
 const gap=10485760-zip(p).length,each=Math.floor(gap/180),remainder=gap%180;
 for(let i=0;i<180;i++)p[i+6].text=`<root><!--${'x'.repeat(each+(i<remainder?1:0))}--></root>`;
 const bytes=zip(p);expect(bytes.length).toBe(10485760);expect((await inspectEvidenceBytes(bytes)).byte_size).toBe(10485760);
 await expect(inspectEvidenceBytes(new Uint8Array(10485761))).rejects.toThrow('10 MiB');
});

test.each(['eligible','recognized','formula','retry','receipt-failed','changed-stored'])('manual receipt derives only verified canonical original bytes (%s)',async mode=>{
 const unknown=parts('<row r="7"><c r="A7" t="inlineStr"><is><t>Other source</t></is></c></row>','');
 if(mode==='formula')unknown[5].text=unknown[5].text!.replace('<is><t>Other source</t></is>','<f>1+1</f><v>2</v>').replace(' t="inlineStr"','');
 const bytes=zip((mode==='recognized'?parts():unknown).map(p=>({...p,deflate:true}))),ctx=context(bytes);let exists=mode==='retry';const calls:any[]=[];
 const f=vi.fn(async(u:any,o:any)=>{calls.push([String(u),o]);if(String(u).includes('context'))return Response.json({...ctx,object:exists?{id:oid,version:'v1'}:null});if(String(u).includes('manual_workbook_attest'))return mode==='receipt-failed'?Response.json({code:'55000'},{status:409}):Response.json({id,policy:'co-manual-xlsx-values-1'});if(String(u).includes('attest'))return Response.json({id,state:'verified'});if(o.method==='POST'){exists=true;return Response.json({});}return new Response(mode==='changed-stored'?zip(parts()):bytes)});
 const response=await createEvidenceUploadHandler(config,f)(request(bytes));
 const receipts=calls.filter(([u])=>u.includes('manual_workbook_attest'));
 if(['recognized','formula','changed-stored'].includes(mode))expect(receipts).toHaveLength(0);
 else {expect(receipts).toHaveLength(1);expect(JSON.parse(receipts[0][1].body)).toEqual({p_actor_id:id,p_evidence_id:id,p_object_id:oid,p_object_version:'v1',p_sha256:digest(bytes),p_facts:{version:1,policy:'co-manual-xlsx-values-1',sheets:[{name:'Sheet',rows:[7]}]}});expect(receipts[0][1].headers.Authorization).toBe('Bearer secret')}
 expect(response.status).toBe(mode==='receipt-failed'?409:mode==='changed-stored'?502:200);
 if(mode==='retry')expect(calls.filter(([u,o])=>u.includes('/storage/')&&o.method==='POST')).toHaveLength(0);
});

test.each(['mixed-later-sheet','later-formula','1904'])('manual upload receipt remains absent for %s even with forged client safety headers',async mode=>{
 const p=parts('<row r="7"><c r="A7" t="inlineStr"><is><t>Other layout</t></is></c></row>','');
 if(mode==='1904')p[2].text=p[2].text!.replace('<sheets>','<workbookPr date1904="1"/><sheets>');
 else {
  p[2].text=p[2].text!.replace('</sheets>','<sheet name="Later" sheetId="2" r:id="rId9"/></sheets>');
  p[3].text=p[3].text!.replace('</Relationships>','<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>');
  p.push({...parts(mode==='mixed-later-sheet'?header:'<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>','')[5],name:'xl/worksheets/sheet2.xml'});
 }
 const bytes=zip(p),ctx=context(bytes);let exists=false;const calls:string[]=[];
 const f=vi.fn(async(u:any,o:any)=>{const url=String(u);calls.push(url);if(url.includes('context'))return Response.json({...ctx,object:exists?{id:oid,version:'v1'}:null});if(url.includes('attest'))return Response.json({id,state:'verified'});if(o.method==='POST'){exists=true;return Response.json({})}return new Response(bytes)});
 const req=request(bytes);req.headers.set('x-manual-safe','true');req.headers.set('x-original-warning','manual_review:safe_unsupported_xlsx_layout');
 expect((await createEvidenceUploadHandler(config,f)(req)).status).toBe(200);expect(calls.some(u=>u.includes('manual_workbook_attest'))).toBe(false);
});
