import { ChainFrontendModule, sidechainProfile } from '@app/chain/chain-module';

/** BitNames: names that point to keys, addresses and data, owned like coins. */
const bitnames: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'bitnames', name: 'BitNames', tagline: 'Names that point to keys, addresses and data, owned like coins', slot: 3, color: '#b48cff', bech32Main: 'bn',
    mark: ['M4.5 9.5a3 3 0 0 1 3-3h11.3a3 3 0 0 1 2.1.9l6.6 6.5a3 3 0 0 1 0 4.2l-6.6 6.5a3 3 0 0 1-2.1.9H7.5a3 3 0 0 1-3-3z', 'M10 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M18 13.5l3 2.5-3 2.5'],
  }),
  nav: [{ path: '/names', title: 'Names', icon: 'chain-mark' }],
  routes: [
    { path: 'names', loadComponent: () => import('./names.page').then(m => m.BitnamesNamesPage) },
    { path: 'name/:id', loadComponent: () => import('./names.page').then(m => m.BitnamesNamesPage) },
  ],
  markers: [{
    tag: '424e414d', name: 'BitNames', short: 'BNAM', help: 'A BitNames operation (bitnames/src/bitnames/state.h)',
    describe: (p) => 'BitNames · ' + (['transfer of names', 'name reserved', 'name registered', 'name updated', 'ICANN names', 'name released', 'subname registered'][p[1]] ?? 'operation ' + p[1]),
  }],
};

export default bitnames;
