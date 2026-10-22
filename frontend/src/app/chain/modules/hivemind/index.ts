import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Hivemind (Truthcoin, slot 13): prediction markets and oracle votes on a sidechain. Its explorer runs on the L2 page
 * set (chain/l2/), with the /markets pages. Branding (colour, mark: Truthcoin's) is a placeholder.
 */
const hivemind: ChainFrontendModule = {
  profile: {
    id: 'hivemind', kind: 'l2', name: 'Hivemind', tagline: 'Hivemind, a prediction market sidechain of eCash (BIP300 slot 13)',
    unit: 'sats', subunit: 'sats', slot: 13, mainchain: false, color: '#7bd88f',
    // a circle with a check
    ...SIDECHAIN_MARKS.truthcoin,
    blockWeightUnits: 4000000,
  },
  features: ['markets'],
};

export default hivemind;
