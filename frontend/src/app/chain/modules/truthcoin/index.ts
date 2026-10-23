import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Truthcoin (slot 13; its node is LayerTwo's Hivemind): prediction markets and oracle votes on a sidechain. Its explorer runs on the L2 page
 * set (chain/l2/), with the /markets pages. Branding (colour, mark) is a placeholder; until Oct 2026 this explorer was 'hivemind' (/betanet/hivemind/ redirects).
 */
const truthcoin: ChainFrontendModule = {
  profile: {
    id: 'truthcoin', kind: 'l2', name: 'Truthcoin', tagline: 'Truthcoin, a prediction market sidechain of eCash (BIP300 slot 13)',
    unit: 'sats', subunit: 'sats', slot: 13, mainchain: false, color: '#7bd88f',
    // a circle with a check
    ...SIDECHAIN_MARKS.truthcoin,
    blockWeightUnits: 4000000,
  },
  features: ['markets'],
  // the feature pages of its own (chain/l2/l2.routes.ts puts them ahead of the generic ones)
  routes: [
    { path: 'markets', loadComponent: () => import('./markets.page').then(m => m.TruthcoinMarketsPage) },
    { path: 'markets/:id', loadComponent: () => import('./markets.page').then(m => m.TruthcoinMarketPage) },
    { path: 'decisions', loadComponent: () => import('./oracle.page').then(m => m.TruthcoinDecisionsPage) },
    { path: 'decisions/:id', loadComponent: () => import('./oracle.page').then(m => m.TruthcoinDecisionPage) },
    { path: 'votes', loadComponent: () => import('./oracle.page').then(m => m.TruthcoinVotesPage) },
  ],
};

export default truthcoin;
