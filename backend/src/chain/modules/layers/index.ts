import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';
import { findMarkers } from '../../marker';
import { bitassetsDescribeTx, bitassetsRoutes, ledgerRoutes } from '../bitassets';
import { getLedger } from '../bitassets/ledger';
import { fastblocksDescribeBlock, fastblocksDescribeTx, fastblocksRoutes } from '../fastblocks';

/**
 * Layers: BitAssets' assets, exchange pools and Dutch auctions on FastBlocks' chain of stake (15-second blocks from
 * bonded validators, finalized by blind merged mining on Chains), with a fee split: the BMM bidder takes 10-50 % of
 * ordinary fees depending on the mainchain's block spacing, the validators the rest, paid out of a pool per epoch.
 *
 * A module made of two others: the routes and decoders of modules/bitassets and modules/fastblocks, and
 *   GET feesplit   the fee split now (getposinfo.feesplit): bidder and validator shares, the pool per epoch
 *
 * Its own markers (layers/src/pos/feesplit.h): POOL "\xDE" "VPL" (a coinbase output into the validator pool) and
 * POOL_SHARES "\xDE" "VPS" | count u32 (before the validators' shares a peg step pays).
 */

const POOL = 'de56504c';
const POOL_SHARES = 'de565053';

const layers: ChainModule = {
  profile: sidechainProfile('layers', 'Layers', 7, 'ly'),

  initRoutes(app, prefix, ctx) {
    bitassetsRoutes(app, prefix, ctx);
    ledgerRoutes(app, prefix, ctx);
    fastblocksRoutes(app, prefix, ctx);
    app.get(prefix + 'feesplit', ctx.handler(async (req, res) => {
      const info = await ctx.cached('info-pos', 3000, () => ctx.node.call('getposinfo'));
      res.json(info?.feesplit ?? null);
    }));
  },

  describeBlock: fastblocksDescribeBlock,
  start: (ctx) => getLedger().start(ctx),
  onNewBlock: () => getLedger().onNewBlock(),

  async describeTx(tx: any, ctx: ChainModuleContext) {
    const [assets, stake] = await Promise.all([bitassetsDescribeTx(tx, ctx), fastblocksDescribeTx(tx, ctx)]);
    const ops: any[] = [...(assets?.ops ?? []), ...(stake?.ops ?? [])];
    for (const m of findMarkers(tx, POOL)) {
      ops.push({ kind: 'validator-pool', vout: m.vout, amount: m.value });
    }
    for (const m of findMarkers(tx, POOL_SHARES)) {
      ops.push({ kind: 'validator-pool-shares', vout: m.vout, shares: m.payload.length >= 4 ? m.payload.readUInt32LE(0) : null });
    }
    return ops.length ? { chain: 'layers', ops, assets: assets?.assets, results: assets?.results, outputs: assets?.outputs } : null;
  },
};

export default layers;
