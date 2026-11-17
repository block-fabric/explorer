import { ChainModule } from '../../module';
import { isXOnlyKey } from '../../bip340';
import { thunderContent } from '../thunder';
import { featureRoutes } from './routes';

/**
 * Sidepot (slot 88), a last-buyer-wins key game: a fork of Thunder (Coinelius/sidepot-node, Thunder base 0.18.6)
 * with the game's state in consensus. Its blocks, txs and coins are Thunder's (txids blake3(canonical_bytes), no
 * per-block deposits, no mempool listing); besides:
 * - a deposit addressed `spot:<game account key>` credits that game account and makes no coin
 *   (sidepot-core entry.rs deposit_player: 64 hex characters of an x-only key, any case);
 * - a block's coinbase pays exactly the cashouts of the eCash blocks it processes;
 * - the game (pot, key price, round, deadline, accounts) is the node's game_state / game_account; its moves are
 *   signed entries in eCash OP_RETURN outputs, which the eCash explorer lists (chain/sidepot-moves.ts).
 */

export function gameAccountOf(text: string): string | null {
  const key = text.startsWith('spot:') ? text.slice(5) : '';
  return isXOnlyKey(key) ? key.toLowerCase() : null;
}

const sidepot: ChainModule = {
  profile: { id: 'sidepot', kind: 'l2', name: 'Sidepot', unit: 'sats', slot: 88, mainchain: false, subsidy: false },
  l2: {
    txids: 'canonical', blockIndex: false, inputPairs: true, withdrawalBundleRpc: true, mempool: false, fill: false,
    depositRule: 'bare', features: ['richlist', 'game'],
    gameDeposit: gameAccountOf,
    content: thunderContent,
    featureRoutes(app, prefix, ctx) {
      featureRoutes(app, prefix, ctx);
    },
  },
};

export default sidepot;
