// Fictional import fixture; no workbook or customer information.
export function syntheticImportManifest() {
 const line=(key,quantity,unitPrice)=>({key,productKey:'product-a',productName:'Historical line name',sku:'HISTORIC-A',quantity,unitPrice,uom:'PIECE'});
 const po=(key,lines,shipments=[])=>({key,customerKey:'customer-a',poNumber:`SYNTH-IMPORT-${key}`,orderDate:'2026-01-02',expectedDeliveryDate:null,sourceStatus:null,notes:'Synthetic import test',lines,shipments});
 const sj=(key,lines)=>({key,number:`SYNTH-SJ-${key}`,date:'2026-02-03',dateReceived:'2026-02-04',dateReturned:null,sourceSender:'Synthetic sender',lines});
 return {version:1,
  customers:[{key:'customer-a',name:'Synthetic imported customer',address:'Synthetic street 123',city:'Synthetic city A',phone:'+00 000 000000',email:'synthetic-imported@example.invalid',sourceTier:'Original synthetic outside-tier group',pricingTier:'others'}],
  products:[{key:'product-a',name:'Current catalog name',sku:'CURRENT-CATALOG-A',size:'Synthetic size A'},{key:'product-unused',name:'Unused catalog item',sku:'CURRENT-CATALOG-UNUSED',size:'Synthetic size'}],
  purchaseOrders:[
   po('anchor',[line('a',5,'10.25'),{...line('zero',2,'0.00'),productName:'Legitimate free item',sku:'HISTORIC-FREE'}],[sj('anchor-1',[{lineKey:'a',quantity:2},{lineKey:'zero',quantity:2}]),sj('anchor-2',[{lineKey:'a',quantity:3}])]),
   po('open',[line('b',3,'1.11')]),
   po('partial',[line('c',4,'2.50')],[sj('partial',[{lineKey:'c',quantity:1}])]),
   po('last',[line('d',1,'9.99')]),
  ],
 };
}

// Fixed reviewed import-size shape. Values and labels are entirely fictional.
export function syntheticImportSizeManifest() {
 const customers=Array.from({length:300},(_,i)=>({key:`size-customer-${i}`,name:`Synthetic import size customer ${String(i).padStart(4,'0')}`,address:'Synthetic address for byte-size and recovery testing only',city:'Synthetic city',phone:null,email:null,sourceTier:i%2?'Unmapped synthetic group':null,pricingTier:i%2?'luar_kota':'others'}));
 const products=Array.from({length:2100},(_,i)=>({key:`size-product-${i}`,name:`Synthetic import size product ${String(i).padStart(4,'0')}`,sku:`SYNTH-SIZE-SKU-${String(i).padStart(4,'0')}`,size:'Synthetic size'}));
 const purchaseOrders=Array.from({length:1500},(_,i)=>{
  const count=i===0?40:i<500?3:2;
  const lines=Array.from({length:count},(_,j)=>({key:`size-line-${i}-${j}`,productKey:products[(i*3+j)%products.length].key,productName:`Historical synthetic item ${i}-${j}`,sku:products[(i*3+j)%products.length].sku,quantity:5,unitPrice:j===2?'0.00':'10.25',uom:'PIECE'}));
  const shipments=[];
  const add=(suffix,qty)=>shipments.push({key:`size-sj-${i}-${suffix}`,number:`SYNTH-SIZE-SJ-${i}-${suffix}`,date:'2026-02-03',dateReceived:'2026-02-04',dateReturned:null,sourceSender:'Synthetic sender',lines:lines.map(l=>({lineKey:l.key,quantity:qty}))});
  if(i<1050){if(i<100){add('a',2);add('b',3);}else add('a',5);}
  else if(i<1250){if(i<1150){add('a',1);add('b',1);}else add('a',1);}
  return {key:`size-po-${i}`,customerKey:customers[i%customers.length].key,poNumber:`SYNTH-SIZE-PO-${String(i).padStart(4,'0')}`,orderDate:'2026-01-02',expectedDeliveryDate:null,sourceStatus:i%25===0?'Synthetic consignment label':null,notes:'Fictional import-size case with historical line identity preserved',lines,shipments};
 });
 return {version:1,customers,products,purchaseOrders};
}
