import { ChainModule } from '../../module';

/**
 * Chains, the mainchain (Bitcoin Core v32 with BIP300/BIP301). Its drivechain views (BMM, deposits, withdrawals,
 * votes, proposals) are the core's drivechain index (chain/drivechain.ts), served at /api/v1/drivechain/*.
 */
const chains: ChainModule = {
  profile: { id: 'chains', name: 'Chains', unit: 'CHN', slot: null, mainchain: true, subsidy: true, bech32: { main: 'chn', testnet: 'tchn', regtest: 'rchn' } },
};

export default chains;
