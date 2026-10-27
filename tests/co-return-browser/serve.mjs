// Static owned-loopback fixture only; this script NEVER launches a browser.
import {createServer} from 'node:http';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname,join} from 'node:path';
const root=fileURLToPath(new URL('./dist/',import.meta.url));
const files=new Map();
async function index(path,prefix=''){for(const e of await readdir(path,{withFileTypes:true})){if(e.isDirectory())await index(join(path,e.name),prefix+e.name+'/');else files.set('/'+prefix+e.name,await readFile(join(path,e.name)))}}
await index(root);
const server=createServer((req,res)=>{
 const path=new URL(req.url??'/','http://127.0.0.1').pathname,target=path==='/'?'/index.html':path;
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'})[extname(target)]??'application/octet-stream');
 res.writeHead(files.has(target)?200:404);res.end(files.get(target)??'Not found');
});
server.listen(0,'127.0.0.1',()=>console.log(`Synthetic Stock Return fixture: http://127.0.0.1:${server.address().port}/ (no browser launched)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
