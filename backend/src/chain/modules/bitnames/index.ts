import { ChainModule } from '../../module';
import { Content } from '../../l2/types';
import { tagged, withdrawalContent } from '../../l2/codec';
import { featureRoutes } from './routes';

/**
 * BitNames (slot 2): names (BitNames) as UTXOs, served by backbone-bitnames. Txids, deposits and bundle spends
 * from get_block_index; list_mempool; the names' ids from get_utxos / get_stxos (filled content). Content:
 * {"BitcoinSats": n} | "BitName" | "BitNameReservation" | {"Withdrawal": {value_sats, main_fee_sats, main_address}};
 * filled: {"BitName": id}, {"BitNameReservation": [txid, "0x<commitment>"]}, {"BitcoinWithdrawal": …}.
 * Deposit text: s2_<b58>_<checksum prefix> or bare base58. Keys bn-svk1… (bech32m).
 */

export function bitnamesContent(raw: any): Content {
  const [k, v] = tagged(raw);
  switch (k) {
    case 'BitcoinSats':
      return { type: 'value', value: Number(v), raw };
    case 'Withdrawal':
    case 'BitcoinWithdrawal':
      return withdrawalContent(raw, v);
    case 'BitName':
      return { type: 'bitname', ...(v !== undefined ? { name: String(v) } : {}), raw };
    case 'BitNameReservation':
      return { type: 'bitnameReservation', raw };
    default:
      return { type: 'other', raw };
  }
}

const bitnames: ChainModule = {
  profile: { id: 'bitnames', kind: 'l2', name: 'BitNames', unit: 'sats', slot: 2, mainchain: false, subsidy: false },
  l2: {
    txids: 'index', blockIndex: true, inputPairs: false, withdrawalBundleRpc: false, mempool: true, fill: true,
    submit: { json: 'submit_transaction' },
    depositRule: 'prefix', features: ['names'],
    content: bitnamesContent,
    featureRoutes(app, prefix, ctx) {
      featureRoutes(app, prefix, ctx);
    },
  },
};

export default bitnames;
