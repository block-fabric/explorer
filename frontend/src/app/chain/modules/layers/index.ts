import { ChainFrontendModule, sidechainProfile } from '@app/chain/chain-module';
import { BITASSETS_ROUTES, bitassetsMarkers } from '../bitassets';
import { FASTBLOCKS_MARKERS } from '../fastblocks';

/**
 * Layers: BitAssets over FastBlocks. A module made of two others: BitAssets' assets page and markers, FastBlocks'
 * validators page (which shows the fee split Layers adds) and markers, plus Layers' own validator pool markers.
 */
const layers: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'layers', name: 'Layers', tagline: 'Assets, pools and auctions on blocks of stake every 15 seconds', slot: 7, color: '#8f7cff', bech32Main: 'ly',
    mark: ['M16 4L29 11 16 18 3 11z', 'M3 16.5l13 7 13-7', 'M3 22l13 7 13-7'],
    blockWeightUnits: 1500000, pos: true,
  }),
  nav: [
    { path: '/assets', title: 'Assets, pools and auctions', icon: 'chain-mark' },
    { path: '/validators', title: 'Validators, fee split and finality', icon: 'nav-validators' },
  ],
  routes: [
    ...BITASSETS_ROUTES,
    { path: 'validators', loadComponent: () => import('../fastblocks/validators.page').then(m => m.FastblocksValidatorsPage) },
  ],
  tokens: true,
  markers: [
    ...bitassetsMarkers('Layers'),
    ...FASTBLOCKS_MARKERS,
    { tag: 'de56504c', name: 'Validator pool', short: 'VPOOL', help: 'Fees put into the validators\' pool (fee split), paid out by stake at the end of the epoch' },
    { tag: 'de565053', name: 'Validator pool shares', short: 'VPS', help: 'The validators\' shares of the pool follow this output',
      describe: (p) => `Validator pool shares · ${p.length >= 4 ? (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) : '?'} payouts follow` },
  ],
};

export default layers;
