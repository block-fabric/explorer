import { ChainFrontendModule, sidechainProfile } from '@app/chain/chain-module';

/** Thunder: payments with large blocks (32 M weight units); the stock views show its throughput. */
const thunder: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'thunder', name: 'Thunder', tagline: 'Large blocks, for volume', slot: 2, color: '#a585ff', bech32Main: 'th',
    mark: ['M18.5 3.5L8 18h7.5l-2 10.5L24.5 14H17z', 'M3.5 11.5h4', 'M2.5 16.5h3', 'M4.5 21.5h3'],
    blockWeightUnits: 32000000, bech32: { main: 'th', testnet: 'tth', regtest: 'rth' },
  }),
};

export default thunder;
