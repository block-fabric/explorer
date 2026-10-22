# Sidechain nodes (LayerTwo-API drop-ins): what an indexer needs

Sources: /home/louis/skydoge/backbone-core and backbone-{thunder,bitnames,bitassets,hivemind,zside} (C++ clones of
LayerTwo's Rust nodes). File references are into those repositories.

| chain | slot | betanet RPC (public / private) | txids from | block height in get_block |
|---|---|---|---|---|
| Thunder | 9 | 16009 / 6009 | blake3(canonical_bytes) of `get_block(hash, true)` | no |
| BitNames | 2 | 16002 / 6002 | `get_block_index(hash).txs[].txid` | yes |
| BitAssets | 4 | 16004 / 6004 | `get_block_index(hash).txs[].txid` | yes |
| Hivemind (Truthcoin) | 13 | 16013 / 6013 | `get_block_index(hash).txs[].txid` | no |
| zSide (thunder-orchard) | 98 | 16098 / 6098 | computed, see below | no |
| Coinshift | 255 | 16255 / 6255 | `get_block_index(hash).txs[].txid` | see source |

The public RPC (read methods) listens on 216.128.183.114 and admits only the pool server; the private one (wallet,
mining, stop, peers) stays on 127.0.0.1. Plain JSON-RPC 2.0 POST to `/`, no auth. The Host header must be loopback
or `216.128.183.114:<port>`.

## Common to all
- Hashes are BLAKE3-256 over borsh (u32/u64 LE; Vec = u32 count + items; bytes = u32 len + bytes; Option = u8 0/1
  + value; enum = u8 tag + fields). Sidechain hashes (block hash, txid, merkle root, prev_side_hash) are shown as hex
  of the raw bytes, not reversed; mainchain hashes (prev_main_hash, deposit txids, m6id, get_bmm_inclusions) in
  Bitcoin display order (reversed).
- Block hash = blake3(borsh(Header)): merkle_root[32] ‖ Option<prev_side_hash[32]> ‖ prev_main_hash[32, internal
  order], and on Thunder, Hivemind and zSide ‖ u32 n ‖ n × root[32] (Empty/Placeholder = 32 zero bytes).
  Test vectors: backbone-thunder/tests/test_thunder_types.cpp:19-30.
- Coinbase txid = blake3(merkle_root ‖ prev_main_hash ‖ Option<prev_side_hash>); its outputs are spent as
  OutPoint Coinbase{txid, vout}.
- `getblockcount` = tip height + 1. `get_block_hash(height)` answers for the active chain only.
  `get_bmm_inclusions(block_hash)` = the eCash blocks (display order) whose BMM carried the block (the child of
  prev_main_hash). Blocks have no timestamp: use the BMM block's time.
- Reorgs: follow prev_side_hash (null = genesis) and re-check get_block_hash(h) against stored hashes.
- Ignore utreexo data: header.roots, tx.proof, and the second element of Thunder/Hivemind/zSide input pairs
  (utxo_hash = blake3(borsh(outpoint) ‖ borsh(spent output))).
- Address = 20 bytes, base58 (Bitcoin alphabet) with no version byte or checksum; of a verifying key, the first 20
  bytes of BLAKE3-XOF(32-byte ristretto key). Burn address: 20 zero bytes = `11111111111111111111`.
- `body.authorizations[k]` signs the k-th input over all transactions in order: its verifying key gives the spender.
- Fee = Σ input values − Σ output values; a Withdrawal output counts value + main_fee. The coinbase claims fees.
- Deposits: the eCash deposit's OP_RETURN (vout + 1 after the treasury output) holds UTF-8 text; each chain parses
  it with its rule (below), else credits the burn address. The sidechain UTXO is OutPoint Deposit
  `{"Deposit":"<display txid>:<vout>"}`. Deposits of the eCash blocks in (prev_main(N-1), prev_main(N)] are applied
  when sidechain block N connects. Withdrawn UTXOs leave by a bundle, with no sidechain tx (STXO inpoint
  `{"Withdrawal":{"m6id":…}}`). Bundle status: Submitted, Confirmed, Failed.

## Thunder (slot 9)
- txid = blake3(borsh(tx)), tx = inputs (OutPoint 37 bytes ‖ utxo_hash 32) ‖ outputs (addr20 ‖ u8 kind ‖ u64 value
  [‖ u64 main_fee ‖ bytes spk]); proof and authorizations excluded. `get_block(hash, true)` gives each tx's borsh
  as `canonical_bytes: "0x…"`.
- Content: `{"Value":n}` | `{"Withdrawal":{value,main_fee,main_address}}`. No TxData.
- RPC: get_block, get_block_hash, get_bmm_inclusions, get_best_mainchain_block_hash, get_best_sidechain_block_hash,
  get_transaction(txid) → {tx, block_hash|null}, get_utxos([addr]), get_stxos([addr]), list_utxos,
  get_withdrawal_bundle(m6id), pending_withdrawal_bundle, latest_failed_withdrawal_bundle_height, sidechain_wealth.
  No mempool listing, no per-block deposits: take deposits from the enforcer's peg data.
- Deposit text: bare base58 only (the `s9_…` form burns).

## BitNames (slot 2)
- tx borsh: inputs (OutPoint only) ‖ outputs (addr20 ‖ Content ‖ bytes memo) ‖ bytes memo ‖ Option<TxData>.
- `get_block_index(hash)` (active chain) → {txs:[{txid,size,raw}], deposits:[{outpoint,output}],
  bundle_spends:[{outpoint,m6id}]}; `get_transaction_info(txid)` → {confirmations, fee_sats, txin:{block_hash,idx}|null};
  `list_mempool` → [{txid,size,raw,tx}]; `bitnames`, `bitname_data(id)`, list/get utxos and stxos.
- Content: `{"BitcoinSats":n}` | `"BitName"` | `"BitNameReservation"` | `{"Withdrawal":{value_sats,main_fee_sats,main_address}}`;
  filled (UTXO RPCs): `{"BitName":id}`, `{"BitNameReservation":[txid,"0x…"]}`. TxData: BitNameReservation{commitment},
  BitNameRegistration{name_hash,revealed_nonce,bitname_data}, BitNameUpdate, BatchIcann. memo is hex. Keys `bn-svk1…`.
- Deposit text: `s2_<b58>_<prefix of the sha256 hex>` or bare base58. Zero-input transactions can recur in
  several blocks (37 txids do).

## BitAssets (slot 4)
- As BitNames. Content: AmmLpToken, BitcoinSats, BitAsset, BitAssetControl, BitAssetReservation, DutchAuctionReceipt,
  Withdrawal; AssetId JSON = hex of its borsh (Bitcoin = "00"). TxData: AmmBurn, AmmMint, AmmSwap,
  BitAssetReservation, BitAssetRegistration, BitAssetMint, BitAssetUpdate, DutchAuctionCreate, DutchAuctionBid,
  DutchAuctionCollect. RPC adds bitassets ([[seq,id,data]]), bitasset_data, dutch_auctions, get_amm_pool_state,
  get_amm_price. No list_stxos. Keys `ba-svk1…`. Deposit text as BitNames with `s4_`.

## Hivemind / Truthcoin (slot 13)
- tx borsh: inputs (OutPoint, utxo_hash) ‖ outputs ‖ Option<TxData>; OutPoint kinds Regular, Coinbase, Deposit,
  MarketFunds{market_id[6],block_height,is_fee}, Payout{hash,vout}; Content Value, Withdrawal,
  MarketFunds{market_id,amount,is_fee}. TxData: ClaimDecision, CreateMarket, Trade{market_id,outcome_index,shares,
  trader,limit_sats,…}, SubmitVote, SubmitBallot, TransferReputation, AmplifyBeta.
- RPC: get_block_index, get_two_way_peg_events(block_hash) → [{Deposit}|{BundleSpend}|{BundleReturn}],
  get_transaction, get_transaction_info, list_mempool, votecoin_balance, market_list/market_get/…, vote_period/….
- Deposit text: `s13_<b58>_<6 hex>` (full checksum, any case) or bare base58.

## zSide (thunder-orchard, slot 98)
- txid = blake3(borsh(inputs) ‖ borsh(outputs) ‖ Option<bundle_without_auth>), not blake3(canonical_bytes):
  canonical_bytes = inputs ‖ Option<full bundle> ‖ outputs. bundle_without_auth (no action count) is
  [for each action: nf ‖ cmx ‖ epk ‖ enc[0..52]] ‖ [for each: enc[32..544] ‖ enc[544..564]] ‖
  [for each: cv ‖ rk ‖ enc[564..580] ‖ out[80]] ‖ u8 flags ‖ i64 value_balance ‖ anchor[32] = 840·n + 41 bytes,
  the prefix of the full bundle in canonical_bytes (n = actions in the JSON). Inputs and outputs as Thunder.
- RPC as Thunder; no get_block_index, no mempool listing.
- Deposit text: bare base58 only.

## Coinshift (slot 255; backbone-coinshift, coinshift-rs v0.14.8)
- txid = blake3(borsh(tx)) (chains/coinshift/src/types.cpp:261-262). RPC as BitNames for blocks (get_block_index,
  list_mempool), plus swaps: list_swaps, list_swaps_by_recipient, get_swap_status(swap_id) (doc/rpc-surface.md).
- Content adds SwapPending{value, swap_id}; TxData: Regular, SwapCreate, SwapClaim, SwapAccept. Swap ids are JSON
  arrays of 32 numbers. Swap state is partly node-local by design (L1 monitoring, update_swap_l1_txid, cancel_swap).

## Test data
`tests/data/betanet/txhex.jsonl` ({txid, hex}) in each repo; Hivemind `tests/data/oracle_vectors.jsonl` and
`encoding_vectors.json`. The public seed index https://seed.beta.ecash.eu.com/<chain> can be compared against.
