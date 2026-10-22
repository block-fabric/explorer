import config from '../config';

/**
 * The eCash (ECX) networks, as backboned and eCash's own node name them (-chain=). ECX is a fork of Bitcoin with
 * Bitcoin's formats: its addresses, 8-decimal amounts, 10-minute blocks, 2016-block retargets and 210,000-block
 * halvings. The BIP300 constants (activation height, thresholds) are not here: the enforcer reports them
 * (GetChainInfo), and they are provisional on mainnet.
 */

export type NetworkId = 'ecash' | 'ecashbeta' | 'ecashtest';

export interface Network {
  id: NetworkId;
  name: string;
  bech32: string;
  /** a block may come at the proof-of-work limit after 20 minutes without one (Bitcoin testnet4's rule) */
  minDifficultyBlocks: boolean;
}

export const NETWORKS: Record<NetworkId, Network> = {
  ecash: { id: 'ecash', name: 'Mainnet', bech32: 'bc', minDifficultyBlocks: false },
  ecashbeta: { id: 'ecashbeta', name: 'Betanet', bech32: 'bc', minDifficultyBlocks: false },
  ecashtest: { id: 'ecashtest', name: 'Testnet', bech32: 'tb', minDifficultyBlocks: true },
};

export const BLOCK_SPACING = 600;
export const RETARGET_INTERVAL = 2016;
export const HALVING_INTERVAL = 210000;

function resolve(): Network {
  const id = (config.CHAIN?.NETWORK || 'ecashbeta').toLowerCase();
  const n = NETWORKS[id as NetworkId];
  if (!n) {
    throw new Error(`Unknown CHAIN.NETWORK '${config.CHAIN?.NETWORK}'. Known: ${Object.keys(NETWORKS).join(', ')}`);
  }
  return n;
}

export const NETWORK: Network = resolve();
