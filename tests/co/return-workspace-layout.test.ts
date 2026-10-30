// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const css=readFileSync('src/components/co/COReturnWorkspace.css','utf8');
const rule=(name:string)=>css.match(new RegExp('\\.'+name+'\\{([^}]+)'))?.[1]??'';
test('return form explicitly owns its wide viewport-bounded cap instead of inheriting the shared narrow dialog cap',()=>{
 expect(rule('co-return-dialog')).toContain('width:min(900px,calc(100vw - 32px))');
 expect(rule('co-return-dialog')).toContain('max-width:900px');
 expect(css).toContain('.co-return-dialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}');
});
test('return body grid can shrink below selected table intrinsic width while keeping inner overflow reachable',()=>{
 expect(rule('co-return-dialog__body')).toContain('grid-template-columns:minmax(0,1fr)');
 expect(rule('co-return-table-scroll')).toContain('overflow-x:auto');
 expect(rule('co-return-dialog')).toContain('overflow:auto');
 expect(css).toContain('.co-return-selected-table{min-width:0}');
});
