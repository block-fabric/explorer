import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { isAddress } from '../../l2/codec';
import { IndexTx, IndexView, derived, hexOf, notFound, txsOf } from '../l2-views';

/**
 * Truthcoin's feature routes (chains/L2-API.md "markets"): the node's public market and oracle reads (market_list,
 * market_get, market_price_history, decision_status, decision_list, decision_get, vote_period, vote_list,
 * vote_voters, list_open_periods_with_pricing) joined with the index's CreateMarket and Trade txs.
 *
 *   GET feature/markets             every market, with its trades in the index
 *   GET feature/markets/:id         one market (12 hex): outcomes and prices, price history, trades
 *   GET feature/decisions           the oracle's decisions past "Created" (claimed, voting, resolved), counts by state
 *   GET feature/decisions/:id       one decision (6 hex): its votes and the markets that use it
 *   GET feature/votes               the current voting period, the voters (Votecoin holders), slot pricing
 *   GET address/:address/positions  an address's shares (market_positions) valued at the markets' prices, and its
 *                                   Votecoin (votecoin_balance)
 */

export interface Trade {
  txid: string;
  height: number;
  time: number | null;
  marketId: string;
  outcome: number;
  /** shares bought (negative: sold) */
  shares: number;
  trader: string | null;
  limitSats: number;
  /** sats the tx's inputs held */
  input: number;
  /** sats into the market (negative: a sell's proceeds); null when an input could not be valued */
  cost: number | null;
  /** false: the block skipped it (over its limit) */
  applied: boolean;
  fee: number;
}

export interface MarketsView {
  trades: Map<string, Trade[]>;
  created: { title: string; height: number; time: number | null; txid: string; creator: string | null }[];
  votes: { txid: string; height: number; time: number | null; type: string; voter: string | null }[];
}

const marketIdOf = (v: any): string => Array.isArray(v) ? hexOf(v) : String(v ?? '');

export function buildMarkets(txs: IndexTx[]): MarketsView {
  const trades = new Map<string, Trade[]>();
  const created: MarketsView['created'] = [];
  const votes: MarketsView['votes'] = [];
  for (const t of txs) {
    const d = t.data;
    if (d?.type === 'Trade') {
      const id = marketIdOf(d.market_id);
      trades.set(id, [...(trades.get(id) ?? []), {
        txid: t.txid, height: t.height, time: t.time, marketId: id, outcome: Number(d.outcome_index ?? 0), shares: Number(d.shares ?? 0),
        trader: d.trader ?? null, limitSats: Number(d.limit_sats ?? 0), input: t.inputs.reduce((s, i) => s + (i.value ?? 0), 0),
        cost: t.market ? t.market.cost : null, applied: t.market ? t.market.applied !== false : true, fee: t.fee,
      }]);
    } else if (d?.type === 'CreateMarket') {
      created.push({ title: String(d.title ?? ''), height: t.height, time: t.time, txid: t.txid, creator: t.signers[0] ?? null });
    } else if (d?.type === 'SubmitVote' || d?.type === 'SubmitBallot') {
      votes.push({ txid: t.txid, height: t.height, time: t.time, type: d.type, voter: d.voter ?? t.signers[0] ?? null });
    }
  }
  return { trades, created, votes };
}

const view = derived<MarketsView>(index => buildMarkets(txsOf(index)));

function marketExtra(v: MarketsView, m: any): any {
  const trades = v.trades.get(m.market_id) ?? [];
  const last = trades[trades.length - 1];
  const c = v.created.find(x => x.title === m.title && x.height === Number(m.created_at_height)) ?? v.created.find(x => x.title === m.title);
  return {
    trades: trades.length,
    lastTrade: last ? { height: last.height, time: last.time, txid: last.txid } : null,
    created: c ? { height: c.height, time: c.time, txid: c.txid } : null,
  };
}

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  const index = ctx.index as IndexView;
  const markets = () => ctx.cached('market_list', 5000, () => ctx.rpc.call<any[]>('market_list'));
  const market = (id: string) => ctx.cached('market:' + id, 5000, () => ctx.rpc.call('market_get', id));
  const status = () => ctx.cached('decision_status', 10000, () => ctx.rpc.call('decision_status'));
  // every decision slot of the open periods (thousands, nearly all unclaimed): fetched once a minute at most
  const decisions = () => ctx.cached('decision_list', 60000, () => ctx.rpc.call<any[]>('decision_list', null));
  /** decision id -> the markets whose dimensions use it */
  const usedBy = () => ctx.cached('decision_markets', 30000, async () => {
    const out = new Map<string, { market_id: string; title: string }[]>();
    for (const m of await markets() ?? []) {
      const full = await market(m.market_id).catch(() => null);
      for (const dim of full?.dimensions ?? []) {
        if (dim?.decision_id) {
          out.set(dim.decision_id, [...(out.get(dim.decision_id) ?? []), { market_id: m.market_id, title: m.title }]);
        }
      }
    }
    return out;
  });

  app.get(ctx.root + 'address/:address/positions', ctx.handler(async (req, res) => {
    const a = String(req.params.address);
    if (!isAddress(a)) {
      return ctx.fail(req, res, 400, 'Invalid address');
    }
    const [p, votecoin, list] = await Promise.all([
      ctx.cached('positions:' + a, 5000, () => ctx.rpc.call('market_positions', a, null)),
      ctx.cached('votecoin:' + a, 5000, () => ctx.rpc.call<number>('votecoin_balance', a)),
      markets(),
    ]);
    const titles = new Map<string, string>((list ?? []).map(m => [m.market_id, m.title]));
    const positions = (p?.positions ?? []).map((x: any) => ({
      marketId: String(x.market_id), title: titles.get(x.market_id) ?? null, outcome: Number(x.outcome_index), outcomeName: x.outcome_name ?? null,
      shares: Number(x.shares), price: typeof x.current_price === 'number' ? x.current_price : null,
      value: typeof x.current_value === 'number' ? Math.floor(x.current_value) : null,
    }));
    res.json({
      address: a, positions, value: positions.reduce((s: number, x: any) => s + (x.value ?? 0), 0), votecoin: Number(votecoin ?? 0),
      height: index.tipHeight(),
    });
  }));

  app.get(prefix + 'markets', ctx.handler(async (req, res) => {
    const v = view(index);
    res.json({ items: (await markets() ?? []).map(m => ({ ...m, ...marketExtra(v, m) })) });
  }));

  app.get(prefix + 'markets/:id', ctx.handler(async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!/^[0-9a-f]{12}$/.test(id)) {
      return ctx.fail(req, res, 400, 'Invalid market id');
    }
    // only ids the node lists reach market_get (ids come from the request)
    if (!(await markets() ?? []).some(m => m.market_id === id)) {
      return notFound(index, res, () => ctx.fail(req, res, 404, 'Unknown market'));
    }
    const v = view(index);
    const [m, history] = await Promise.all([
      market(id),
      ctx.cached('market_price_history:' + id, 10000, () => ctx.rpc.call<any[]>('market_price_history', id).catch(() => [])),
    ]);
    if (!m) {
      return ctx.fail(req, res, 404, 'Unknown market');
    }
    res.json({ ...m, ...marketExtra(v, m), priceHistory: history ?? [], tradeList: [...(v.trades.get(id) ?? [])].reverse() });
  }));

  app.get(prefix + 'decisions', ctx.handler(async (req, res) => {
    const [s, all, used] = await Promise.all([status(), decisions(), usedBy()]);
    const counts: Record<string, number> = {};
    for (const d of all ?? []) {
      counts[d.state] = (counts[d.state] ?? 0) + 1;
    }
    const items = (all ?? []).filter(d => d.state !== 'Created').map(d => ({ ...d, markets: used.get(d.decision_id_hex) ?? [] }));
    res.json({ status: s, counts, items });
  }));

  app.get(prefix + 'decisions/:id', ctx.handler(async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(id)) {
      return ctx.fail(req, res, 400, 'Invalid decision id');
    }
    const listed = (await decisions() ?? []).find(d => d.decision_id_hex === id);
    if (!listed) {
      return ctx.fail(req, res, 404, 'Unknown decision');
    }
    const [d, votes, used] = await Promise.all([
      ctx.cached('decision:' + id, 10000, () => ctx.rpc.call('decision_get', id).catch(() => null)),
      ctx.cached('decision_votes:' + id, 10000, () => ctx.rpc.call<any[]>('vote_list', { decision_id: id }).catch(() => [])),
      usedBy(),
    ]);
    res.json({ ...listed, entry: d, votes: votes ?? [], markets: used.get(id) ?? [] });
  }));

  app.get(prefix + 'votes', ctx.handler(async (req, res) => {
    const s = await status();
    const current = Number(s?.current_period ?? 0);
    const [period, voters, pricing] = await Promise.all([
      ctx.cached('vote_period:' + current, 10000, () => ctx.rpc.call('vote_period', current).catch(() => null)),
      ctx.cached('vote_voters', 10000, () => ctx.rpc.call<any[]>('vote_voters').catch(() => [])),
      ctx.cached('periods_pricing', 30000, () => ctx.rpc.call<any[]>('list_open_periods_with_pricing').catch(() => [])),
    ]);
    const v = view(index);
    res.json({
      status: s, period,
      voters: [...(voters ?? [])].sort((a, b) => Number(b.votecoin_balance) - Number(a.votecoin_balance)),
      periods: pricing ?? [],
      voteTxs: [...v.votes].reverse().slice(0, 100),
    });
  }));
}
