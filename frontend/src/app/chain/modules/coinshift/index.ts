import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Coinshift (slot 255): swaps between a parent chain (L1) and the sidechain (SwapCreate, SwapClaim, SwapAccept; output
 * content SwapPending). Its explorer runs on the L2 page set (chain/l2/), with the /swaps pages. Branding (colour,
 * mark) is a placeholder.
 */
const coinshift: ChainFrontendModule = {
  profile: {
    id: 'coinshift', kind: 'l2', name: 'Coinshift', tagline: 'Coinshift, a swap sidechain of eCash (BIP300 slot 255)',
    unit: 'sats', subunit: 'sats', slot: 255, mainchain: false, color: '#ff8a3d',
    // two arrows turning around each other
    ...SIDECHAIN_MARKS.coinshift,
    blockWeightUnits: 4000000,
  },
  features: ['swaps'],
  // the feature pages of its own (chain/l2/l2.routes.ts puts them ahead of the generic ones)
  routes: [
    { path: 'swaps', loadComponent: () => import('./swaps.page').then(m => m.CoinshiftSwapsPage) },
    { path: 'swaps/:id', loadComponent: () => import('./swaps.page').then(m => m.CoinshiftSwapPage) },
  ],
};

export default coinshift;
