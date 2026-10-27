// @vitest-environment jsdom
import { describe,it,expect,vi,afterEach } from 'vitest';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import { useState } from 'react';
import COImportReviewTable from '../../../src/components/co/COImportReviewTable';
import type { ReviewInput,ReviewValidation } from '../../../src/lib/co/import/types';
afterEach(cleanup);
const row={id:'r1',ref:{fileSha256:'a'.repeat(64),page:1,sheet:null,row:'r7',section:'s'},sourceSku:'SKU1',name:'Mosaic',transactionDate:null,transactionReference:null,quantity:{raw:'8',decimal:'8'},returned:{raw:'2',decimal:'2'},unit:'PCS',unitPrice:{raw:'12.500',decimal:'12500'},discount:null,discountBasis:null,netUnitPrice:null,amount:{raw:'100.000',decimal:'100000'},currency:'IDR',priceBasisLabel:null,flags:[]} as const;
const input:ReviewInput={scope:{actorId:'a',customerId:'c',reportMonth:'2026-10-01',epoch:0},extracted:{sha256:'a'.repeat(64),format:'pdf',parserVersion:'test',sourceRows:[{...row,flags:[]}],sections:[{id:'s',label:'CONSI',rowIds:['r1'],printedTotal:null}],periodCandidates:[],customerCandidates:[],warnings:[]},mappings:[],returns:[],includedSectionIds:['s'],completenessConfirmed:false,omittedZeroStockKeyIds:[],currency:null,reason:null};
const validation:ReviewValidation={issues:[{code:'mapping_required',rowId:'r1',message:'SKU belum cocok',blocking:true}],quantities:[],totalsByUnit:{},sourceAmount:null,canConfirm:false};
describe('table-first source review',()=>{
it('keeps original sales and returns independent with physical evidence',()=>{render(<COImportReviewTable input={input} validation={validation} onChange={vi.fn()}/>);expect(screen.getByRole('table')).toBeTruthy();for(const label of ['Qty asal','Retur','Terjual','Harga satuan laporan','Diskon','Total sumber']) expect(screen.getByText(label)).toBeTruthy();expect(screen.getByText('r7')).toBeTruthy();expect(screen.queryByText(/Simpan draf/i)).toBeNull();});
it('section and completeness choices are explicit and retain original evidence',()=>{const change=vi.fn();render(<COImportReviewTable input={input} validation={validation} onChange={change}/>);fireEvent.click(screen.getByLabelText('CONSI'));expect(change.mock.calls[0][0].extracted).toBe(input.extracted);fireEvent.click(screen.getByLabelText(/Semua barang/));expect(change.mock.calls[1][0].completenessConfirmed).toBe(true);});
it('filters without dropping decisions and exposes an accessible error summary',()=>{function Host(){const [value,setValue]=useState(input);return <COImportReviewTable input={value} validation={validation} onChange={setValue}/>};render(<Host/>);fireEvent.click(screen.getByLabelText('Tampilkan yang perlu diperiksa'));expect(screen.getByText('Mosaic')).toBeTruthy();expect(screen.getByRole('region',{name:'Hal yang perlu diperiksa'}).getAttribute('tabindex')).toBe('-1');});
});
it('F2 omitted eligible B exposes its own explicit unit declaration without remapping A',()=>{const save=vi.fn();const checked={...input,mappings:[{rowId:'r1',stockKeyId:'a',ledgerUnit:'PCS',quantity:'8' as any,conversion:null,included:true,exclusionReason:null,confirmed:true}]};const context:any={context:{customerVersion:'1'},rows:[{stock_key_id:'a',display_sku:'A',product_name:'Mapped A'},{stock_key_id:'b',display_sku:'B',product_name:'Omitted B'}],units:[{stockKeyId:'a',declaration:{unit:'PCS'}},{stockKeyId:'b',declaration:null}]};render(<COImportReviewTable input={checked} validation={validation} context={context} onChange={vi.fn()} onDeclareUnit={save}/>);fireEvent.change(screen.getByLabelText('Satuan buku baru'),{target:{value:'DOS'}});fireEvent.change(screen.getByLabelText('Dasar pernyataan satuan'),{target:{value:'Warehouse pack evidence'}});const button=screen.getByRole('button',{name:'Nyatakan satuan'});expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByLabelText('Saya memastikan satuan buku ini'));fireEvent.click(button);expect(save).toHaveBeenCalledWith('b','DOS','Warehouse pack evidence');expect(screen.getByRole('columnheader',{name:'SKU Padiwan / barang'})).toBeTruthy();expect(screen.getByText('Mapped A')).toBeTruthy()});
it('F2 explicit zeros update only changed omitted controls and retain current intent',()=>{
 const context:any={context:{customerVersion:'1'},rows:Array.from({length:120},(_,i)=>({stock_key_id:`k${i}`,display_sku:`SKU${i}`,product_name:`Item${i}`})),units:Array.from({length:120},(_,i)=>({stockKeyId:`k${i}`,declaration:{unit:'PCS'}}))};
 let latest=input;
 function Host(){const [value,setValue]=useState(input);latest=value;return <COImportReviewTable input={value} validation={validation} context={context} onChange={next=>setValue(next)}/>}
 render(<Host/>);
 const zeros=screen.getAllByLabelText(/^Nol penjualan:/) as HTMLInputElement[];
 let omittedWrites=0;
 const descriptors=zeros.map(node=>Object.getOwnPropertyDescriptor(node,'checked')!);
 zeros.forEach((node,i)=>Object.defineProperty(node,'checked',{...descriptors[i],set(value){omittedWrites++;descriptors[i].set!.call(this,value)}}));
 try {
  for(const zero of zeros.slice(0,20))fireEvent.click(zero);
  expect(latest.omittedZeroStockKeyIds).toEqual(Array.from({length:20},(_,i)=>`k${i}`));
  console.info('F2 bounded 120-row / 20-click omitted checked writes:',omittedWrites);
  expect(omittedWrites).toBeLessThanOrEqual(40);
  fireEvent.click(zeros[0]);expect(latest.omittedZeroStockKeyIds).toEqual(Array.from({length:19},(_,i)=>`k${i+1}`));
 } finally {zeros.forEach((node,i)=>Object.defineProperty(node,'checked',descriptors[i]))}
});
it('F2 memoized omitted row uses current owner callback and resets declaration on context version change',()=>{
 const oldSave=vi.fn(),newSave=vi.fn(),change=vi.fn();
 const context:any={context:{customerVersion:'1'},rows:[{stock_key_id:'b',display_sku:'B',product_name:'Omitted B'}],units:[{stockKeyId:'b',declaration:null}]};
 const view=render(<COImportReviewTable input={input} validation={validation} context={context} onChange={change} onDeclareUnit={oldSave}/>);
 fireEvent.change(screen.getByLabelText('Satuan buku baru'),{target:{value:'OLD'}});
 fireEvent.change(screen.getByLabelText('Dasar pernyataan satuan'),{target:{value:'old evidence'}});
 fireEvent.click(screen.getByLabelText('Saya memastikan satuan buku ini'));
 const next={...input,scope:{...input.scope,epoch:2},reason:'current owner'};
 view.rerender(<COImportReviewTable input={next} validation={validation} context={{...context,context:{customerVersion:'2'}}} onChange={change} onDeclareUnit={newSave}/>);
 expect((screen.getByLabelText('Satuan buku baru') as HTMLInputElement).value).toBe('');
 expect((screen.getByLabelText('Saya memastikan satuan buku ini') as HTMLInputElement).checked).toBe(false);
 fireEvent.click(screen.getByLabelText(/^Nol penjualan:/));expect(change.mock.calls[0][0]).toMatchObject({scope:{epoch:2},reason:'current owner',omittedZeroStockKeyIds:['b']});
 fireEvent.change(screen.getByLabelText('Satuan buku baru'),{target:{value:'DOS'}});
 fireEvent.change(screen.getByLabelText('Dasar pernyataan satuan'),{target:{value:'current evidence'}});
 fireEvent.click(screen.getByLabelText('Saya memastikan satuan buku ini'));fireEvent.click(screen.getByRole('button',{name:'Nyatakan satuan'}));
 expect(oldSave).not.toHaveBeenCalled();expect(newSave).toHaveBeenCalledWith('b','DOS','current evidence');
 view.rerender(<COImportReviewTable input={next} validation={validation} context={context} onChange={change} onDeclareUnit={newSave} disabled/>);
 fireEvent.click(screen.getByLabelText(/^Nol penjualan:/));expect(change).toHaveBeenCalledTimes(1);
});
