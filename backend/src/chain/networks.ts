import config from '../config';

/**
 * The eCash (ECX) networks, as backboned and eCash's own node name them (-chain=). ECX is a fork of Bitcoin with
 * Bitcoin's formats: its addresses, 8-decimal amounts, 10-minute blocks, 2016-block retargets and 210,000-block
 * halvings. Mainnet and betanet are Bitcoin's chain up to their fork block, whose difficulty is reset (`fork`); from
 * there mainnet retargets every 288 blocks, dampened (chain/retarget.ts). The BIP300 constants (activation height, thresholds) are not here: the enforcer reports them
 * (GetChainInfo), and they are provisional on mainnet.
 */

export type NetworkId = 'ecash' | 'ecashbeta' | 'ecashtest';

export interface Network {
  id: NetworkId;
  name: string;
  bech32: string;
  /** a block may come at the proof-of-work limit after 20 minutes without one (Bitcoin testnet4's rule) */
  minDifficultyBlocks: boolean;
  /**
   * The block at which this network leaves Bitcoin's chain (ecash-com/bitcoin's ecash_fork_height, a 2016-block
   * boundary): it carries the fixed bits `bits`; from it, a retarget every `interval` blocks (Bitcoin's 2016 if
   * absent) by eCash's dampened rule. Null: no fork (testnet is testnet4's chain).
   */
  fork: { height: number; bits: number; interval?: number } | null;
}

export const NETWORKS: Record<NetworkId, Network> = {
  // ecash-v1.1.0-core31.1 (src/kernel/chainparams.cpp): difficulty 2.6e9 at the fork, then 288-block retargets
  ecash: { id: 'ecash', name: 'Mainnet', bech32: 'bc', minDifficultyBlocks: false, fork: { height: 973728, bits: 0x1901a6e1, interval: 288 } },
  // difficulty 1e9 at the fork, then Bitcoin's retarget
  ecashbeta: { id: 'ecashbeta', name: 'Betanet', bech32: 'bc', minDifficultyBlocks: false, fork: { height: 967680, bits: 0x19044b7e } },
  ecashtest: { id: 'ecashtest', name: 'Testnet', bech32: 'tb', minDifficultyBlocks: true, fork: null },
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
