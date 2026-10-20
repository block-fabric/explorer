import { Application } from 'express';
import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';
import { Reader, findMarkers, safeDecode } from '../../marker';
import { getFeeLedger } from './fees';

/**
 * FastBlocks: blocks of stake every 15 seconds from a bonded validator set, anchored and finalized by blind merged
 * mining on Chains, with BMM blocks as a fallback.
 *
 * Routes (/api/v1/sidechain/...):
 *   GET info, pos            getposinfo (slot, epoch, leader, anchors, staking totals, pot); Layers serves it as pos only
 *   GET validators?epoch=    getvalidators
 *   GET validator/:pubkey    getvalidator (stake, bond, unbonds, offences)
 *   GET schedule             getleaderschedule
 *   GET anchors              getanchorinfo
 *   GET evidence             listevidence (double proposals)
 *   GET block/:hash/features the core's describeBlock route: kind (pos/bmm), slot, proposer, ack, finality
 *   GET tx/:txid             the core's describeTx route: bonds and unbonds
 *
 * Markers (fastblocks/src/pos/bond.h): BOND DB 53 54 4B | pubkey 32 | owner 20 | pop 64 [| owner sig 65], the bonded
 * amount is the output's value; UNBOND DC 55 4E 42 | pubkey 32 | amount i64 (0 = all) | sequence u32 | sig 65.
 * Keys print in wire order (HexStr), not reversed.
 */

const BOND = 'db53544b';
const UNBOND = 'dc554e42';

/** FastBlocks' routes (proof of stake), reused by Layers */
export function fastblocksRoutes(app: Application, prefix: string, ctx: ChainModuleContext): void {
  const simple = (path: string, rpc: string, ttl = 3000) => app.get(prefix + path, ctx.handler(async (req, res) => {
    res.json(await ctx.cached(path, ttl, () => ctx.node.call(rpc)));
  }));
  simple('info', 'getposinfo');
  simple('pos', 'getposinfo'); // the same under a name of its own: Layers' 'info' is BitAssets'
  simple('schedule', 'getleaderschedule');
  simple('anchors', 'getanchorinfo');
  simple('evidence', 'listevidence', 10000);
  /**
   * GET fees?window=   the fee flows (fees.ts): peg and ordinary fees, the bidder's and the validators' shares as each
   * block paid them, the pot and its payouts at anchors, the pool shares per validator, the split curve now
   */
  app.get(prefix + 'fees', ctx.handler(async (req, res) => {
    const L = getFeeLedger();
    if (!L.isReady()) { return ctx.fail(req, res, 503, 'The fee ledger is still being built'); }
    const window = ctx.intParam(req.query.window, 0, 0, 1e7) as number;
    const [info, vals] = await Promise.all([
      ctx.cached('info-pos', 3000, () => ctx.node.call('getposinfo')),
      ctx.cached('validators', 3000, () => ctx.node.call('getvalidators')),
    ]);
    const owners = await Promise.all(((vals as any)?.validators ?? []).map((v: any) =>
      ctx.cached('owner:' + v.pubkey, 60000, () => ctx.node.call('getvalidator', v.pubkey)).catch(() => null)
        .then((d: any) => ({ pubkey: v.pubkey, stake: v.stake, slots: v.slots, owner: d?.bond?.owner ?? null }))));
    res.json(L.summary(window, info, owners));
  }));

  app.get(prefix + 'validators', ctx.handler(async (req, res) => {
    const epoch = ctx.intParam(req.query.epoch, null, 0, 1e9);
    res.json(await ctx.cached('validators:' + epoch, 3000, () => epoch === null ? ctx.node.call('getvalidators') : ctx.node.call('getvalidators', epoch)));
  }));
  app.get(prefix + 'validator/:pubkey', ctx.handler(async (req, res) => {
    const key = String(req.params.pubkey);
    if (!/^[0-9a-f]{64}$/.test(key)) {
      return ctx.fail(req, res, 400, 'Invalid public key');
    }
    try {
      res.json(await ctx.node.call('getvalidator', key));
    } catch (e) {
      ctx.fail(req, res, 404, 'Unknown validator');
    }
  }));
}

/** The PoS fields of a block (kind, slot, proposer, ack, finality), reused by Layers */
export async function fastblocksDescribeBlock(block: any): Promise<any> {
  // getblock (verbosity 1) carries the PoS fields (src/rpc/pos.cpp PushPosBlockInfo)
  const { kind, slot, proposer, ack, evidence, finality, mainheight } = block;
  return { chain: 'fastblocks', kind, slot, proposer, ack, evidence, finality, mainheight };
}

/** Bonds and unbonds in a transaction (null if none), reused by Layers */
export async function fastblocksDescribeTx(tx: any, ctx: ChainModuleContext): Promise<any | null> {
  const ops: any[] = [];
  for (const m of findMarkers(tx, BOND)) {
    ops.push({ kind: 'bond', vout: m.vout, amount: m.value, ...safeDecode(() => {
      const r = new Reader(m.payload);
      return { pubkey: r.hex(32), owner: r.hex(20) };
    }) });
  }
  for (const m of findMarkers(tx, UNBOND)) {
    ops.push({ kind: 'unbond', vout: m.vout, ...safeDecode(() => {
      const r = new Reader(m.payload);
      const pubkey = r.hex(32);
      const amount = r.i64();
      return { pubkey, amount: amount === 0 ? 'all' : amount, sequence: r.u32() };
    }) });
  }
  return ops.length ? { chain: 'fastblocks', ops } : null;
}

const fastblocks: ChainModule = {
  profile: sidechainProfile('fastblocks', 'FastBlocks', 5, 'fbl'),
  initRoutes: fastblocksRoutes,
  start: (ctx) => getFeeLedger().start(ctx),
  onNewBlock: () => getFeeLedger().onNewBlock(),
  describeBlock: fastblocksDescribeBlock,
  describeTx: fastblocksDescribeTx,
};

export default fastblocks;
