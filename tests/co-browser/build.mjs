import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { parts,zip } from '../co/import/fixtures/xlsx-layout.ts';
export async function buildHarness(outDir){
 const workbooks={stored:Array.from(zip(parts())),deflated:Array.from(zip(parts().map(p=>({...p,deflate:true})))),crc:Array.from(zip(parts().map((p,i)=>i?p:{...p,crc:0})))};
 return build({root:fileURLToPath(new URL('.',import.meta.url)),configFile:false,envDir:false,publicDir:false,css:{postcss:{plugins:[]}},esbuild:{jsx:'automatic'},define:{__WORKBOOKS__:JSON.stringify(workbooks)},worker:{format:'es'},build:{outDir,emptyOutDir:true,minify:false}});
}
