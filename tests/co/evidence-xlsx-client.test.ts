// @vitest-environment node
import { expect,test,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { prepareEvidenceFile } from '../../src/lib/co/evidence';
import { parts,zip } from './import/fixtures/xlsx-layout';
vi.mock('../../src/lib/supabase',()=>({supabase:{}}));
const mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
test('client validates XLSX package and hashes original compressed bytes',async()=>{
 const bytes=zip(parts().map(p=>({...p,deflate:true})));const prepared=await prepareEvidenceFile(new File([bytes],'report.xlsx',{type:mime}),()=>true);
 expect(prepared.bytes).toEqual(bytes);expect(prepared.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));expect(prepared.mime_type).toBe(mime);
});
test.each(['wrong.pdf','.report.xlsx','../report.xlsx','report\u0000.xlsx','report.xlsm'])('invalid XLSX name %s rejects before byte read',async name=>{
 const file=new File([zip(parts())],name,{type:mime}),read=vi.spyOn(file,'arrayBuffer');await expect(prepareEvidenceFile(file,()=>true)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
});
test('client rejects generic ZIP and renamed macros after reading',async()=>{
 const p=parts();p[0].text=p[0].text!.replace('spreadsheetml.sheet.main+xml','ms-excel.sheet.macroEnabled.main+xml');
 for(const bytes of [zip(p),zip([{name:'a.xml',text:'<x/>'}])])await expect(prepareEvidenceFile(new File([bytes],'report.xlsx',{type:mime}),()=>true)).rejects.toThrow();
});
test('client checks owner again after asynchronous guard before hashing',async()=>{
 const file=new File([zip(parts().map(p=>({...p,deflate:true})))],'report.xlsx',{type:mime});let checks=0;
 const hash=vi.spyOn(crypto.subtle,'digest');await expect(prepareEvidenceFile(file,()=>++checks<3)).rejects.toThrow();expect(checks).toBe(3);expect(hash).not.toHaveBeenCalled();
});
test('legacy types and XLSX size/metadata checks are unchanged',async()=>{
 for(const [name,type] of [['a.pdf','application/pdf'],['a.png','image/png'],['a.jpg','image/jpeg'],['a.jpeg','image/jpeg']])expect((await prepareEvidenceFile(new File(['x'],name,{type}),()=>true)).byte_size).toBe(1);
 for(const size of [0,10485761]){const file={name:'r.xlsx',type:mime,size,arrayBuffer:vi.fn()};await expect(prepareEvidenceFile(file as any,()=>true)).rejects.toThrow();expect(file.arrayBuffer).not.toHaveBeenCalled();}
 await expect(prepareEvidenceFile({name:'r.xlsx',type:mime,size:1,arrayBuffer:async()=>new ArrayBuffer(2)} as any,()=>true)).rejects.toThrow();
});

test('owner loss during hashing rejects an already guarded XLSX',async()=>{
 const file=new File([zip(parts())],'report.xlsx',{type:mime});let checks=0;
 const hash=vi.spyOn(crypto.subtle,'digest');await expect(prepareEvidenceFile(file,()=>++checks<4)).rejects.toThrow();expect(checks).toBe(4);expect(hash).toHaveBeenCalledOnce();
});
