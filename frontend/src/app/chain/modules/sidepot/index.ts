import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Sidepot (slot 88): a last-buyer-wins key game on a fork of Thunder. Its explorer runs on the L2 page set
 * (chain/l2/), with a Game page of its own (the node's game state, game accounts, and the moves posted on eCash).
 */
const sidepot: ChainFrontendModule = {
  profile: {
    id: 'sidepot', kind: 'l2', name: 'Sidepot', tagline: 'Sidepot, a key game sidechain of eCash (BIP300 slot 88)',
    unit: 'sats', subunit: 'sats', slot: 88, mainchain: false, color: '#e8b04b',
    ...SIDECHAIN_MARKS.sidepot,
    blockWeightUnits: 4000000,
  },
  features: ['richlist', 'game'],
  nav: [
    { path: '/nodes', title: 'Nodes: the reachable nodes of the network, their versions', icon: 'nav-network' },
  ],
  routes: [
    { path: 'game', loadComponent: () => import('./game.page').then(m => m.SidepotGamePage) },
    { path: 'richlist', loadComponent: () => import('../thunder/richlist.page').then(m => m.ThunderRichlistPage) },
    { path: 'nodes', loadChildren: () => import('@app/chain/nodes/nodes.module').then(m => m.ChainNodesModule) },
  ],
};

export default sidepot;
