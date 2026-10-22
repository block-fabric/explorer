import { ChainModule } from '../../module';
import { thunderContent } from '../thunder';

/**
 * zSide (thunder-orchard, slot 98): Thunder with a shielded Orchard pool, served by backbone-zside. As Thunder
 * (deposits from the enforcer's peg data, bare base58 text; no mempool listing), except the txid:
 * blake3(inputs ‖ outputs ‖ Option<bundle without auth>), cut out of canonical_bytes (l2/codec.ts zsideTxid). A
 * tx's Orchard bundle moves value_balance sats out of the pool (into it when negative): it counts in the fee.
 */
const zside: ChainModule = {
  profile: { id: 'zside', kind: 'l2', name: 'zSide', unit: 'sats', slot: 98, mainchain: false, subsidy: false },
  l2: {
    txids: 'zside', blockIndex: false, inputPairs: true, withdrawalBundleRpc: true, mempool: false, txInfo: false, fill: false,
    depositRule: 'bare', features: ['shielded'],
    content: thunderContent,
    shielded: tx => tx.orchard_bundle
      ? { actions: tx.orchard_bundle.actions?.length ?? 0, valueBalance: Number(tx.orchard_bundle.balance ?? 0), flags: Number(tx.orchard_bundle.flags ?? 0) }
      : null,
    featureRoutes(app, prefix, ctx) {
      // totals over the index: sats shielded (into the pool) and unshielded, actions, the value balance sum
      app.get(prefix + 'shielded', ctx.handler(async (req, res) => { res.json(ctx.index.shielded()); }));
    },
  },
};

export default zside;
