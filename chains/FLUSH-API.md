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

Rules: read-only; every node RPC and public API path is on an allowlist; results cached a few seconds (logos 5 min) in
a cache bounded in entries (1000) and bytes (32 MB), one upstream request per key at a time and at most 8 at once (2
for quotes; more: 503); node or API error text is never returned: 400 malformed, 404 unknown, 502 upstream down,
503 busy. Errors are `{ "error": "<fixed text>" }`. nginx rate-limits `/api/v1/flush/` per IP (5/s, burst 20).

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

## Node reads: GET /api/v1/flush/rpc/:method?args=<JSON array>
The node's JSON returned as is. `args`: a JSON array (≤ 1024 characters of JSON; at most the method's own number of
arguments; strings ≤ 256 characters without control characters, finite numbers, booleans, null, and objects (≤ 20
keys `[a-z_][a-z0-9_]*`) or arrays (≤ 20 items) of those, one level deep). Arguments go to the node as given (name an
asset by its id as `0x<id>`, as the node takes it). Allowlist (backbone-flush src/rpc/*.cpp):
- chain and peg: getblockchaininfo (`anchored_tip`, `final_tip`), getmainchaininfo, getpeginfo, listwithdrawals,
  getwithdrawalbundle, getsidechainstate
- stake: getposinfo, getvalidators [epoch], getvalidator pubkey, getleaderschedule [epoch], getanchorinfo [count ≤ 100],
  listevidence
- assets: getasset asset [height], listassets [count skip match], getassethistory asset, searchassets [options],
  getbitassetsinfo, getassetindexinfo, getverifications asset [curators] [curator]
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
  "asset": { "operation": {…}, "outputs": [{ "n", "carries": "asset|control|reservation|lp|receipt|result", "id"?, "amount"? }],
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

## A block's stake fields: GET /api/v1/flush/block/:hash
getblock's PosBlockFields: `{ hash, height, kind: "pos"|"bmm", slot, proposer, mainheight, ack: { ticket, anchored,
payee, mainheight } | null, evidence: [{ slot, hashes: [a, b] }], finality: { status: "soft"|"anchored"|"final",
anchors } | null }` (null where the node gives nothing).

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
