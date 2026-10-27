import React from 'react';
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {screen} from '@testing-library/react';
import {customer,mountApp,stockFixture} from './stock-ui-harness';
import App from '../../src/App';
test('normal stock return entry routes to workspace without trusting a carried customer or mounting legacy draft editor',async()=>{stockFixture();mountApp(<App/>,`/athel/co/stock?customer=${customer}`);const link=await screen.findByRole('link',{name:'Stock Return'});expect(link.getAttribute('href')).toBe('/athel/co/returns');expect(screen.queryByRole('button',{name:'Retur barang belum terjual'})).toBeNull();expect(screen.queryByRole('button',{name:'Simpan Draft retur'})).toBeNull();});
test('source proposal recovery remains ahead of the normal stock owner',()=>{const s=readFileSync('src/pages/athel/co/COCustomerStock.tsx','utf8');expect(s).toContain('coSourceProposalRequest(params');expect(s).toContain('<COSourceProposalResume');expect(s).toContain("owner={{kind:'return'}}");});
