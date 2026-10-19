import { ChainFrontendModule, MarkerLabel, sidechainProfile } from '@app/chain/chain-module';

/** BitAssets' marker, labelled with the name of the chain it runs on (BitAssets, Layers) */
export function bitassetsMarkers(chain: string): MarkerLabel[] {
  return [{
    tag: '42415354', name: `${chain} asset`, short: 'BAST', help: `A ${chain} asset operation (bitassets/src/bitassets/state.h)`,
    describe: (p) => `${chain} · ` + (['asset transfer', 'asset reserved', 'asset registered', 'mint', 'asset updated', 'burn', 'swap', 'liquidity added',
      'liquidity removed', 'Dutch auction created', 'auction bid', 'auction collected', 'asset released', 'route swap', 'oracle registered',
      'oracle attestation', 'oracle contract', 'oracle contract settled'][p[1]] ?? 'operation ' + p[1]),
  }];
}
export const BITASSETS_MARKERS = bitassetsMarkers('BitAssets');

/** The token explorer's pages, shared by BitAssets and Layers */
export const BITASSETS_ROUTES = [
  { path: 'assets', loadComponent: () => import('./assets.page').then(m => m.BitassetsAssetsPage) },
  { path: 'asset/:id', loadComponent: () => import('./asset.page').then(m => m.BitassetsAssetPage) },
  { path: 'pool/:id', loadComponent: () => import('./pool.page').then(m => m.BitassetsPoolPage) },
  { path: 'auction/:id', loadComponent: () => import('./auction.page').then(m => m.BitassetsAuctionPage) },
];

/** BitAssets: assets issued and traded on the sidechain: exchange pools and Dutch auctions. */
const bitassets: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'bitassets', name: 'BitAssets', tagline: 'Assets issued and traded on the sidechain: pools and Dutch auctions', slot: 4, color: '#2bc79a', bech32Main: 'ba',
    mark: ['M9.5 5h13l6.5 7.5L16 28 3 12.5z', 'M3 12.5h26', 'M12.5 5L10 12.5 16 28l6-15.5L19.5 5'],
  }),
  nav: [{ path: '/assets', title: 'Assets, pools and auctions', icon: 'chain-mark' }],
  routes: BITASSETS_ROUTES,
  markers: BITASSETS_MARKERS,
  tokens: true,
};

export default bitassets;
