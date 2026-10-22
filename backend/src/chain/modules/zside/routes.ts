import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { IndexTx, IndexView, derived, txsOf } from '../l2-views';

/**
 * zSide's feature route (chains/L2-API.md "shielded"): the Orchard pool from the index. Every tx with an Orchard
 * bundle moves value_balance sats out of the pool (into it when negative); each action reveals one nullifier and
 * adds one note commitment (padding actions included, so these count actions, not payments).
 *
 *   GET feature/shielded     totals, the pool over the blocks with shielded activity, the latest shielded txs
 */

export interface ShieldedBlock {
  height: number;
  time: number | null;
  txs: number;
  actions: number;
  shieldedIn: number;
  shieldedOut: number;
  /** sats in the pool after this block */
  pool: number;
}

export function buildShielded(txs: IndexTx[]): any {
  const totals = { txs: 0, actions: 0, shieldedIn: 0, shieldedOut: 0, valueBalance: 0, nullifiers: 0, commitments: 0, pool: 0, blocks: 0 };
  const blocks: ShieldedBlock[] = [];
  const recent: any[] = [];
  for (const t of txs) {
    const s = t.shielded;
    if (!s) {
      continue;
    }
    let b = blocks[blocks.length - 1];
    if (!b || b.height !== t.height) {
      b = { height: t.height, time: t.time, txs: 0, actions: 0, shieldedIn: 0, shieldedOut: 0, pool: totals.pool };
      blocks.push(b);
    }
    const vb = Number(s.valueBalance) || 0;
    b.txs++;
    b.actions += s.actions;
    if (vb < 0) {
      b.shieldedIn -= vb;
      totals.shieldedIn -= vb;
    } else {
      b.shieldedOut += vb;
      totals.shieldedOut += vb;
    }
    totals.pool -= vb;
    b.pool = totals.pool;
    totals.txs++;
    totals.actions += s.actions;
    totals.valueBalance += vb;
    recent.push({
      txid: t.txid, height: t.height, time: t.time, actions: s.actions, valueBalance: vb, flags: s.flags,
      transparentIn: t.inputs.length, transparentOut: t.outputs.length, fee: t.fee,
      // a fully shielded tx pays its fee out of the pool: value_balance > 0 with no transparent output
      kind: vb < 0 ? 'shield' : vb > 0 && t.outputs.length ? 'unshield' : 'shielded',
    });
  }
  totals.nullifiers = totals.actions;
  totals.commitments = totals.actions;
  totals.blocks = blocks.length;
  return { ...totals, series: blocks, recent: recent.reverse().slice(0, 50) };
}

const view = derived<any>(index => buildShielded(txsOf(index)));

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  const index = ctx.index as IndexView;
  app.get(prefix + 'shielded', ctx.handler(async (req, res) => {
    res.json({ ...view(index), height: index.tipHeight() });
  }));
}
