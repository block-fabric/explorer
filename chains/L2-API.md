# Sidechain explorers (L2): backend API

The sidechain explorers run from the same images as the eCash explorer, one backend instance per sidechain and
network, with `CHAIN.PROFILE` set to the sidechain's module (`thunder`, `bitnames`, `bitassets`, `hivemind`, `zside`).
Their nodes are the LayerTwo-API drop-ins (backbone-*), read over plain JSON-RPC 2.0 (`CHAIN.SIDECHAIN_RPC`); the
eCash side comes from the enforcer (`CHAIN.ENFORCER`). An L2 instance does not start upstream mempool's node, mempool,
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
  "features": ["names" | "assets" | "markets" | "shielded" ...] }
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
  "mempool": { "count": 0 } | null  // null when the node cannot list its mempool (Thunder, zSide)
}
```

## GET /api/v1/l2/blocks?before=&limit=        (limit ≤ 50)
`[ BlockSummary ]` newest first:
```
BlockSummary = { "height": 2283, "hash": "…", "prevHash": "…" | null, "time": 1792668688 | null,
  "mainBlock": { "hash": "…", "height": 973921 } | null,   // the eCash block that carried it (BMM)
  "txCount": 1, "outputs": 2, "inputs": 1, "fees": 0, "deposits": 0, "volume": 100000 }
```

## GET /api/v1/l2/block/:hashOrHeight
```
{ ...BlockSummary, "merkleRoot": "…", "prevMainHash": "…", "nextHash": "…" | null,
  "coinbase": { "txid": "…", "outputs": [Output] },
  "txs": [ TxSummary ],
  "deposits": [ Deposit ],            // credited when this block connected
  "bundleSpends": [ { "outpoint": OutPoint, "m6id": "…" } ] }
```

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
            | "bitassetReservation" | "ammLpToken" | "dutchAuctionReceipt" | "marketFunds" | "other",
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
Served from the node's own read RPCs (cached a few seconds), shapes as the node gives them, wrapped
`{ "items": [...] }` for lists:
- `names` (BitNames): `feature/names` → `bitnames`, `feature/names/:id` → `bitname_data`.
- `assets` (BitAssets): `feature/assets` → `bitassets`, `feature/assets/:id` → `bitasset_data`,
  `feature/auctions` → `dutch_auctions`, `feature/pools` → the AMM pools seen in the index with `get_amm_pool_state`.
- `markets` (Hivemind): `feature/markets` → `market_list`, `feature/markets/:id` → `market_get`, `feature/votes` → `vote_period`.
- `shielded` (zSide): `feature/shielded` → totals from the index (shielded in / out, actions, value balance sum).
