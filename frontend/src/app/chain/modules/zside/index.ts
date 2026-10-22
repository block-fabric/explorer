import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * zSide (thunder-orchard, slot 98): Thunder with an Orchard shielded pool. Its explorer runs on the L2 page set
 * (chain/l2/), with the /shielded page. Branding (colour, mark) is a placeholder.
 */
const zside: ChainFrontendModule = {
  profile: {
    id: 'zside', kind: 'l2', name: 'zSide', tagline: 'zSide, a shielded sidechain of eCash (BIP300 slot 98)',
    unit: 'sats', subunit: 'sats', slot: 98, mainchain: false, color: '#f26b9c',
    // a shield with a keyhole
    ...SIDECHAIN_MARKS.zside,
    blockWeightUnits: 4000000,
  },
  features: ['shielded'],
  // the feature pages of its own (chain/l2/l2.routes.ts puts them ahead of the generic ones)
  routes: [
    { path: 'shielded', loadComponent: () => import('./shielded.page').then(m => m.ZsideShieldedPage) },
  ],
};

export default zside;
