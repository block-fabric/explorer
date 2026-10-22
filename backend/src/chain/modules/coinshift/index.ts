import { ChainModule } from '../../module';
import { Content } from '../../l2/types';
import { hex, liftData, tagged, withdrawalContent } from '../../l2/codec';

/**
 * Coinshift (slot 255): swaps between the sidechain and other chains, served by backbone-coinshift. Shaped like
 * BitNames: txids (blake3(borsh(tx)), types.cpp:261) and deposits from get_block_index, list_mempool; hex keys.
 * Coinbase outputs are spent as {"Coinbase": {merkle_root, vout}}. Content: {"Value": n} | {"Withdrawal": {value,
 * main_fee, main_address}} | {"SwapPending": {value, swap_id}} (sats held for a swap); TxData: "Regular" |
 * SwapCreate | SwapClaim | SwapAccept. Swap ids are JSON arrays of 32 numbers: shown as hex. Deposit text:
 * s255_<b58>_<checksum prefix> or bare. A swap's state is partly node-local by Coinshift's design (the L1 side
 * is what this node has seen): the swaps feature says so.
 */

const bytesHex = (v: any): any => Array.isArray(v) && v.every(x => typeof x === 'number') ? hex(Uint8Array.from(v)) : v;

export function coinshiftContent(raw: any): Content {
  const [k, v] = tagged(raw);
  switch (k) {
    case 'Value':
      return { type: 'value', value: Number(v), raw };
    case 'Withdrawal':
      return withdrawalContent(raw, v);
    case 'SwapPending':
      return { type: 'swapPending', value: Number(v.value), swapId: bytesHex(v.swap_id), raw };
    default:
      return { type: 'other', raw };
  }
}

/** TxData with its byte arrays (swap_id, l1_txid_bytes, proof_data) as hex */
export function coinshiftData(raw: any): any {
  const d = liftData(raw);
  if (!d) {
    return null;
  }
  for (const k of Object.keys(d)) {
    d[k] = bytesHex(d[k]);
  }
  return d;
}

const NODE_LOCAL = 'Swap state is partly node-local (Coinshift design): the L1 side is what this node has seen';

/** A swap as the node gives it, its id and byte arrays as hex */
const swapView = (s: any): any => s && typeof s === 'object' && !Array.isArray(s)
  ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, bytesHex(v)]))
  : bytesHex(s);

const coinshift: ChainModule = {
  profile: { id: 'coinshift', kind: 'l2', name: 'Coinshift', unit: 'sats', slot: 255, mainchain: false, subsidy: false },
  l2: {
    txids: 'index', blockIndex: true, inputPairs: true, withdrawalBundleRpc: false, mempool: true, txInfo: false, fill: false,
    depositRule: 'prefix', coinbaseOutPoint: 'merkleRoot', features: ['swaps'],
    content: coinshiftContent,
    data: coinshiftData,
    featureRoutes(app, prefix, ctx) {
      app.get(prefix + 'swaps', ctx.handler(async (req, res) => {
        const items = await ctx.cached('swaps', 5000, () => ctx.rpc.call<any[]>('list_swaps'));
        res.json({ items: (items ?? []).map(swapView), nodeLocal: true, note: NODE_LOCAL });
      }));
      app.get(prefix + 'swaps/:id', ctx.handler(async (req, res) => {
        const id = String(req.params.id);
        if (!/^[0-9a-f]{64}$/.test(id)) {
          return ctx.fail(req, res, 400, 'Invalid swap id');
        }
        const s = await ctx.cached('swap:' + id, 5000, () => ctx.rpc.call('get_swap_status', [...Buffer.from(id, 'hex')]).catch(() => null));
        if (!s) {
          return ctx.fail(req, res, 404, 'Unknown swap');
        }
        res.json({ ...swapView(s), nodeLocal: true, note: NODE_LOCAL });
      }));
    },
  },
};

export default coinshift;
