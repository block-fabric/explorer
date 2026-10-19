import { ChainFrontendModule } from '@app/chain/chain-module';

/**
 * Chains, the mainchain (BIP300/BIP301). Its drivechain pages (the block page's Drivechain box, /drivechain) are
 * core pages (app/chain/), since every explorer links into them.
 */
const chains: ChainFrontendModule = {
  profile: {
    id: 'chains', name: 'Chains', tagline: 'The Chains drivechain mainchain (BIP300/BIP301)', unit: 'CHN', subunit: 'sats',
    slot: null, mainchain: true, color: '#b5f27e',
    mark: ['M11 16h10'], markRects: [{ x: 3, y: 9, w: 12, h: 14, rx: 3.5 }, { x: 17, y: 9, w: 12, h: 14, rx: 3.5 }],
    bech32: { main: 'chn', testnet: 'tchn', regtest: 'rchn' }, blockWeightUnits: 800000,
  },
};

export default chains;
