import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * BitAssets (slot 4): assets, Dutch auctions and AMM pools on a sidechain. Its explorer runs on the L2 page set
 * (chain/l2/), with the /assets, /auctions and /pools pages. Branding (colour, mark) is a placeholder.
 */
const bitassets: ChainFrontendModule = {
  profile: {
    id: 'bitassets', kind: 'l2', name: 'BitAssets', tagline: 'BitAssets, an asset sidechain of eCash (BIP300 slot 4)',
    unit: 'sats', subunit: 'sats', slot: 4, mainchain: false, color: '#f5b83d',
    // a stack of coins
    ...SIDECHAIN_MARKS.bitassets,
    blockWeightUnits: 4000000,
  },
  features: ['assets'],
};

export default bitassets;
