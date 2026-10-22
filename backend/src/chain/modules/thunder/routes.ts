import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { IndexAddress, IndexTx, IndexView, derived, txsOf } from '../l2-views';

/**
 * Thunder's feature route (chains/L2-API.md "richlist"): the top addresses by balance and payment statistics, from
 * the index. A payment's amount is what went to addresses other than the spenders' (change left out).
 *
 *   GET feature/richlist     the top 100 addresses, totals, payments by ranges of blocks, the largest payments
 */

const BUCKETS = 60;

export function buildRichlist(addresses: IndexAddress[], txs: IndexTx[], tip: number, timeAt: (h: number) => number | null = () => null): any {
  const held = addresses.filter(a => a.balance > 0);
  const total = held.reduce((s, a) => s + a.balance, 0);
  const top = [...held].sort((a, b) => b.balance - a.balance).slice(0, 100)
    .map(a => ({ ...a, share: total ? a.balance / total : null }));
  const size = Math.max(1, Math.ceil((tip + 1) / BUCKETS));
  // every range of `size` blocks, those without payments too
  const series: { from: number; to: number; time: number | null; txs: number; volume: number; fees: number }[] = [];
  for (let from = 0; from <= tip; from += size) {
    series.push({ from, to: Math.min(tip, from + size - 1), time: timeAt(Math.min(tip, from + size - 1)), txs: 0, volume: 0, fees: 0 });
  }
  const largest: { txid: string; height: number; time: number | null; amount: number; fee: number; inputs: number; outputs: number }[] = [];
  let volume = 0;
  let fees = 0;
  let count = 0;
  for (const t of txs) {
    const spenders = new Set(t.inputs.map(i => i.address));
    const amount = t.outputs.filter(o => !spenders.has(o.address)).reduce((s, o) => s + o.value, 0);
    const b = series[Math.floor(t.height / size)];
    if (!b) {
      continue;
    }
    b.txs++;
    b.volume += amount;
    b.fees += t.fee;
    volume += amount;
    fees += t.fee;
    count++;
    largest.push({ txid: t.txid, height: t.height, time: t.time, amount, fee: t.fee, inputs: t.inputs.length, outputs: t.outputs.length });
  }
  largest.sort((a, b) => b.amount - a.amount);
  return {
    items: top, addresses: addresses.length, funded: held.length, total,
    top10Share: total ? top.slice(0, 10).reduce((s, a) => s + a.balance, 0) / total : null,
    payments: { count, volume, fees, averageFee: count ? fees / count : null }, series, bucket: size,
    largest: largest.slice(0, 20),
  };
}

const view = derived<any>(index => {
  const addresses: IndexAddress[] = [];
  index.forEachAddress(a => addresses.push(a));
  return buildRichlist(addresses, txsOf(index), index.tipHeight(), h => index.timeAt(h));
});

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  const index = ctx.index as IndexView;
  app.get(prefix + 'richlist', ctx.handler(async (req, res) => {
    res.json({ ...view(index), height: index.tipHeight() });
  }));
}
