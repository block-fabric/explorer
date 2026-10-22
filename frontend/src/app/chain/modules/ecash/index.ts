import { ChainFrontendModule } from '@app/chain/chain-module';

/**
 * eCash (ECX), the mainchain: Bitcoin's formats with BIP300/BIP301 drivechains. Its drivechain pages (the block
 * page's Drivechain box, /drivechain) are core pages (app/chain/), since every explorer links into them.
 *
 * Branding (colour, mark) is a placeholder until eCash's own is settled.
 */
const ecash: ChainFrontendModule = {
  profile: {
    id: 'ecash', kind: 'l1', name: 'eCash', tagline: 'eCash (ECX) with BIP300/301 drivechains', unit: 'ECX', subunit: 'sats',
    slot: null, mainchain: true, color: '#2ec4b6',
    // a hexagon crossed by a bar
    mark: ['M16 3.5l10.8 6.25v12.5L16 28.5 5.2 22.25V9.75z', 'M11 16h10'],
    blockWeightUnits: 4000000,
  },
  nav: [{ path: '/mining', title: 'Mining: pools, DATUM miners, hashrate, difficulty', icon: 'nav-pickaxe' }],
  routes: [{ path: 'mining', loadChildren: () => import('./mining/mining.module').then(m => m.ChainMiningModule) }],
};

export default ecash;
