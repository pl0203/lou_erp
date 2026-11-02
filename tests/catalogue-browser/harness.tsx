import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProductList from './source/src/pages/athel/ProductList'
import {POProductLookup} from './source/src/components/POLookup'
import CustomerList from './source/src/pages/athel/CustomerList'
import { FixturePanel } from './fixture'
import './source/src/index.css'
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
function ProductScenario(){const [picked,setPicked]=useState('');const [selections,setSelections]=useState(0);return <><ProductList/><section className="p-4" aria-label="Synthetic shared product lookup"><POProductLookup products={[{id:'44444444-4444-4444-8444-444444444444',sku:'LONG-SKU-123456789012345678901234567890',name:'Fictional Long Product Name To Verify Wrapping',size:'60x120',product_type:'Rumput Sintetis'}]} onSelect={product=>{setPicked(product.id);setSelections(n=>n+1)}}/><output id="product-picked" data-selections={selections}>{picked}</output></section></>}
const productScenario=new URLSearchParams(location.search).get('scenario')==='products'
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><FixturePanel/>{productScenario?<ProductScenario/>:<CustomerList/>}</QueryClientProvider></StrictMode>)
