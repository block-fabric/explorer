import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Hivemind (Truthcoin, slot 13): prediction markets and oracle votes on a sidechain. Its explorer runs on the L2 page
 * set (chain/l2/), with the /markets pages. Branding (colour, mark: Truthcoin's) is a placeholder.
 */
const hivemind: ChainFrontendModule = {
  profile: {
    id: 'hivemind', kind: 'l2', name: 'Hivemind', tagline: 'Hivemind, a prediction market sidechain of eCash (BIP300 slot 13)',
    unit: 'sats', subunit: 'sats', slot: 13, mainchain: false, color: '#7bd88f',
    // a circle with a check
    ...SIDECHAIN_MARKS.truthcoin,
    blockWeightUnits: 4000000,
  },
  features: ['markets'],
  // the feature pages of its own (chain/l2/l2.routes.ts puts them ahead of the generic ones)
  routes: [
    { path: 'markets', loadComponent: () => import('./markets.page').then(m => m.HivemindMarketsPage) },
    { path: 'markets/:id', loadComponent: () => import('./markets.page').then(m => m.HivemindMarketPage) },
    { path: 'decisions', loadComponent: () => import('./oracle.page').then(m => m.HivemindDecisionsPage) },
    { path: 'decisions/:id', loadComponent: () => import('./oracle.page').then(m => m.HivemindDecisionPage) },
    { path: 'votes', loadComponent: () => import('./oracle.page').then(m => m.HivemindVotesPage) },
  ],
};

export default hivemind;
