# Flush explorer: backend API

Flush (backbone-flush, `flushd`) is a Bitcoin-Core-based drivechain sidechain of eCash: blocks of stake every 15 s,
BMM anchors, assets, a DEX (pool kinds, concentrated liquidity, order books), bonding-curve launches, a treasury,
oracles and verified issuers. Its explorer runs upstream mempool's FULL backend directly on the Flush node's Core RPC
(`CORE_RPC`, the node with `-txindex`): blocks, transactions, mempool, addresses (the address index,
`CHAIN.ADDRESS_INDEX: true`), websocket, statistics, block indexing; plus the Flush module (`CHAIN.PROFILE: "flush"`,
`backend/src/chain/modules/flush/`) serving the routes below from the node's own read RPCs and from its public DEX API
(`flushd -publicapi`, backbone-flush doc/public-api.md: trades, candles, holders).

The eCash drivechain index (`/api/v1/drivechain/*`) and the `/api/v1/chain/*` module hooks do not run there; upstream's
mining pages see no pools (every block "Unknown": blocks of stake come from validators) and no difficulty change.
Addresses are the node's own (`flx1…` mainnet, `bflx1…` betanet, `tflx1…` testnet, `rsc1…` regtest): the backend takes
any `[a-z0-9]{2,120}` and the address index keys them by the node's `scriptPubKey.address`; the frontend's address
regexes must accept those prefixes.

Betanet runs Flush temporarily on slot 99 (`-sidechainslot=99`, RPC 38994, public API 38996); its own slot is 46.

Config:
```
CHAIN.PROFILE: "flush", CHAIN.NETWORK: "ecashbeta", CHAIN.ADDRESS_INDEX: true, CHAIN.MAINCHAIN_EXPLORER: "https://…/betanet",
CHAIN.FLUSH = { PUBLIC_API: "http://host:port" | "", PUBLIC_API_HOST: "flush.markets", PUBLIC_API_TIMEOUT: 10000, SLOT: 99 }
```
`CHAIN.FLUSH.SLOT` is also set on the other explorers of the network (the eCash explorer names slot 99 Flush).

Rules: read-only; every node RPC and public API path is on an allowlist; results cached a few seconds (block fees 15 s,
logos 5 min) in a cache bounded in entries (1000) and bytes (32 MB), one upstream request per key at a time and at most
8 at once (2 for quotes; more: 503); node or API error text is never returned: 400 malformed, 404 unknown, 502 upstream
down, 503 busy. Errors are `{ "error": "<fixed text>" }`. nginx rate-limits `/api/v1/flush/` per IP (5/s, burst 20).

## GET /api/v1/chain
As for the l2 explorers (chains/L2-API.md), with `kind: "flush"`:
```
{ "id": "flush", "kind": "flush", "name": "Flush", "unit": "ECX", "slot": 99, "mainchain": false,
  "network": "ecashbeta", "networkName": "Betanet", "networks": [{ "id", "name", "explorer" }],
  "explorers": { "ecash": url, "ecashbeta": url, "thunder": url | null, … },   // the eCash explorer and the siblings
  "sidechains": [{ "id", "name", "slot" }], "module": { "describeTx": false, "describeBlock": false },
  "activationHeight": null, "indexReady": true,
  "features": ["assets", "dex", "launches", "stake", "peg", "market"],         // "market": CHAIN.FLUSH.PUBLIC_API is set
  "mainchainExplorer": "https://explorer.blockfab.org/betanet" | null,
  "rpcMethods": ["getblockchaininfo", …] }                                     // the allowlist below
```

## GET /api/v1/flush/status
Whether the chain is halted, from getposinfo: `{ halted, posActive, stalled, slot, firstUnanchoredSlot,
maxUnanchoredSlots, slotsSinceFirstUnanchored, slotsUntilHalt, haltAtSlot, lastAnchoredHeight, lastAnchored, anchorPoint,
gap }`. `halted` is true when PoS is inactive, or when `slot - firstUnanchoredSlot >= maxUnanchoredSlots`: blocks of
stake stop then (pos/hooks.cpp), whatever `stalled` says (that means a BMM block built now may carry transactions).
`halted` is null if the node does not give the slot, max or PoS fields; no unanchored block (`firstUnanchoredSlot` -1) is not a halt. Cached 5 s.

## Node reads: GET /api/v1/flush/rpc/:method?args=<JSON array>
The node's JSON returned as is. `args`: a JSON array (≤ 1024 characters of JSON; at most the method's own number of
arguments; strings ≤ 256 characters without control characters, finite numbers, booleans, null, and objects (≤ 20
keys `[a-z_][a-z0-9_]{0,40}`, case-insensitive) or arrays (≤ 20 items) of those, two levels deep: the search RPCs'
filters hold keyword lists). Arguments go to the node as given (name an
asset by its id as `0x<id>`, as the node takes it). Allowlist (backbone-flush src/rpc/*.cpp):
- chain and peg: getblockchaininfo (`anchored_tip`, `final_tip`), getmainchaininfo, getpeginfo, listwithdrawals,
  getwithdrawalbundle, getsidechainstate
- stake: getposinfo, getvalidators [epoch], getvalidator pubkey, getleaderschedule [epoch], getanchorinfo [count ≤ 100],
  listevidence
- assets: getasset asset [height], listassets [count skip match], getassethistory asset, searchassets [options],
  getbitassetsinfo, getassetindexinfo, getverifications asset [curators] [curator]. getasset's `registration` is the
  txid of the asset's current registration and `registered` its height (a later registration of the same name is the
  current one).
- DEX: listpools [asset count skip], getpool a [b], searchpools [query filters…], getpooltwap pool [from seconds],
  getpoolcurve pool [points], getpoolticks pool [count], getpoolcandles id [interval from to] (assets-unified nodes
  only; elsewhere 404), getposition id, getbook a b [levels], getorder id, getdexinfo, gettreasury,
  listauctions [include_closed count skip asset], getauction id, searchauctions [query filters], listoracles [start count],
  getoraclevalue oracle event, getoraclecontract id
- launches: getlaunch token, listlaunches [options], getlaunchstats, getlaunchlog from [to] (≤ 1000 blocks)
- quotes (read-only maths, at most 2 at once, cached 3 s): quoteswap, getswapquote, quoteroute, quotelaunch, quotebid

Node errors: -5 / -8 (unknown id, or a parameter the node refuses) 404 `Not found`; -32601 (an older node without the
method) 404; -1 / -3 / -32602 400 `Invalid arguments`; anything else 502.

## Asset logos: GET /api/v1/flush/logo/:asset
`:asset` a 64-hex id or a ticker. The PNG/JPEG bytes of getassetlogo (base64 decoded) with its mime type, checked
against the bytes' magic, ≤ 64 KB; `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`,
`Cache-Control: public, max-age=300`. 404: no such asset or no logo.

## A transaction's Flush meaning: GET /api/v1/flush/tx/:txid
```
{ "txid": "…", "confirmed": true,
  "asset": { "markerKind": n | null, "chn_to": "<script hex>" | null, "operation": {…},
             "outputs": [{ "n", "carries": "asset|control|reservation|lp|receipt|result", "id"?, "amount"? }],
             "error": "bad-ba-marker" | null } | null,          // decodeassettx of a tx with a BAST marker, else null
  "peg":   [PegOp] | null,                                      // null: none (an array: a tx may carry several)
  "stake": [StakeOp] | null }
PegOp =
  { "kind": "withdrawal", "vout", "value" (sats: amount + mainFee), "amount", "mainFee", "refundKeyHash" (hex),
    "refundAddress": "bflx1…" | null, "mainScript" (hex), "mainAddress": "bc1…" | null,
    "valid": bool }                                             // fee below the value and a standard destination
| { "kind": "refund", "vout", "withdrawal": { "txid", "vout" } }
| { "kind": "bundle", "vout", "hash" }                         // the coinbase's commitment to a withdrawal bundle
StakeOp =
  { "kind": "bond", "vout", "amount" (sats, the output's value), "pubkey" (x-only), "owner" (key hash),
    "ownerAddress": "bflx1…" | null, "signed": bool }
| { "kind": "unbond", "vout", "pubkey", "amount": sats | null, "all": bool, "sequence" }
| { "kind": "evidence", "vout", "headers": [{ "hash", "prevHash", "time" }, { … }] }   // a double proposal
| { "kind": "validatorPool", "vout", "amount" }                 // coinbase output into the validator pool
| { "kind": "validatorShares", "vout", "count" }                // before the validators' shares a peg step pays
```
Markers (OP_RETURN, one push starting with the tag): D8 'WDR', D9 'RFN', DA 'BND' (sidechain/state.h), DB 'STK',
DC 'UNB' (pos/bond.h), DD 'EVD' (pos/evidence.h), DE 'VPL', DE 'VPS' (pos/feesplit.h); decoded in
`modules/flush/markers.ts`. Keys print in wire order, txids and hashes in display order. 404: unknown txid.

`asset.markerKind` is the marker's own kind byte (BAST, version, kind), where `operation.kind` is decodeassettx's base
kind: a Register is 2/33/35 (33 with a logo, 35 with a display name), a LaunchToken 22 or its newer variants.
`asset.chn_to` is the output script the coinbase pays CHN change to, for operations that name one (swap, remove
liquidity, bid, collect, route, pool withdraw, swap pools, launch, open/change position, settle order); it is null when
the operation has none or when a newer node's layout cannot be read. It is a script in hex, not an address.

## Several transactions at once: GET /api/v1/flush/txs?txids=a,b,… (1 to 30)
The same fields, as `{ "<txid>": fields | null }` (null: unknown, or the node did not answer that one; duplicates dropped,
ids that are not 64 hex ignored). 400 when no valid id is left or there are more than 30. Each tx is read and cached 10 s,
as /flush/tx/:txid is.

## A deposit by its eCash txid: GET /api/v1/flush/deposit/:txid
An eCash transaction's deposit to this slot, from the eCash explorer's drivechain index (`CHAIN.MAINCHAIN_API`, or
`CHAIN.MAINCHAIN_EXPLORER`): `{ txid, slot, address, destination, amount (sats), mainchain: { height, blockHash },
explorer }`. A deposit's credit on Flush is a coinbase output to `address`; the eCash txid is not on Flush, so this is
where to look one up by it. 404: no mainchain explorer, or the tx is not a deposit to this slot; 502: the eCash
explorer did not answer.

## What an address's outputs carry: GET /api/v1/address/:address/utxo (and scripthash/:hash/utxo)

Esplora's UTXO list, each output with what it carries besides its ECX (chain/modules/flush/tokens.ts), for wallets:

```json
{ "txid": "…", "vout": 1, "value": 1000, "status": { "confirmed": true, … },
  "token": { "kind": 0, "id": "<64 hex>", "amount_units": "2238304577" }, "spendable": true }
```

- `token`: `{ kind, id, amount_units }`, or `null` for plain ECX. `kind` is the node's Token::Kind: 0 asset, 1 control,
  2 reservation, 3 LP shares, 4 auction receipt, 5 position, 6 order. `amount_units`: an integer as a string (1 for
  kinds other than 0 and 3).
- Confirmed outputs: the node's state (`gettxout`'s `token`, flushd 7.0.1 on), so the results of swaps and launches are
  in it. With an older node, confirmed outputs have no `token` and no `spendable` field: not known.
- Unconfirmed outputs: the transaction's marker (`decodeassettx`); outputs it does not list carry nothing. An output
  that takes an order's result (known only when its block applies it), or whose amount cannot be read exactly, has
  `token: null` and `spendable: false`.

## Broadcasting a marker: POST /api/v1/tx?maxburnamount=
The node's sendrawtransaction refuses any unspendable output by default (`maxburnamount` is 0), so a DEX transaction
whose marker output carries CHN (a swap, a launch's first buy, …) is rejected unless the caller allows that amount.
`POST /api/v1/tx?maxburnamount=<ECX>` (raw hex body) and `POST /api/v1/tx/push?maxburnamount=<ECX>` (form) pass it to
sendrawtransaction; `maxfeerate` is optional too (`?maxfeerate=`). Both are amounts, not sats. A plain token transfer
needs neither: its marker output is zero. Add the whole marker output value to `maxburnamount`.

## A block's stake fields: GET /api/v1/flush/block/:hash
getblock's PosBlockFields: `{ hash, height, kind: "pos"|"bmm", slot, proposer, mainheight, ack: { ticket, anchored,
payee, mainheight } | null, evidence: [{ slot, hashes: [a, b] }], finality: { status: "soft"|"anchored"|"final",
anchors } | null }` (null where the node gives nothing).

## Several blocks' stake fields: GET /api/v1/flush/blocks?hashes=a,b,… (1 to 30)
The same fields for up to 30 blocks at once, as `{ "<hash>": fields | null }` (null: an unknown hash, or the node did
not answer that one; duplicates dropped, hashes that are not 64 hex ignored). 400 when no valid hash is left or there
are more than 30. Each block is read on its own and cached 5 s, as /flush/block/:hash is.

## Block fees: GET /api/v1/flush/block-fees?range=48h&page=0&size=25[&fees=1]
The blocks of the last 24 h, 48 h, 7 days or 30 days and their fees, newest first, a page at a time, from this
explorer's own block index (MariaDB `blocks`, stale blocks left out), not the node. `range` is one of `24h`, `48h`,
`7d`, `30d` (default `48h`; another 400); `page` 0 to 100000 (default 0) and `size` 1 to 100 (default 25), decimal
or 400, values outside clamped; `fees=1` keeps only blocks with fees. 404 when this explorer keeps no block index.
```
{ "range": "48h", "page": 0, "size": 25, "feesOnly": false,
  "total": n,                                              // matching blocks (those with fees when fees=1)
  "totals": { "blocks": n, "withFees": n, "fees": sats,    // the whole range
              "fromHeight": h | null, "toHeight": h | null,
              "byKind": { "pos": sats, "bmm": sats, "unknown": sats },
              "unknownBlocks": n,                          // fee blocks whose kind is not known yet
              "beyondKinds": n },                          // fee blocks after the first 500, not in byKind
  "indexedFrom": { "height": h | null, "time": unix | null },   // the index's first block
  "blocks": [{ "height", "hash", "time" (unix), "fees" (sats), "txs" (without the coinbase),
               "kind": "pos"|"bmm"|null }] }                // kind null: not read from the node yet
```
Kinds come from getblock: a request reads at most 60 unknown ones and keeps each by hash once known, so a page's rows or
`byKind` may leave some out (`unknownBlocks`, `beyondKinds`) until later requests fill them in; `byKind` counts only the
range's first 500 fee blocks. Cached 15 s.

## Public DEX API: GET /api/v1/flush/market/<path>
Allowlisted GETs of the public API's `/api/v1/<path>` (sent with `Host: CHAIN.FLUSH.PUBLIC_API_HOST`), its JSON as is
(re-serialized), `Cache-Control: public, max-age=5`. 404 when `CHAIN.FLUSH.PUBLIC_API` is empty.
Paths (`{id}` a 64-hex id, `{name}` an id or a ticker, case as given):
```
status  stats  fees  treasury
launches  launches/stats  launches/log  launches/{name}  launches/{name}/trades|candles|holders  launches/{name}/logo
pools  pools/{id}  pools/{name}/{name}  pools/{id}/trades|candles|ticks
positions/{id}  books/{name}  books/{name}/{name}  tickers/{name}  addresses/{address}/holdings  verifications
assets  assets/{name}  assets/{name}/logo
```
Query parameters, each once, ≤ 200 printable characters: filter sort q cursor limit before interval from to
from_height to_height market kind fee_ppm ecx_only include_abandoned depth assets curators (others: 400, before the API
is asked). Not served: quotes (`quote/*`, `launches/{id}/quote`), builds (`build/*`), `broadcast`.
Logos (`…/logo`): PNG or JPEG after their magic bytes, ≤ 64 KB, nosniff, cached 5 min.
The API's 400 and 404 come back as 400 `Invalid request` / 404 `Not found`, its 429 as 503, anything else 502.

What the LIVE betanet API (photon-slot branch) answers, 2026-10-23: every path above but `assets`, `assets/{name}`
(the assets-unified registry: 404 until that branch deploys); `assets/{name}/logo` and `launches/{name}/logo` exist.
Its chain had no launches, pools or holders yet (lists empty, ids 404).

Flush v2 (activated at block 3300 on the slot-99 betanet chain, 2026-10-23): `status` gains `launch_params` (shown on
/launches); `assets` (q, sort, market, cursor, limit ≤ 100: AssetSummary with `holders` and `market{status, kinds,
progress, pools, books, auctions, price_ecx, volume_24h_ecx}`) and `assets/{id}` (plus description, links, launch,
pools, books, auctions, can_curve) now answer (joined into /assets by id, and shown on /asset/:id); book levels gain
`price_exact`/`amount_units` and books `best_ask_exact`/`best_bid_exact` (shown as given).

## BMM
Flush's BMM on eCash comes from the eCash explorer's drivechain API for its slot (cockpit, events), read by the
frontend from the mainchain explorer's own /api/v1/drivechain/* (same site).

## Deployment (chains/pool-server/gen.py)
`betanet-flush` at /betanet/flush/, one backend (api 127.0.0.1:18957, MariaDB `explorer_betanet_flush`, 512m, 0.5 CPU,
oom_score_adj 800). `CORE_RPC` is the lab node's slot-99 flushd (216.128.183.114:38994, -txindex, firewalled to the
pool server; `secrets/betanet-flush.rpc` holds "user:password" of its rpcauth user `explorer`); the public API
216.128.183.114:38996 with Host flush.markets. An entry with `'enabled': False` (a network whose Flush node is not
reachable) is left out of everything gen.py writes; `gen.py --enable <id>` deploys it anyway.

The node's rpcwhitelist for that user: the allowlist above plus getassetlogo and decodeassettx (this module), and what
upstream mempool calls. Seen on a regtest chain (blocks, block and mining indexing, mempool, addresses, every route):
getblockhash, getblock, getrawtransaction, getblockcount, getrawmempool, getmempoolinfo, getblockheader,
getblockstats, getchaintips, getnetworkhashps, getblockchaininfo, getmempoolentry, getbestblockhash, getnetworkinfo,
getindexinfo, validateaddress. Also on upstream's other routes: getmempoolancestors, gettxout, gettxspendingprevout,
gettxoutsetinfo, getdifficulty, decoderawtransaction, testmempoolaccept, submitpackage, sendrawtransaction (POST
/api/tx, rate limited by nginx: leave it out of the whitelist to make the explorer read-only; the broadcast then
answers an error). A method missing from the whitelist answers HTTP 403, which the explorer sees as the node down for
that call.
