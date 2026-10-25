# Sidechain explorers (L2): backend API

The sidechain explorers run from the same images as the eCash explorer, two backend instances per sidechain and
network, with `CHAIN.PROFILE` set to the sidechain's module (`thunder`, `bitnames`, `bitassets`, `truthcoin`, `zside`, `coinshift`;
`truthcoin` was `hivemind`, the name of its node software, until October 2026: /betanet/hivemind/… redirects)
and `CHAIN.L2_ROLE` saying which one it is:
- `index`: the sidechain index (backend/src/chain/l2/). Its nodes are the LayerTwo-API drop-ins (backbone-*), read over
  plain JSON-RPC 2.0 (`CHAIN.SIDECHAIN_RPC`); the eCash side comes from the enforcer (`CHAIN.ENFORCER`), and the BMM
  views from the eCash explorer's drivechain index (`CHAIN.MAINCHAIN_API`: the eCash explorer backend's base URL, e.g.
  `http://127.0.0.1:18950`; empty = no BMM views, `bmm` fields null). It serves the routes below and
  `GET /api/v1/chain`, and with `CHAIN.L2_RPC_PORT` a Bitcoin Core JSON-RPC view of the index on 127.0.0.1 (see "Core
  view" at the end). No database, mempool, websocket, statistics or block indexing.
- `full`: upstream mempool's backend (MariaDB, mempool, websocket, statistics, block indexing, the address index with
  `CHAIN.ADDRESS_INDEX: true`) whose node (`CORE_RPC`) is that Core view: the whole upstream API (`/api/v1/blocks`,
  `/api/v1/tx/:txid`, `/api/v1/address/:address`, `/api/v1/mining/...`, the websocket). The eCash drivechain index and
  the chain module's routes do not run there; nginx sends `/api/v1/chain` and `/api/v1/l2/` to the index instance.

Conventions:
- Amounts are sats (integers). Sidechain hashes and txids are lower-case hex, not reversed (the nodes' own display
  order). eCash hashes (mainchain blocks, deposit txids, M6 ids) are in Bitcoin display order.
- `time` is the Unix time of the eCash block that carried the sidechain block (its BMM block); null until known.
- Lists are newest first unless stated. `?limit=` caps at 100 unless stated; `before=` pages by height.
- Errors: HTTP 400 for a malformed id, 404 for unknown, 503 `{ "error": "The index is still being built" }`.
- Read-only but for `POST /api/v1/l2/tx` (a signed tx to the node) and upstream's `POST /api/tx` on the full backend;
  nginx rate-limits both (6 a minute per IP, a burst of 6 more: then 429) and caps their body at 64 KB (413).

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
  "signers": [ "<address>" ],          // the address of each input's verifying key, in input order
  "market": Market | null }            // Truthcoin's Trade and AmplifyBeta txs, else null
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
`fee` is what the block's miner may claim: Σ inputs − Σ outputs (a withdrawal output counts its value + main fee); a
market tx's fixed miner fee; 0 when an input cannot be valued. An unconfirmed tx (from the node's `list_mempool`) has
`status: { confirmed: false }`, `index: null` and its outputs unspent.

### Market txs (Truthcoin)
A Trade or AmplifyBeta tx has no outputs: the chain's state takes its inputs and pays back through Payout outputs the
block makes (backbone-hivemind chains/hivemind/src/market_block.cpp apply_trade and consolidate, validation.cpp
validate_trade / miner_fee):
```
Market = { "action": "buy" | "sell" | "amplify",
  "marketId": "9fdc6b8f5ed5", "outcome": 0 | null, "shares": 2000000,   // negative: sold; 0 for an AmplifyBeta
  "limit": 1463476 | null,     // a buy's max cost incl. the miner fee (limit_sats), a sell's min net proceeds
  "applied": true | false | null,   // false: its block skipped it (a buy over its limit, a sell under its minimum):
                                    // its inputs stay unspent, no fee; null: unconfirmed
  "cost": 1434781 | null,      // sats into the market (LMSR cost + the market's trading fee; an AmplifyBeta's amount),
                               // negative for a sell: its net proceeds out of the treasury; null: unconfirmed or an
                               // input not valued
  "payouts": [ { "kind": "buyChange" | "sellChange" | "sellProceeds", "outpoint": OutPoint, "vout": 0,
                 "address": "…", "value": 8564219, "spent": Spent | null } ] }
```
Σ inputs = Σ outputs (none) + Σ payouts + cost + fee, with fee = 1000 sats (TRADE_MINER_FEE_SATS) for an applied
market tx:
- a buy: the inputs (anyone's) pay the LMSR cost to the market's treasury and its trading fee to the author's fee
  UTXO, at most `limit − 1000` together; the rest comes back to the trader as Payout
  blake3("BUY_CHANGE" ‖ market_id[6] ‖ trader[20] ‖ txid[32]):0 (none when nothing is left);
- a sell: nothing goes to the market; the inputs less 1000 come back as Payout blake3("SELL_INPUT_CHANGE" ‖ trader ‖
  txid):0 and the net proceeds (gross from the treasury less the trading fee, at least `limit`) are paid as Payout
  blake3("SELL_PAYOUT" ‖ market_id ‖ trader ‖ txid):0; `cost` = − proceeds;
- an AmplifyBeta: its amount into the treasury (liquidity), the change to the market's author (BUY_CHANGE).
The index derives those outpoints, reads their values and whether the block applied the tx from the node
(`get_utxos` / `get_stxos` of the signers and the trader), and files the payouts under the tx (in addresses'
histories and balances at the tx's height). An input spending an output of the chain's state the index never saw
(a payout made and spent between two of its looks at `list_utxos`) is valued with `get_stxos` too. On betanet at
height 661 all 7 trades check out and every address balance equals the node's UTXOs (Σ = sidechain_wealth).

## GET /api/v1/l2/address/:address?before=&limit=
```
{ "address": "…", "funded": { "count": 0, "sum": 0 }, "spent": { "count": 0, "sum": 0 }, "balance": 0,
  "txs": [ { "txid": "…", "height": 2253, "time": …, "delta": 100000,
             "kind": "tx" | "coinbase" | "deposit" | "withdrawal" | "bundle-return" | "state" } ],
  "utxos": [ { "outpoint": OutPoint, "content": Content, "value": 0, "height": 2253 } ],   // ≤ 500, newest first
  "mempool": { "txs": [ Tx & { "delta": -100000 } ], "delta": -100000 } | null }
```
`balance` is confirmed. `mempool`: the address's unconfirmed txs from the node's `list_mempool` (an input it owns or an
output to it; read at most every 3 s) and their net effect on its balance; null on chains whose node lists no mempool
(Thunder, zSide). A market tx there counts its inputs only (what comes back is known once a block applies it). An
address with only unconfirmed txs answers with zero confirmed figures, not 404.

## GET /api/v1/l2/address/:address/positions          (Truthcoin)
The node's `market_positions(address)` and `votecoin_balance(address)` (cached 5 s):
```
{ "address": "…", "positions": [ { "marketId": "9fdc6b8f5ed5", "title": "…" | null, "outcome": 0,
      "outcomeName": "Outcome 0: [0]", "shares": 2000000, "price": 0.8808 | null,   // the outcome's current LMSR price
      "value": 1761593 | null } ],                                                 // floor(shares × price), sats
  "value": 1761593,        // Σ value: what the shares are worth at the current prices (a share pays its outcome's
                           // final price in sats when the market resolves)
  "votecoin": 0.0,         // the address's Votecoin (the oracle's reputation share)
  "height": 661 }
```

## POST /api/v1/l2/tx: broadcast a signed tx
Body (≤ 64 KB): the chain's serialized tx as hex (`Content-Type: text/plain`, or JSON `{ "hex": "…" }`), or the node's
own JSON of the signed tx as it is, `{ "transaction": {…}, "authorizations": [ { "verifying_key": …, "signature": … } ] }`
(Truthcoin's also `actor_proof`). The explorer checks only the shape and size and hands it to the node's public
submit method:

| chain | hex | JSON |
|---|---|---|
| Truthcoin | `push_tx` (borsh of the AuthorizedTransaction) | `submit_transaction` |
| Thunder, BitNames, BitAssets, zSide | – (400) | `submit_transaction` |
| Coinshift | – | – (404: its public RPC has no submit method) |

Replies: `200 { "txid": "…" }` (the node accepted it into its mempool and relays it); `400 { "error": "…" }` for a
malformed body (invalid hex, neither form, the form the chain does not take); `400 { "error": "The node rejected the
transaction", "reason": "…" }` when the node answered with a JSON-RPC error: `reason` is the node's own text
(`failed to deserialize AuthorizedTransaction: …`, `invalid transaction: …`, `utxo … doesn't exist`, `value in is less
than value out`), cleaned up: printable ASCII, host addresses, URLs and paths masked, at most 200 characters. A wallet
needs it to tell a spent input from a bad signature or a buy over its limit, and the nodes' validation texts name tx
data only. `502 { "error": "The sidechain node did not answer" }` with no detail for a timeout or an HTTP error (those
texts can name hosts and ports: they stay in the log). 413 for a body over the limit, 429 when rate-limited.
On the full backend, upstream's `POST /api/tx` (body: hex text) goes through the Core view's `sendrawtransaction` to
the same method: Truthcoin's native hex works there (`txid` text, or `400 sendrawtransaction RPC error: {"code":-26}`
when rejected); the JSON-only chains answer `{"code":-22}`.

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

### `markets` (Truthcoin)
- `feature/markets` → `{ items: [<market_list item> & { trades, lastTrade: Ref | null, created: Ref | null }] }` (trades: Trade txs in the index).
- `feature/markets/:id` (12 hex) → `<market_get> & { trades, lastTrade, created, priceHistory: <market_price_history: [{ height,
  block_hash, timestamp, prices }]>, tradeList: [Ref & { marketId, outcome, shares (negative: sell), trader, limitSats, input, cost,
  applied, fee }] }` (input: Σ of the tx's inputs; cost, applied, fee: as the tx's `market` and `fee`).
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

BMM accepts and requests from `l2/bmm/events/bmm`, `l2/bmm/events/bmm-requests` and the cockpit's `coverage[].accepts[]`
carry `published: boolean`: whether the committed sidechain block exists in this chain. Under BMM an eCash block can
accept a commitment to a block its producer never broadcasts, so `published: false` is normal ("never published").

## Core view (CHAIN.L2_ROLE index, CHAIN.L2_RPC_PORT): what the full backend reads
backend/src/chain/l2/core.ts and facade.ts: JSON-RPC 1.0/2.0 POSTs to `/` on 127.0.0.1, Core's methods and error codes
(-5 unknown tx or block, -8 bad parameter or height, -28 while the index is empty, -32601 anything else; read-only but for
sendrawtransaction: the chain's own hex to the node's hex submit method, -22 malformed or no hex method, -26 rejected
with the node's reason, -1 no answer).
getblockchaininfo (chain `main`), getblockcount, getblockhash, getbestblockhash, getchaintips, getblockheader,
getblock 0-3, getblockstats, getrawtransaction 0-2 (+ blockhash), decoderawtransaction, gettxout, gettxspendingprevout,
gettxoutsetinfo, getrawmempool, getmempoolinfo, getmempoolentry, getmempoolancestors/descendants (empty),
getmininginfo / getnetworkhashps / getdifficulty (difficulty 1, hashrate 0), estimatesmartfee (1 sat/vB),
getnetworkinfo, getindexinfo (txindex and txospenderindex), validateaddress, uptime, sendrawtransaction.

How the index looks as Bitcoin:
- txids, block hashes and merkle roots are the chain's own; the header is a synthetic 80-byte Bitcoin header
  (version 1, prev hash, merkle root, time, bits `1d00ffff`, nonce 0); `time` the BMM eCash block's, kept
  non-decreasing; difficulty 1, chainwork (height + 1) × 0x100010001; size the chain's own tx size (else the synthetic
  serialization's), weight = 4 × size; raw blocks and txs are Bitcoin serializations of the same inputs and outputs.
- Every output's script is P2PKH-shaped, `76a914<the address's 20 bytes>88ac`, `address` the chain's base58; `value` its
  sats (0 for non-sats content). Extra fields (also on `prevout`): `content` (Content, for anything but sats),
  `withdrawal: { main_address, value, main_fee }` (value counts value + main fee), `memo`.
- Inputs name (txid, n) of the tx that made the output (Coinshift's merkle-root coinbase outpoints: the coinbase's
  txid), `prevout` inline (`getblock 3`, `getrawtransaction 2`), `deposit: true` on a deposit's, `kind: "marketFunds" |
  "payout"` on Truthcoin's (no prevout when the index cannot resolve one). Tx extras: `data` (TxData), `shielded`
  (zSide), `market` (Truthcoin), `fee` from the index.
- A Truthcoin market tx has, after its own outputs (none), its Payout outputs (vout 0, 1: a buy's change, a sell's
  change then proceeds) and, for sats it paid into the market, an OP_RETURN output of that value (`market:<id>`):
  its inputs then add up to its outputs and the miner fee. A sell's proceeds come out of the market's treasury, so its
  outputs exceed its inputs by them. A market tx its block skipped spends nothing: one coinbase-shaped input, no
  outputs, fee 0.
- Coins that move without a sidechain tx get a synthetic tx with `peg`, after the block's own txs:
  `peg: "deposit"` (txid = the eCash deposit txid, `mainTxid`; one coinbase-shaped input; the deposit at its eCash vout,
  lower vouts zero-value OP_RETURN padding), `peg: "withdrawal"` (txid = the bundle's M6 id, `m6id`; spends the
  bundled withdrawal outputs into one OP_RETURN output of their value), `peg: "state"` (Truthcoin: what the chain state
  consumed and made at that height: markets' funds, resolution payouts). A bundle that failed later gave its outputs back and has no withdrawal tx.
- Txs with no inputs (BitNames' recurring zero-input txs, zSide's shielded-only txs) have `vin: []`; a recurring txid
  answers with its latest block (`getrawtransaction txid 1 <blockhash>` for another).
- On a chain whose state moves sats without txs (Truthcoin) the view's tip is the height the index last followed
  list_utxos at, so that a block does not change after the full backend read it.

The full backend's Esplora-style JSON keeps those fields: a tx's `data`, `shielded`, `peg`, `mainTxid`, `m6id`, `market`;
a vin's `deposit`, `kind`; a vout's or prevout's `content`, `withdrawal`, `memo`. Addresses' balances equal the index's.
The mempool (list_mempool) shows there too: `/api/mempool/txids`, the address's `mempool_stats`, its unconfirmed txs
first in `/api/address/:address/txs`, and `/api/address/:address/txs/mempool` (as Esplora's). `/api/address/:address/txs/chain`
and `/api/address/:address/txs/chain/:txid` answer confirmed txs only, and `/api/block/:hash/status` answers
`{ in_best_chain, height, next_best }`, as Esplora's do.

## For wallets
- **Which chain is this?** Ask for a block you know: `GET /api/v1/l2/block/:height` (`hash`) on the index, or
  upstream's `GET /api/block-height/:height` (the hash as text) on the full backend; both answer the node's
  `get_block_hash(height)` (checked on betanet: Truthcoin 638 → c96b0581…c5bc on both, Thunder 0 → 8b52259a…ec74).
  `GET /api/v1/chain` names the profile, slot and network.
- **Balance and coins:** `GET /api/v1/l2/address/:address` (confirmed `balance`, ≤ 500 `utxos` with their outpoints in
  the node's JSON form, `mempool` for what is pending), or upstream's `/api/address/:address` and `/utxo`.
- **Fees:** there is no fee market. The nodes take any fee ≥ 0: Truthcoin validates Σ inputs ≥ Σ outputs and keeps
  the difference as the fee (backbone-hivemind chains/hivemind/src/block.cpp validate_filled: "value in is less than
  value out"), with no minimum relay fee in its mempool (node.cpp submit_transaction) and blocks filled in mempool
  order (node.cpp: trades last), not by fee rate. A Trade or AmplifyBeta pays exactly 1000 sats (validation.cpp
  miner_fee), taken from its inputs: a buy needs inputs ≥ `limit_sats`, a sell ≥ 1000. The other chains' fee is
  Σ inputs − Σ outputs too (L2-NODES.md). `GET /api/v1/fees/recommended` answers 1 sat/vB for every target (the Core
  view's estimatesmartfee): a placeholder, not a requirement.
- **Broadcast:** `POST /api/v1/l2/tx` (above): hex for Truthcoin, the node's JSON for Thunder, BitNames, BitAssets
  and zSide; poll `GET /api/v1/l2/tx/:txid` (unconfirmed, then confirmed) or the address's `mempool`. Rate limit:
  6 a minute per IP plus a burst of 6.
- **Truthcoin trades:** a confirmed trade's `market` says what it cost and which Payout outputs came back to the
  trader (spend them like any other output: their outpoints are `{"Payout": {"hash", "vout": 0}}`).
  `GET /api/v1/l2/address/:address/positions` lists the shares an address holds.
