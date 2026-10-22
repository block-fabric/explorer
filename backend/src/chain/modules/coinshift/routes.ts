import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { HASH, IndexTx, IndexUtxo, IndexView, derived, hexOf, notFound, txsOf, utxosOf } from '../l2-views';

/**
 * Coinshift's feature routes (chains/L2-API.md "swaps"): the node's list_swaps / get_swap_status joined with the
 * index's SwapCreate, SwapAccept and SwapClaim txs and the sats held for each swap (SwapPending outputs). A swap's
 * state is partly node-local by Coinshift's design (what this node has seen of the L1 payment): every reply says so.
 *
 *   GET feature/swaps        every swap the node knows, with its txs in the index
 *   GET feature/swaps/:id    one swap (64 hex): the node's status, its txs, the sats it holds
 */

export const NODE_LOCAL = 'Swap state is partly node-local (Coinshift design): the L1 side is what this node has seen';

const isBytes = (v: any): boolean => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'number' && x >= 0 && x <= 255);

/** The node's JSON with its byte arrays (ids, txids) as hex, also inside tagged values ({"Hash32": [...]}) */
export function bytesToHex(v: any): any {
  if (isBytes(v)) {
    return hexOf(v);
  }
  if (Array.isArray(v)) {
    return v.map(bytesToHex);
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bytesToHex(x)]));
  }
  return v;
}

/** A swap as the explorer shows it: hex ids, the L1 txid flat (null while the node has seen none) */
export function swapView(s: any): any {
  const v = bytesToHex(s);
  if (v && typeof v === 'object' && v.l1_txid && typeof v.l1_txid === 'object') {
    const inner = Object.values(v.l1_txid)[0];
    v.l1_txid = typeof inner === 'string' && !/^0+$/.test(inner) ? inner : null;
  }
  return v;
}

export interface SwapTx {
  kind: 'create' | 'accept' | 'claim';
  txid: string;
  height: number;
  time: number | null;
  data: any;
}

export interface SwapsView {
  txs: Map<string, SwapTx[]>;
  locked: Map<string, { amount: number; outputs: number }>;
}

const KINDS: Record<string, SwapTx['kind']> = { SwapCreate: 'create', SwapAccept: 'accept', SwapClaim: 'claim' };

export function buildSwaps(txs: IndexTx[], utxos: IndexUtxo[]): SwapsView {
  const out = new Map<string, SwapTx[]>();
  for (const t of txs) {
    const kind = KINDS[t.data?.type];
    const id = t.data?.swap_id;
    if (kind && typeof id === 'string') {
      out.set(id, [...(out.get(id) ?? []), { kind, txid: t.txid, height: t.height, time: t.time, data: t.data }]);
    }
  }
  const locked = new Map<string, { amount: number; outputs: number }>();
  for (const u of utxos) {
    const id = u.content.swapId;
    if (u.content.type === 'swapPending' && id) {
      const l = locked.get(id) ?? { amount: 0, outputs: 0 };
      l.amount += u.value;
      l.outputs++;
      locked.set(id, l);
    }
  }
  return { txs: out, locked };
}

const view = derived<SwapsView>(index => buildSwaps(txsOf(index), utxosOf(index)));

function swapItem(v: SwapsView, s: any): any {
  const sw = swapView(s);
  const txs = v.txs.get(sw?.id) ?? [];
  return { ...sw, txs: txs.map(t => ({ kind: t.kind, txid: t.txid, height: t.height, time: t.time })), locked: v.locked.get(sw?.id) ?? null };
}

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  const index = ctx.index as IndexView;
  const swaps = () => ctx.cached('swaps', 5000, () => ctx.rpc.call<any[]>('list_swaps'));

  app.get(prefix + 'swaps', ctx.handler(async (req, res) => {
    const v = view(index);
    res.json({ items: (await swaps() ?? []).map(s => swapItem(v, s)), nodeLocal: true, note: NODE_LOCAL });
  }));

  app.get(prefix + 'swaps/:id', ctx.handler(async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!HASH.test(id)) {
      return ctx.fail(req, res, 400, 'Invalid swap id');
    }
    const v = view(index);
    // only ids the node lists or the index has seen reach get_swap_status (ids come from the request)
    const listed = (await swaps() ?? []).some(s => swapView(s)?.id === id);
    if (!listed && !v.txs.has(id)) {
      return notFound(index, res, () => ctx.fail(req, res, 404, 'Unknown swap'));
    }
    const s = await ctx.cached('swap:' + id, 5000, () => ctx.rpc.call('get_swap_status', [...Buffer.from(id, 'hex')]).catch(() => null));
    const txs = v.txs.get(id) ?? [];
    res.json({
      ...(s ? swapItem(v, s) : { id, txs: txs.map(t => ({ kind: t.kind, txid: t.txid, height: t.height, time: t.time })), locked: v.locked.get(id) ?? null }),
      known: !!s, txData: txs.map(t => ({ kind: t.kind, txid: t.txid, data: t.data })), nodeLocal: true, note: NODE_LOCAL,
    });
  }));
}
