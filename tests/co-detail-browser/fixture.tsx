import React from 'react';import {createRoot} from 'react-dom/client';import {createMemoryRouter,RouterProvider} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import CODetail from '../../src/pages/athel/co/CODetail';import {fixture,coId} from './boundary';import '../../src/index.css';
const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
const router=createMemoryRouter([{path:'/athel/co/:id',element:<CODetail/>}],{initialEntries:[`/athel/co/${coId}`]});Object.assign(window,{fixture});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><main style={{padding:24}}><p style={{fontSize:12,color:'#475569',marginBottom:16}}>LOCAL SYNTHETIC TEST — no hosted account or data</p><RouterProvider router={router}/></main></QueryClientProvider>);
