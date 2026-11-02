// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
const read=(name:string)=>readFileSync(`tests/catalogue-browser/${name}`,'utf8');
test('native harness retains CustomerList and mounts actual ProductList/shared lookup behind synthetic boundaries',()=>{
 const source=read('harness.tsx');for(const item of ["./source/src/pages/athel/CustomerList","./source/src/pages/athel/ProductList","./source/src/components/POLookup",'<CustomerList/>','<ProductList/>','<POProductLookup'])expect(source).toContain(item);
 const fixture=read('fixture.tsx');expect(fixture).toContain("name === 'pilot_catalog_page_v2'");expect(fixture).toContain('parseProductPayloadV2');expect(fixture).toContain('product_type: null');expect(fixture).toContain("Raw table access is forbidden");
});
test('native Tipe proof includes required/legacy/current layout checks before terminal success',()=>{
 const source=read('run.mjs');for(const marker of ['Tipe missing selection dispatches no command','Tipe legacy edit requires classification','Tipe create/edit/status exact receipts','Tipe lookup keyboard and two-line geometry','Tipe desktop narrow short modal geometry']){expect(source).toContain(marker);expect(source.indexOf(marker)).toBeLessThan(source.indexOf('proofComplete = true'));}
 for(const guard of ['Uncommitted input:','Source mutated:','No unlisted artifacts may be published','unexpected-target','off-origin-request',"sandbox: 'default enabled'"])expect(source).toContain(guard);
});
test('finite source guard rejects missing product no-dispatch, geometry or keyboard assertions',()=>{
 const required=["assert.equal((await ledger(a)).attempts.length,5)","assert.equal((await ledger(a)).attempts.length,6)","assert.equal(productFinal.attempts.length,7)","assert.equal(productFinal.products.length,2)","assert.equal(labels.second,'Fictional Long Product Name To Verify Wrapping | 60x120 | Rumput Sintetis')","assert.ok(Number(labels.weight)>=700&&labels.secondSize<labels.firstSize&&labels.twoLines)","await key(a,'ArrowDown','ArrowDown',40);await key(a,'Enter','Enter',13)","[[1280,900],[390,844],[390,480]]","assert.equal(g.overflow,false)"];
 const verify=(source:string)=>{for(const clause of required)expect(source.split(clause)).toHaveLength(2)};
 const source=read('run.mjs');verify(source);for(const clause of required){expect(()=>verify(source.replace(clause,''))).toThrow();expect(()=>verify(source+clause)).toThrow()}
});

test('native lookup geometry targets label leaves, not shared Button wrappers',async()=>{
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {Button}=await import('../../src/components/ui/Button');
 const source=read('run.mjs');
 const selector=source.match(/s=o\.querySelectorAll\('([^']+)'\)/)![1];
 const fixture=document.createElement('div');
 fixture.innerHTML=renderToStaticMarkup(createElement(Button,{role:'option'},createElement('span',null,'SKU'),createElement('span',null,'Name | Size | Tipe')));
 const option=fixture.querySelector('[role="option"]')!;
 const verify=(value:string)=>expect([...option.querySelectorAll(value)].map(node=>node.textContent)).toEqual(['SKU','Name | Size | Tipe']);
 verify(selector);
 for(const unsafe of ['span',':scope > span',':scope > .ui-button__content'])expect(()=>verify(unsafe)).toThrow();
});
