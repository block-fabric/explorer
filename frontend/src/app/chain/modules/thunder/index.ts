import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Thunder (slot 9): a payments sidechain, plain values and withdrawals, no TxData. Its explorer runs on the L2 page set
 * (chain/l2/). Branding (colour, mark) is a placeholder.
 */
const thunder: ChainFrontendModule = {
  profile: {
    id: 'thunder', kind: 'l2', name: 'Thunder', tagline: 'Thunder, a payments sidechain of eCash (BIP300 slot 9)',
    unit: 'sats', subunit: 'sats', slot: 9, mainchain: false, color: '#a585ff',
    // a lightning bolt
    ...SIDECHAIN_MARKS.thunder,
    blockWeightUnits: 4000000,
  },
  features: [],
};

export default thunder;
