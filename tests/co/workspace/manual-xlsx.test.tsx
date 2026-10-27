import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import COManualTranscription from '../../../src/components/co/COManualTranscription';
import {buildManualTranscription} from '../../../src/lib/co/import/manual';
import {input} from '../import/reviewFixture';
vi.mock('../../../src/components/co/COSourcePreview',()=>({default:({selectedRef}:any)=><div data-testid="source-ref">{JSON.stringify(selectedRef)}</div>}));
const original=()=>({...input().extracted,format:'xlsx' as const,parserVersion:'co-guarded-xlsx-7',sourceRows:[],sections:[],warnings:['manual_review:safe_unsupported_xlsx_layout'],manualWorkbook:{version:1 as const,policy:'co-manual-xlsx-values-1' as const,sheets:[{name:'Sheet',rows:[4,10]},{name:'Other',rows:[7]}]}});
afterEach(cleanup);
const file=new File(['synthetic'],'manual.xlsx');
describe('manual workbook all-sheet human UI',()=>{
 it('selects exact physical sheet/row, confirms all sheets and absent controls, resets consent on edits',async()=>{
  const onTranscribe=vi.fn();render(<COManualTranscription original={original()} file={file} onTranscribe={onTranscribe} disabled={false}/>);
  fireEvent.click(screen.getByText('Transkripsikan sumber secara manual'));
  expect(screen.queryByLabelText('Halaman')).toBeNull();
  fireEvent.change(screen.getByLabelText('Sheet sumber'),{target:{value:'Sheet'}});
  for(const [label,value] of [['Nomor / label baris fisik','r4'],['Bagian sumber','s1'],['Nama barang','Human'],['Qty asal','0002'],['Satuan sumber','PCS'],['Alasan transkripsi','Reviewed original']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText('Konvensi angka'),{target:{value:'decimal_dot'}});
  fireEvent.click(screen.getByLabelText('Sheet diperiksa: Sheet'));fireEvent.click(screen.getByLabelText('Sheet diperiksa: Other'));
  const confirm=screen.getByLabelText(/Saya memeriksa semua sheet/);fireEvent.click(confirm);
  fireEvent.click(screen.getByText('Gunakan transkripsi manusia untuk pemeriksaan'));
  expect(onTranscribe).toHaveBeenCalledTimes(1);const s=buildManualTranscription(original(),onTranscribe.mock.calls[0][0]);expect(s.sourceRows[0].quantity).toEqual({raw:'0002',decimal:'2',convention:'decimal_dot'});expect(s.manualPrintedControls).toEqual({version:2,reviewedSheets:['Sheet','Other'],confirmed:true,controls:[]});
  fireEvent.change(screen.getByLabelText('Qty asal'),{target:{value:'3'}});expect((confirm as HTMLInputElement).checked).toBe(false);
 });
 it('discards open form state when original file/scope extraction changes',()=>{const r=render(<COManualTranscription original={original()} file={file} onTranscribe={()=>{}} disabled={false}/>);fireEvent.click(screen.getByText('Transkripsikan sumber secara manual'));fireEvent.change(screen.getByLabelText('Alasan transkripsi'),{target:{value:'Old scope'}});r.rerender(<COManualTranscription original={{...original(),sha256:'b'.repeat(64)}} file={new File(['new'],'other.xlsx')} onTranscribe={()=>{}} disabled={false}/>);expect(screen.queryByDisplayValue('Old scope')).toBeNull()});
});

it('keeps observed blank control unresolved, absent metrics null, and invalidates consent for coverage edits',()=>{
 const onTranscribe=vi.fn();render(<COManualTranscription original={original()} file={file} onTranscribe={onTranscribe} disabled={false}/>);
 fireEvent.click(screen.getByText('Transkripsikan sumber secara manual'));
 fireEvent.change(screen.getByLabelText('Sheet sumber'),{target:{value:'Sheet'}});
 for(const [label,value] of [['Nomor / label baris fisik','r4'],['Bagian sumber','s1'],['Nama barang','Human'],['Qty asal','2'],['Alasan transkripsi','Read all sheet controls']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.change(screen.getByLabelText('Konvensi angka'),{target:{value:'decimal_dot'}});
 fireEvent.click(screen.getByText('Tambah kontrol tercetak'));
 fireEvent.change(screen.getByLabelText('Sheet kontrol'),{target:{value:'Sheet'}});
 fireEvent.change(screen.getByLabelText('Baris fisik kontrol (rN)'),{target:{value:'r10'}});
 fireEvent.change(screen.getByLabelText('Label bagian kontrol'),{target:{value:'Total'}});
 fireEvent.click(screen.getByLabelText('amount tercantum'));
 fireEvent.click(screen.getByLabelText('Sheet/r4 · Human'));
 fireEvent.click(screen.getByLabelText('Sheet diperiksa: Sheet'));fireEvent.click(screen.getByLabelText('Sheet diperiksa: Other'));
 const consent=screen.getByLabelText(/Saya memeriksa semua sheet/);fireEvent.click(consent);fireEvent.click(screen.getByText('Gunakan transkripsi manusia untuk pemeriksaan'));
 const control=onTranscribe.mock.calls[0][0].manualPrintedControls.controls[0];expect(control.amount).toEqual({raw:'',decimal:null,convention:'decimal_dot'});expect(control.count).toBeNull();expect(control.quantity).toBeNull();expect(control.returned).toBeNull();expect(control.rowIds).toHaveLength(1);
 fireEvent.click(screen.getByLabelText('Sheet/r4 · Human'));expect((consent as HTMLInputElement).checked).toBe(false);
});
