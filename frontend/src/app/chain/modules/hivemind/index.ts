import { ChainFrontendModule, sidechainProfile } from '@app/chain/chain-module';

/** Hivemind: prediction markets, resolved by votecoin holders. */
const hivemind: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'hivemind', name: 'Hivemind', tagline: 'Prediction markets, resolved by votecoin holders', slot: 9, color: '#f5b83d', bech32Main: 'hm',
    mark: ['M16 3.5l10.8 6.25v12.5L16 28.5 5.2 22.25V9.75z', 'M10.5 19.5l3.8-3.8 2.9 2.9 4.3-5.1', 'M21.5 13.5v3'],
  }),
  nav: [{ path: '/markets', title: 'Markets, decisions and reputation', icon: 'chain-mark' }],
  routes: [{ path: 'markets', loadComponent: () => import('./markets.page').then(m => m.HivemindMarketsPage) }],
  markers: [{
    tag: 'db48564d', name: 'Hivemind', short: 'HVMD', help: 'A Hivemind action (hivemind/src/hivemind/state.h)',
    describe: (p) => 'Hivemind · ' + (['', 'decision listed', 'market opened', 'shares bought', 'shares sold', 'reputation transferred', 'vote sealed',
      'vote revealed', 'ballot sealed', 'ballot revealed'][p[0]] || 'action ' + p[0]),
  }],
};

export default hivemind;
