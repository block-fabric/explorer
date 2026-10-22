import { ChainModule } from '../../module';
import { Content } from '../../l2/types';
import { tagged, withdrawalContent } from '../../l2/codec';

/**
 * Thunder (slot 9), a sidechain of plain sats: LayerTwo's thunder, served by backbone-thunder. Its node hands out
 * no txids and no per-block deposits: txids are blake3(canonical_bytes) of get_block(hash, true), deposits come
 * from the enforcer's peg data (bare base58 text; the s9_ form burns) and a submitted bundle's UTXOs from
 * get_withdrawal_bundle. No mempool listing. Content: {"Value": n} | {"Withdrawal": {value, main_fee, main_address}}.
 */

export function thunderContent(raw: any): Content {
  const [k, v] = tagged(raw);
  switch (k) {
    case 'Value':
      return { type: 'value', value: Number(v), raw };
    case 'Withdrawal':
      return withdrawalContent(raw, v);
    default:
      return { type: 'other', raw };
  }
}

const thunder: ChainModule = {
  profile: { id: 'thunder', kind: 'l2', name: 'Thunder', unit: 'sats', slot: 9, mainchain: false, subsidy: false },
  l2: {
    txids: 'canonical', blockIndex: false, inputPairs: true, withdrawalBundleRpc: true, mempool: false, txInfo: false, fill: false,
    depositRule: 'bare', features: [],
    content: thunderContent,
  },
};

export default thunder;
