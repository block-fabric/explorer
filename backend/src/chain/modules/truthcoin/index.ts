import { blake3 } from '@noble/hashes/blake3';
import { ChainModule } from '../../module';
import { Content, L2MarketRules, MarketTerms } from '../../l2/types';
import { decodeAddress, hex, tagged, unhex, withdrawalContent } from '../../l2/codec';
import { featureRoutes } from './routes';

/**
 * Truthcoin (slot 13; its node is backbone-hivemind, a C++ clone of LayerTwo's Hivemind): prediction markets and
 * oracle votes. Txids, deposits and bundle spends from get_block_index; list_mempool. Content: {"Value": n} |
 * {"Withdrawal": {value_sats, main_fee_sats, main_address}} | {"MarketFunds": {market_id, amount, is_fee}} (sats).
 * Deposit text: s13_<b58>_<6 hex> (the full checksum, any case) or bare. Keys ba-svk1….
 *
 * Its state moves sats without a tx: the markets' treasury and author-fee UTXOs (OutPoint MarketFunds), and payouts
 * (OutPoint Payout). The index follows list_utxos for those (stateUtxos) and values an input spending one with
 * get_stxos. A Trade or AmplifyBeta tx has no outputs (validation.cpp validate_trade): its inputs pay, when the block
 * applies it (backbone-hivemind chains/hivemind/src/market_block.cpp apply_trade, consolidate):
 * - a fixed miner fee of 1000 sats (TRADE_MINER_FEE_SATS, math.h; validation.cpp miner_fee);
 * - a buy: the LMSR cost (to the market's treasury) and the market's trading fee (to its author-fee UTXO), at most
 *   limit_sats - 1000 together (BuyCost::exceeds_limit); the rest comes back to the trader as a Payout
 *   blake3("BUY_CHANGE" ‖ market_id[6] ‖ trader[20] ‖ txid[32]):0 (buy_change_outpoint), when not zero;
 * - a sell: nothing to the market; the inputs less the miner fee come back as a Payout
 *   blake3("SELL_INPUT_CHANGE" ‖ trader ‖ txid):0, and the net proceeds (gross from the treasury less the trading
 *   fee, at least limit_sats) are paid as a Payout blake3("SELL_PAYOUT" ‖ market_id ‖ trader ‖ txid):0;
 * - an AmplifyBeta: its amount into the treasury, the change to the market's author as a BUY_CHANGE Payout.
 * A trade over its limit is skipped by the block (connect_txs; block.cpp connect_prevalidated): its inputs stay
 * unspent and it pays no fee. So inputs = payouts + cost + fee, cost negative for a sell (L2-API.md `market`).
 */

export function truthcoinContent(raw: any): Content {
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

const marketIdOf = (v: any): string => Array.isArray(v) ? hex(Uint8Array.from(v)) : String(v ?? '').toLowerCase();

function payoutOutpoint(tag: string, ...parts: Uint8Array[]): any {
  return { Payout: { hash: hex(blake3(Buffer.concat([Buffer.from(tag, 'latin1'), ...parts]))), vout: 0 } };
}

export const truthcoinMarket: L2MarketRules = {
  fee: 1000,
  terms(data: any): MarketTerms | null {
    const [k, v] = tagged(data);
    if (k === 'Trade' && v) {
      const shares = Number(v.shares ?? 0);
      return {
        action: shares < 0 ? 'sell' : 'buy', marketId: marketIdOf(v.market_id), outcome: Number(v.outcome_index ?? 0), shares,
        limit: Number(v.limit_sats ?? 0), trader: String(v.trader ?? ''),
      };
    }
    if (k === 'AmplifyBeta' && v) {
      return { action: 'amplify', marketId: marketIdOf(v.market_id), outcome: null, shares: 0, limit: null, trader: String(v.market_author ?? '') };
    }
    return null;
  },
  payouts(txid, t) {
    const mid = unhex(t.marketId);
    const trader = decodeAddress(t.trader);
    if (mid.length !== 6 || !trader || !/^[0-9a-f]{64}$/.test(txid)) {
      return [];
    }
    const id = unhex(txid);
    if (t.action === 'sell') {
      return [
        { outpoint: payoutOutpoint('SELL_INPUT_CHANGE', trader, id), address: t.trader, kind: 'sellChange' },
        { outpoint: payoutOutpoint('SELL_PAYOUT', mid, trader, id), address: t.trader, kind: 'sellProceeds' },
      ];
    }
    return [{ outpoint: payoutOutpoint('BUY_CHANGE', mid, trader, id), address: t.trader, kind: 'buyChange' }];
  },
};

const truthcoin: ChainModule = {
  profile: { id: 'truthcoin', kind: 'l2', name: 'Truthcoin', unit: 'sats', slot: 13, mainchain: false, subsidy: false },
  l2: {
    txids: 'index', blockIndex: true, inputPairs: true, withdrawalBundleRpc: true, mempool: true, fill: false,
    depositRule: 'checksum', stateUtxos: true, market: truthcoinMarket, features: ['markets'],
    // push_tx(hex of the borsh AuthorizedTransaction), submit_transaction(its JSON): both public (rpc_node.cpp)
    submit: { hex: 'push_tx', json: 'submit_transaction' },
    content: truthcoinContent,
    featureRoutes(app, prefix, ctx) {
      featureRoutes(app, prefix, ctx);
    },
  },
};

export default truthcoin;
