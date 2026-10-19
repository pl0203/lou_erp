import assert from 'node:assert/strict';
// Accepted SQL encoding: PostgreSQL jsonb::text spacing/key ordering, ordinary
// JSON strings and losslessly roundtrippable decimal numbers. Our public fixture is ASCII.
// A recursive parser detects duplicate keys BEFORE object construction.
function decimalIdentity(token){
 const match=token.match(/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/);assert.ok(match);
 let digits=(match[2]+(match[3]??'')).replace(/^0+/,''),exponent=BigInt(match[4]??'0')-BigInt((match[3]??'').length);
 if(!digits)return '0';
 while(digits.endsWith('0')){digits=digits.slice(0,-1);exponent++;}
 return match[1]+digits+'e'+exponent.toString();
}
export function parseReadJson(text,{postgres=false,canonical=false}={}) {
 assert.equal(typeof text,'string');assert.ok(Buffer.byteLength(text)<=128*1024);let i=0;
 const ws=()=>{while(/[\x20\t\r\n]/.test(text[i]??'X'))i++;};
 function read(depth=0){
  assert.ok(depth<64);ws();const start=i,c=text[i];
  if(c==='"') {i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}
   const token=text.slice(start,i),value=JSON.parse(token);assert.equal(typeof value,'string');return {value,pg:JSON.stringify(value)};}
  if(c==='{'||c==='['){i++;ws();const object=c==='{',entries=[],seen=new Set();const end=object?'}':']';
   if(text[i]!==end)while(true){
    let key;if(object){assert.equal(text[i],'"');key=read(depth+1).value;assert.ok(!seen.has(key),'Duplicate JSON key');seen.add(key);ws();assert.equal(text[i++],':');}
    const entry=read(depth+1);entries.push({key,...entry});ws();if(text[i]!==',')break;i++;ws();
   }
   assert.equal(text[i++],end);
   if(object){const value=Object.fromEntries(entries.map(x=>[x.key,x.value]));const sorted=[...entries].sort((a,b)=>Buffer.byteLength(a.key)-Buffer.byteLength(b.key)||Buffer.compare(Buffer.from(a.key),Buffer.from(b.key)));
    return {value,pg:'{'+sorted.map(x=>JSON.stringify(x.key)+': '+x.pg).join(', ')+'}'};}
   return {value:entries.map(x=>x.value),pg:'['+entries.map(x=>x.pg).join(', ')+']'};
  }
  const token=text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/)?.[0];assert.ok(token);i+=token.length;
  const value=JSON.parse(token);if(typeof value==='number'){assert.ok(Number.isFinite(value)&&Math.abs(value)<=Number.MAX_SAFE_INTEGER);
   assert.ok(!Object.is(value,-0),'Negative zero spelling refused');
   if(postgres)assert.ok(!/[eE]/.test(token),'PostgreSQL numeric exponent spelling refused');
   assert.equal(decimalIdentity(token),decimalIdentity(JSON.stringify(value)),'Precision-changing numeric normalization refused');}
  return {value,pg:token};
 }
 const {value,pg}=read();ws();assert.equal(i,text.length);
 const canonicalText=canonicalReadJson(value);
 if(postgres)assert.equal(text,pg,'Noncanonical PostgreSQL JSON encoding');
 if(canonical)assert.equal(text,canonicalText,'Noncanonical persisted JSON');
 return {value,canonicalText};
}
export function canonicalReadJson(value){
 if(Array.isArray(value))return '['+value.map(canonicalReadJson).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalReadJson(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
