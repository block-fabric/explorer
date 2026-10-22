# Sidechain explorers (L2): backend API

The sidechain explorers run from the same images as the eCash explorer, one backend instance per sidechain and
network, with `CHAIN.PROFILE` set to the sidechain's module (`thunder`, `bitnames`, `bitassets`, `hivemind`, `zside`, `coinshift`).
Their nodes are the LayerTwo-API drop-ins (backbone-*), read over plain JSON-RPC 2.0 (`CHAIN.SIDECHAIN_RPC`); the
eCash side comes from the enforcer (`CHAIN.ENFORCER`), and the BMM views from the eCash explorer's drivechain index
(`CHAIN.MAINCHAIN_API`: the eCash explorer backend's base URL, e.g. `http://127.0.0.1:18950`; empty = no BMM views,
`bmm` fields null). An L2 instance does not start upstream mempool's node, mempool,
statistics or block indexing: it serves only the routes below and `GET /api/v1/chain`.

Conventions:
- Amounts are sats (integers). Sidechain hashes and txids are lower-case hex, not reversed (the nodes' own display
  order). eCash hashes (mainchain blocks, deposit txids, M6 ids) are in Bitcoin display order.
- `time` is the Unix time of the eCash block that carried the sidechain block (its BMM block); null until known.
- Lists are newest first unless stated. `?limit=` caps at 100 unless stated; `before=` pages by height.
- Errors: HTTP 400 for a malformed id, 404 for unknown, 503 `{ "error": "The index is still being built" }`.

## GET /api/v1/chain
As for the eCash explorer, plus `kind: "l2"` and:
```
{ "slot": 9, "unit": "sats", "mainchainExplorer": "https://explorer.blockfab.org/betanet" | null,
  "features": ["names" | "assets" | "markets" | "shielded" | "swaps" | "richlist" ...],
  "bmm": true }                       // CHAIN.MAINCHAIN_API is set: the BMM views (l2/bmm/*, `bmm` of blocks) are on
```

## GET /api/v1/l2/summary
```
{ "tip": { "height": 2283, "hash": "…", "time": 1792668688 },
  "indexed": 2283,                 // highest indexed height (== tip.height when caught up)
  "ready": true,
  "blocks": 2284, "txs": 412, "addresses": 96,
  "wealth": 101206236589,          // sidechain_wealth: sats held on the sidechain
  "escrow": { "amount": 101206335589, "txid": "…", "sequence": 25 } | null,   // the treasury on eCash
  "deposits": { "count": 31, "amount": 0 }, "withdrawals": { "count": 4, "amount": 0 },
  "pendingBundle": { "m6id": "…" | null, "payouts": [{ "address": "bc1…", "amount": 10000, "fee": 10000 }], "total": 10000 } | null,
  "mempool": { "count": 0 } | null, // null when the node cannot list its mempool (Thunder, zSide)
  "bmm": { "window": 144,          // BMM coverage over the newest `window` eCash blocks (the L1 cockpit's for this slot)
           "mainHeight": 973926,    // the newest of them
           "accepts": 135,          // of them, blocks that carried a block of this sidechain
           "coverage": 0.9375,      // accepts / window
           "lastMainHeight": 973926 | null, "bidMedian": 376 } | null   // null: no MAINCHAIN_API, or it did not answer
}
```

## GET /api/v1/l2/blocks?before=&limit=        (limit ≤ 50)
`[ BlockSummary ]` newest first:
```
BlockSummary = { "height": 2283, "hash": "…", "prevHash": "…" | null, "time": 1792668688 | null,
  "mainBlock": { "hash": "…", "height": 973921 } | null,   // the eCash block that carried it (BMM)
  "txCount": 1, "outputs": 2, "inputs": 1, "fees": 0, "deposits": 0, "volume": 100000,
  "bmm": Bmm | null }
Bmm = {                                // the eCash drivechain index's accepted BMM (M7) of this block; null: none known
  "mainHeight": 973926, "mainHash": "…",   // the eCash block that carried it
  "bid": 564 | null,                   // sats: the fee of the M8 request, paid to that block's miner
  "requestTxid": "…" | null,           // the M8 request (an eCash txid)
  "requests": 1,                       // M8 requests for this slot in that eCash block (the accepted one included)
  "contested": false }                 // requests > 1
```
`bmm` joins the eCash index's BMM accepts of this slot (`GET drivechain/events/bmm`, refreshed every 30 s, the newest
12 eCash blocks read again each time) to the block's hash: the index's `sideBlock` is in Bitcoin display order and is
reversed for the join (the nodes' hashes are not). `bmm.mainHeight` equals `mainBlock.height` (the enforcer's view).

## GET /api/v1/l2/block/:hashOrHeight
```
{ ...BlockSummary, "merkleRoot": "…", "prevMainHash": "…", "nextHash": "…" | null,
  "coinbase": { "txid": "…", "outputs": [Output] },
  "txs": [ TxSummary ],
  "deposits": [ Deposit ],            // credited when this block connected
  "bundleSpends": [ { "outpoint": OutPoint, "m6id": "…" } ],
  "bmm": { ...Bmm,                     // and the competition in that eCash block:
           "requestList": [ { "txid": "…", "bid": 564, "sideBlock": "…", "accepted": true } ] } | null }
```
`requestList`: every M8 request for this slot in the carrying eCash block (`sideBlock` in the nodes' order: the
sidechain block each bidder asked for).

## GET /api/v1/l2/tx/:txid
```
Tx = { "txid": "…", "status": { "confirmed": true, "height": 2253, "hash": "…", "time": … } | { "confirmed": false },
  "index": 0,                          // position in the block
  "inputs": [ Input ], "outputs": [ Output ], "fee": 0, "size": 312 | null,
  "data": { "type": "BitNameReservation", ...fields } | null,   // TxData, as the node gives it, type lifted out
  "shielded": { "actions": 2, "valueBalance": -634571766, "flags": 3 } | null,   // zSide's Orchard bundle
  "signers": [ "<address>" ] }          // the address of each input's verifying key, in input order
TxSummary = Tx without "status"
Input  = { "outpoint": OutPoint, "address": "…" | null, "content": Content | null, "value": 0 | null }
OutPoint = { "kind": "regular" | "coinbase" | "deposit" | "marketFunds" | "payout", "txid": "…" | null,
             "vout": 0 | null, "label": "…" }   // label: a short display form, e.g. "deposit 1a2b…:0"
Output = { "vout": 0, "address": "…", "content": Content, "value": 0,   // value: sats the output holds (0 for non-sats content)
           "memo": "…" | null, "spent": { "txid": "…" | null, "vin": 0 | null, "height": 2260, "kind": "tx" | "bundle" } | null }
Content = { "type": "value" | "withdrawal" | "bitname" | "bitnameReservation" | "bitasset" | "bitassetControl"
            | "bitassetReservation" | "ammLpToken" | "dutchAuctionReceipt" | "marketFunds" | "swapPending" | "other",
            "value"?: 0, "mainAddress"?: "bc1…", "mainFee"?: 0, "assetId"?: "…", "amount"?: 0, "name"?: "…", "raw": <node JSON> }
```

## GET /api/v1/l2/address/:address?before=&limit=
```
{ "address": "…", "funded": { "count": 0, "sum": 0 }, "spent": { "count": 0, "sum": 0 }, "balance": 0,
  "txs": [ { "txid": "…", "height": 2253, "time": …, "delta": 100000 } ],
  "utxos": [ { "outpoint": OutPoint, "content": Content, "value": 0, "height": 2253 } ] }
```

## GET /api/v1/l2/deposits?before=&limit=     GET /api/v1/l2/withdrawals?before=&limit=
```
Deposit = { "outpoint": OutPoint, "mainTxid": "…", "address": "…", "burned": false, "amount": 0,
            "height": 2253, "hash": "…", "time": …, "spent": { … } | null }
Withdrawal = { "txid": "…", "vout": 0, "height": 2253, "time": …, "address": "…", "mainAddress": "bc1…",
               "amount": 0, "mainFee": 0, "status": "pending" | "bundled" | "paid", "m6id": "…" | null }
```

## GET /api/v1/l2/search/:query
`{ "type": "block" | "tx" | "address" | null, "id": "…" }`: a height, block hash, txid or address.

## Chain features: GET /api/v1/l2/feature/<name>[/...]
Each chain module (backend/src/chain/modules/<chain>/routes.ts) joins its node's public read RPCs (cached a few
seconds) with what the index holds (every tx's inputs, outputs and TxData; the UTXO set; addresses), rebuilt once per
index generation. Lists are `{ "items": [...] , ... }`. Ids from a request reach the node only once the node's own
list or the index knows them; errors as above (400 malformed id, 404 unknown, 503 while the index is built). Node
error text never reaches a reply. `Ref = { "height": 202, "time": 1789958667 | null, "txid": "…" }`.

The chains keep a BitAsset's or BitName's blake3 name hash, not its name: `name` is the plain name when a BitNames
BatchIcann tx reveals it or one of the module candidates (modules/name-candidates.ts) hashes to the id, else null.

### `assets` (BitAssets). AssetId = hex of its borsh: `"00"` sats, `"01"‖hash` a BitAsset, `"02"‖hash` its control coin
- `feature/assets` → `{ items: [AssetItem], reservations: { total, open } }` (the node's `bitassets` order):
  `AssetItem = { id: "<hash>", assetId: "01…", seq, name, data: <bitasset_data>, supply, holders, controller: "<address>" | null,
  registered: Ref | null, initialSupply, minted, txs, last: Ref | null, price: <sats per unit> | null, pools: ["00-01…"] }`.
  supply / holders: the asset's unspent outputs; price: the last event of its pool with sats.
- `feature/assets/:id` (hash, or the AssetId 01‖hash / 02‖hash) → `AssetItem & { holderList: [{ address, amount, share }]` (top 100),
  `mints: [Ref & { amount }], activity: [Ref & { kind, amount, counterAsset, counterAmount, outputs: [{ address, amount }] }]`
  (newest first, ≤ 200; kind register | mint | transfer | update | swap | liquidity-add | liquidity-remove | auction-create |
  auction-bid | auction-collect; outputs: where the asset went, change included, ≤ 5), `priceHistory: [{ height, time, price }] }`.
- `feature/pools` → `{ items: [PoolItem] }`, the pools of the index's LP tokens and Amm txs:
  `PoolItem = { id: "<asset0>-<asset1>", asset0, asset1, state: <get_amm_pool_state: reserve0, reserve1, outstanding_lp_tokens,
  creation_txid> | null, price: reserve0 / reserve1 | null, created: Ref | null, swaps, volume0, volume1, events, last: Ref | null,
  replayed: { reserve0, reserve1, outstanding } | null }` (replayed: the reserves from the index's AmmMint / AmmBurn / AmmSwap txs).
- `feature/pools/:id` → `PoolItem & { history: [Ref & { kind: mint | burn | swap, amount0, amount1, lp, reserve0, reserve1,
  outstanding, price }]` (newest first, ≤ 500; amounts are the reserves' signed changes), `series: [{ height, time, price, reserve0, reserve1 }] }`.
- `feature/auctions` → `{ items: [AuctionItem], height }`: `AuctionItem = { id: "<create txid>", state: <dutch_auctions' state> | null,
  status: upcoming | live | ended, currentPrice | null, remaining, startBlock, endBlock, baseAsset, quoteAsset, created: Ref | null,
  bids, collects }`. currentPrice: quote units for all the base still offered at the next block (the price falls linearly from
  price_after_most_recent_bid to end_price_after_most_recent_bid at the end block, backbone-bitassets state.cpp AuctionState::bid).
- `feature/auctions/:id` → `AuctionItem & { height, params: <DutchAuctionCreate> | null, curve: [[block, price]],
  bidList: [Ref & { quantity, bidSize, bidder }], collectList: [Ref & { amountOfferedRemaining, amountReceived }] }`.

### `names` (BitNames)
- `feature/names` → `{ items: [NameItem], reservations: { total, open, registered } }`: `NameItem = { id: "<name hash>", name, seq,
  data: <bitname_data, commitment as hex>, owner: "<address holding the BitName output>" | null, registered: Ref | null, updates,
  transfers, last: Ref | null }`.
- `feature/names/:id` → `NameItem & { history: [Ref & { kind: reservation | registration | update | transfer | icann,
  address | null, data }] }` (newest first; the reservation is the one the registration spends).

### `markets` (Hivemind)
- `feature/markets` → `{ items: [<market_list item> & { trades, lastTrade: Ref | null, created: Ref | null }] }` (trades: Trade txs in the index).
- `feature/markets/:id` (12 hex) → `<market_get> & { trades, lastTrade, created, priceHistory: <market_price_history: [{ height,
  block_hash, timestamp, prices }]>, tradeList: [Ref & { marketId, outcome, shares (negative: sell), trader, limitSats, input, fee }] }`
  (input: sats the tx put in; a Trade has no outputs, so for inputs the index cannot value it is the node's fee_sats).
- `feature/decisions` → `{ status: <decision_status>, counts: { Created, Claimed, Voting, Resolved }, items: [<decision_list item,
  state ≠ Created> & { markets: [{ market_id, title }] }] }` (decision_list of the open periods, cached a minute).
- `feature/decisions/:id` (6 hex) → `<decision_list item> & { entry: <decision_get>, votes: <vote_list { decision_id }>, markets }`.
- `feature/votes` → `{ status: <decision_status>, period: <vote_period(current_period)> | null, voters: <vote_voters, by Votecoin
  balance>, periods: <list_open_periods_with_pricing>, voteTxs: [Ref & { type, voter }] }`.

### `shielded` (zSide)
- `feature/shielded` → `{ txs, actions, shieldedIn, shieldedOut, valueBalance, nullifiers, commitments, pool, blocks, height,
  series: [{ height, time, txs, actions, shieldedIn, shieldedOut, pool }]` (blocks with shielded activity; pool: sats in it after
  the block), `recent: [Ref & { actions, valueBalance, flags, transparentIn, transparentOut, fee, kind: shield | unshield | shielded }] }`
  (≤ 50). Every Orchard action reveals one nullifier and adds one note commitment, padding actions included.

### `richlist` (Thunder)
- `feature/richlist` → `{ items: [{ address, balance, share, funded, spent, txs, utxos, first, last }]` (top 100 by balance),
  `addresses, funded, total, top10Share, payments: { count, volume, fees, averageFee }, bucket, series: [{ from, to, time, txs,
  volume, fees }]` (60 ranges of `bucket` blocks), `largest: [Ref & { amount, fee, inputs, outputs }], height }`. A payment's
  amount is what went to addresses other than the spenders'.

### `swaps` (Coinshift)
- `feature/swaps` → `{ items: [Swap], nodeLocal: true, note }`: `Swap = <list_swaps item, byte arrays as hex, l1_txid flat
  (null: none seen)> & { txs: [Ref & { kind: create | accept | claim }], locked: { amount, outputs } | null }` (locked: the
  SwapPending outputs still unspent).
- `feature/swaps/:id` (64 hex) → `Swap & { known: <get_swap_status answered>, txData: [{ kind, txid, data }], nodeLocal: true, note }`.
  Swap state is partly node-local (Coinshift's design): what this node has seen of the L1 side.

## BMM: GET /api/v1/l2/bmm/cockpit?window=     GET /api/v1/l2/bmm/events/:kind?before=&limit=
From the eCash explorer's drivechain index (`CHAIN.MAINCHAIN_API`), for this sidechain's slot; 404 without
`MAINCHAIN_API`, 502 `{ "error": "The eCash explorer did not answer" }` when it fails (its error text stays in the log).
Replies are cached (15 s cockpit, 10 s events; at most 1000 entries).
- `bmm/cockpit?window=` (eCash blocks, default 1440, 0 = everything indexed): the eCash explorer's
  `GET /api/v1/drivechain/cockpit?window=&slot=<this slot>` as it gives it: `totals`, `slots` (this slot: accepts,
  coverage, longestGap, requests, rejected, contested, bid min / median / avg / max, deposits, withdrawals, votes,
  bundles), `miners`, `series` (≤ 60 buckets: bids, accepts, deposits, withdrawals, fees, escrow per slot), `coverage`
  (the newest 120 eCash blocks: accepts with bid and sideBlock, requests, deposits, withdrawals, voted),
  `bundleHistory` (votes over the window of each pending bundle), `live` (height, BIP300 constants, escrow, pending
  bundles with `score`, `threshold`, `blocksleft`, `payable`).
- `bmm/events/:kind?before=&limit=` (limit ≤ 500, default 50; `before` an eCash height, exclusive): the eCash
  explorer's `GET /api/v1/drivechain/events/:kind?slot=<this slot>`, kind `bmm` | `bmm-requests` | `deposits` |
  `withdrawals` | `votes` | `proposals` | `bundles`; each event `{ height, blockHash, time, slot, ... }` (eCash
  heights and hashes; `sideBlock` in Bitcoin display order, as the eCash explorer gives it).
