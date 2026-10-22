import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * BitNames (slot 2): names registered on a sidechain (reservations, registrations, updates). Its explorer runs on the
 * L2 page set (chain/l2/), with the /names pages. Branding (colour, mark) is a placeholder.
 */
const bitnames: ChainFrontendModule = {
  profile: {
    id: 'bitnames', kind: 'l2', name: 'BitNames', tagline: 'BitNames, a naming sidechain of eCash (BIP300 slot 2)',
    unit: 'sats', subunit: 'sats', slot: 2, mainchain: false, color: '#5aa6ff',
    // a bound book
    ...SIDECHAIN_MARKS.bitnames,
    blockWeightUnits: 4000000,
  },
  features: ['names'],
  // the feature pages of its own (chain/l2/l2.routes.ts puts them ahead of the generic ones)
  routes: [
    { path: 'names', loadComponent: () => import('./names.page').then(m => m.BitNamesNamesPage) },
    { path: 'names/:id', loadComponent: () => import('./names.page').then(m => m.BitNamesNamePage) },
  ],
};

export default bitnames;
