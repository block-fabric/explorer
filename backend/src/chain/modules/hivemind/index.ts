import { ChainModule } from '../../module';
import { Content } from '../../l2/types';
import { hex, tagged, withdrawalContent } from '../../l2/codec';

/**
 * Hivemind (Truthcoin, slot 13): prediction markets and votes, served by backbone-hivemind. Txids, deposits and
 * bundle spends from get_block_index; list_mempool. Its state also moves sats without a tx (market funds and
 * payouts, OutPoint MarketFunds / Payout, and consumes tx outputs into them): those the index follows with
 * list_utxos (stateUtxos), and a tx spending them takes its fee from get_transaction_info. Content:
 * {"Value": n} | {"Withdrawal": {value_sats, main_fee_sats, main_address}} | {"MarketFunds": {market_id, amount,
 * is_fee}} (sats). Deposit text: s13_<b58>_<6 hex> (the full checksum, any case) or bare. Keys ba-svk1….
 */

export function hivemindContent(raw: any): Content {
  const [k, v] = tagged(raw);
  switch (k) {
    case 'Value':
      return { type: 'value', value: Number(v), raw };
    case 'Withdrawal':
      return withdrawalContent(raw, v);
    case 'MarketFunds': {
      const id = Array.isArray(v.market_id) ? hex(Uint8Array.from(v.market_id)) : String(v.market_id);
      return { type: 'marketFunds', value: Number(v.amount), amount: Number(v.amount), name: id, raw };
    }
    default:
      return { type: 'other', raw };
  }
}

const hivemind: ChainModule = {
  profile: { id: 'hivemind', kind: 'l2', name: 'Hivemind', unit: 'sats', slot: 13, mainchain: false, subsidy: false },
  l2: {
    txids: 'index', blockIndex: true, inputPairs: true, withdrawalBundleRpc: true, mempool: true, txInfo: true, fill: false,
    depositRule: 'checksum', stateUtxos: true, features: ['markets'],
    content: hivemindContent,
    featureRoutes(app, prefix, ctx) {
      ctx.list('markets', 'market_list');
      ctx.item('markets', 'market_get', /^[0-9a-f]{12}$/);
      app.get(prefix + 'votes', ctx.handler(async (req, res) => {
        res.json(await ctx.cached('votes', 5000, () => ctx.rpc.call('vote_period')));
      }));
    },
  },
};

export default hivemind;
