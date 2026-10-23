import { ChainModule } from '../../module';
import { Content } from '../../l2/types';
import { tagged, withdrawalContent } from '../../l2/codec';
import { featureRoutes } from './routes';

/**
 * BitAssets (slot 4): assets, AMM pools and Dutch auctions on BitNames' design, served by backbone-bitassets. As
 * BitNames: txids, deposits and bundle spends from get_block_index, list_mempool, ids from get_utxos / get_stxos.
 * Content: AmmLpToken, BitcoinSats, BitAsset, BitAssetControl, BitAssetReservation, DutchAuctionReceipt, Withdrawal;
 * filled: {"BitAsset": [id, n]}, {"AmmLpToken": {asset0, asset1, amount}}, {"BitAssetControl": id}, …; an AssetId is
 * the hex of its borsh (Bitcoin = "00"). Deposit text: s4_<b58>_<checksum prefix> or bare. Keys ba-svk1….
 */

export function bitassetsContent(raw: any): Content {
  const [k, v] = tagged(raw);
  const pair = Array.isArray(v);
  switch (k) {
    case 'BitcoinSats':
      return { type: 'value', value: Number(v), raw };
    case 'Withdrawal':
    case 'BitcoinWithdrawal':
      return withdrawalContent(raw, v);
    case 'BitAsset':
      return pair ? { type: 'bitasset', assetId: String(v[0]), amount: Number(v[1]), raw } : { type: 'bitasset', amount: Number(v), raw };
    case 'AmmLpToken':
      return typeof v === 'object' && v !== null
        ? { type: 'ammLpToken', assetId: `${v.asset0}:${v.asset1}`, amount: Number(v.amount), raw }
        : { type: 'ammLpToken', amount: Number(v), raw };
    case 'BitAssetControl':
      return { type: 'bitassetControl', ...(v !== undefined ? { assetId: String(v) } : {}), raw };
    case 'BitAssetReservation':
      return { type: 'bitassetReservation', raw };
    case 'DutchAuctionReceipt':
      return { type: 'dutchAuctionReceipt', ...(v !== undefined ? { assetId: String(v) } : {}), raw };
    default:
      return { type: 'other', raw };
  }
}

const bitassets: ChainModule = {
  profile: { id: 'bitassets', kind: 'l2', name: 'BitAssets', unit: 'sats', slot: 4, mainchain: false, subsidy: false },
  l2: {
    txids: 'index', blockIndex: true, inputPairs: false, withdrawalBundleRpc: false, mempool: true, fill: true,
    submit: { json: 'submit_transaction' },
    depositRule: 'prefix', features: ['assets'],
    content: bitassetsContent,
    featureRoutes(app, prefix, ctx) {
      featureRoutes(app, prefix, ctx);
    },
  },
};

export default bitassets;
