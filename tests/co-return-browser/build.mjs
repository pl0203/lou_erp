import {build} from 'vite';
import {mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import config from './vite.config.mjs';
export async function buildFixture(outDir){
 await build({...config,build:{...config.build,outDir}});
 const fontOut=join(outDir,'fonts/plus-jakarta-sans');await mkdir(fontOut,{recursive:true});
 for(const name of ['PlusJakartaSans-Variable.ttf','PlusJakartaSans-Italic-Variable.ttf','OFL.txt'])await copyFile(new URL('../../public/fonts/plus-jakarta-sans/'+name,import.meta.url),join(fontOut,name));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildFixture(fileURLToPath(new URL('./dist/',import.meta.url)));
