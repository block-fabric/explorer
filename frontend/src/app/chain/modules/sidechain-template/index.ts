import { ChainFrontendModule, sidechainProfile } from '@app/chain/chain-module';

/**
 * The starting point for a new sidechain: copy this folder to modules/<your-id>/, set the profile, and add one line
 * to modules/index.ts (and do the same on the backend, backend/src/chain/modules/). See chains/MODULES.md.
 *
 * With only a profile, the sidechain gets the whole explorer (blocks, transactions, mempool) plus the drivechain
 * views every sidechain has (/bmm: the Chains blocks that carried it, deposits, withdrawals). Add pages with
 * `routes` + `nav`, and a transaction panel with `txView`, e.g.:
 *
 *   nav: [{ path: '/things', title: 'Things', icon: 'chain-mark' }],
 *   routes: [{ path: 'things', loadComponent: () => import('./things.page').then(m => m.ThingsPage) }],
 *   txView: () => import('./thing-tx.component').then(m => m.ThingTxComponent),
 */
const sidechainTemplate: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'sidechain-template', name: 'Sidechain', tagline: 'A Chains sidechain', slot: 0, color: '#9aa4b2', bech32Main: 'sc',
    mark: ['M6 8h20v16H6z', 'M11 16h10'],
  }),
};

export default sidechainTemplate;
