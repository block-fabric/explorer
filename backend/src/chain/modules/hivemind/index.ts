import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';
import { Reader, findMarkers, safeDecode, sha256d } from '../../marker';

/**
 * Hivemind: prediction markets (LMSR market makers) on decisions that votecoin holders resolve by sealed votes.
 *
 * Routes (/api/v1/sidechain/...):
 *   GET info                    gethivemindinfo (period, phase, counts, voter pot)
 *   GET markets, market/:id     listmarkets, getmarket
 *   GET decisions, decision/:id listdecisions, getdecision (with the votes)
 *   GET reputation              listreputation (votecoin holders)
 *   GET tx/:txid                the core's describeTx route: the actions of a transaction
 *
 * Marker: OP_RETURN DB 48 56 4D | kind u8 | fields; up to 16 actions per transaction, one per output
 * (hivemind/src/hivemind/state.h). A decision's or market's id is sha256d(txid | vout u32 LE).
 */

const TAG = 'db48564d';
const KINDS: Record<number, string> = {
  1: 'list-decision', 2: 'open-market', 3: 'buy-shares', 4: 'sell-shares', 5: 'transfer-reputation',
  6: 'seal-vote', 7: 'reveal-vote', 8: 'seal-ballot', 9: 'reveal-ballot',
};
const UNKNOWN_ANSWER = -9223372036854775808;

function account(r: Reader): string {
  return r.hex(20); // a P2WPKH program; the frontend shows it as an address
}

export function decodeHivemindAction(payload: Buffer): any {
  const r = new Reader(payload);
  const k = r.u8();
  const a: any = { kind: KINDS[k] ?? `kind ${k}` };
  switch (k) {
    case 1: a.author = account(r); a.eventPeriod = r.u32(); a.votePeriods = r.u16(); a.scaled = r.bool(); a.min = r.i64(); a.max = r.i64(); a.text = r.string(); break;
    case 2: a.author = account(r); a.decisions = r.vector(() => r.hash()); a.liquidity = r.i64(); a.feeBps = r.u16(); a.text = r.string(); break;
    case 3: a.market = r.hash(); a.account = account(r); a.state = r.u8(); a.shares = r.i64(); break;
    case 4: a.market = r.hash(); a.account = account(r); a.state = r.u8(); a.shares = r.i64(); a.minProceeds = r.i64(); break;
    case 5: a.from = account(r); a.to = account(r); a.amount = r.i64(); break;
    case 6: a.voter = account(r); a.decision = r.hash(); break; // the vote itself is sealed
    case 7: { a.voter = account(r); a.decision = r.hash(); const v = r.i64(); a.answer = v === UNKNOWN_ANSWER ? null : v; break; }
    case 8: a.voter = account(r); a.closePeriod = r.u32(); a.decisions = r.vector(() => r.hash()); break;
    case 9: a.voter = account(r); a.closePeriod = r.u32(); a.answers = r.vector(() => r.i64()).map(v => v === UNKNOWN_ANSWER ? null : v); break;
  }
  return a;
}

/** The id the node gives a decision or market listed by output `vout` of `txid` */
export function actionId(txid: string, vout: number): string {
  const b = Buffer.alloc(36);
  Buffer.from(txid, 'hex').reverse().copy(b, 0);
  b.writeUInt32LE(vout, 32);
  return sha256d(b).reverse().toString('hex');
}

const hivemind: ChainModule = {
  profile: sidechainProfile('hivemind', 'Hivemind', 9, 'hm'),

  initRoutes(app, prefix, ctx) {
    const simple = (path: string, rpc: string) => app.get(prefix + path, ctx.handler(async (req, res) => {
      res.json(await ctx.cached(path, 5000, () => ctx.node.call(rpc)));
    }));
    simple('info', 'gethivemindinfo');
    simple('markets', 'listmarkets');
    simple('decisions', 'listdecisions');
    simple('reputation', 'listreputation');
    for (const [path, rpc] of [['market', 'getmarket'], ['decision', 'getdecision']]) {
      app.get(prefix + path + '/:id', ctx.handler(async (req, res) => {
        const id = String(req.params.id);
        if (!/^[0-9a-f]{64}$/.test(id)) {
          return ctx.fail(req, res, 400, 'Invalid id');
        }
        try {
          res.json(await ctx.node.call(rpc, id));
        } catch (e) {
          ctx.fail(req, res, 404, `Unknown ${path} (settled entries are pruned after 30 periods)`);
        }
      }));
    }
  },

  async describeTx(tx: any, ctx: ChainModuleContext) {
    const markers = findMarkers(tx, TAG);
    if (!markers.length) {
      return null;
    }
    const ops = await Promise.all(markers.map(async (m) => {
      const a: any = safeDecode(() => decodeHivemindAction(m.payload));
      a.vout = m.vout;
      a.value = m.value; // listing fee, market funding or the most a buyer pays
      if (a.kind === 'list-decision' || a.kind === 'open-market') {
        a.id = actionId(tx.txid, m.vout);
      }
      const marketId = a.kind === 'open-market' ? a.id : a.market;
      if (marketId) {
        const mk = await ctx.node.call('getmarket', marketId).catch(() => null);
        if (mk) { a.marketText = mk.text; a.stateAnswers = mk.states?.find((s: any) => s.state === a.state)?.answers; }
      }
      const decisionId = a.kind === 'list-decision' ? a.id : a.decision;
      if (decisionId) {
        a.decisionText = (await ctx.node.call('getdecision', decisionId).catch(() => null))?.text;
      }
      return a;
    }));
    return { chain: 'hivemind', ops };
  },
};

export default hivemind;
