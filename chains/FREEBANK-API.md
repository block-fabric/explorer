# FreeBank explorer: backend API

FreeBank (mbdrivechains/freebank, `freebankd`, MIT) is a drivechain sidechain of eCash on slot 130: a Bitcoin Core
0.16 base whose blocks come by blind merged mining (no PoW: the header has no bits or nonce), with credit families
on top: discount houses (reserves, attestations, notes, member-only houses, token claims at a failed house), bills of
exchange (issue, endorse, discount, retire, recourse), term deposits, settlements (netting rounds), pools and an
oracle for a later gold unit. The unit is ECX. Its operator runs its own explorer at explorer.ecxfreebank.com
(mbdrivechains/freebank-explorer, a mempool fork, AGPL); ours runs upstream mempool's FULL backend directly on the
node's RPC (`CORE_RPC`) and the FreeBank module (`CHAIN.PROFILE: "freebank"`, kind `freebank`,
`backend/src/chain/modules/freebank/`).

What the Core 0.16 base changes for upstream (handled in backend/src/api): blocks have no bits, nonce, difficulty or
chainwork (neutral values: 0x1d00ffff, 0, 1); `gettxout` answers null for an OP_RETURN output, which is unspent, not
spent; no transaction is flagged non-standard (FreeBank's policy takes versions 1 to 17 and credit custody outputs);
the header has 136 bytes (the blocks table keeps the first 80). No address index: the chain has millions of
transactions (about 5,000 a block) and no prevouts in getblock (no verbosity 3), so `/api/address/*` answers 405, as on
FreeBank's own explorer. Mining pages: the block producers from the coinbase tag (`ecxfreebank.com`: FreeBank), no
difficulty change.

Addresses (chainparams, beta and main alike): base58 P2PKH version 75 (`X…`), P2SH 125 (`s…`), bech32 `fbk1…`
(regtest `fbkrt1…`).

Rules: read-only; every node RPC on an allowlist; results cached 10 s in a cache bounded in entries (1000) and bytes
(32 MB, 4 MB an entry), one upstream request per key at a time and at most 6 at once (more: 503); node error text is
never returned: 400 malformed, 404 unknown, 502 node down, 503 busy. Errors are `{ "error": "<fixed text>" }`. nginx
rate-limits `/api/v1/freebank/` per IP. The node is behind a method filter on the lab node (freebankd has no
rpcwhitelist): it passes the allowlist below and what upstream mempool calls; anything else answers "method not
allowed" (sendrawtransaction is not passed: the explorer cannot broadcast).

## GET /api/v1/chain
As for Flush (chains/FLUSH-API.md), with `kind: "freebank"`, `slot: 130`, `addressIndex: false`,
`features: ["houses", "bills", "peg", "pools", "assets", "gold"]` and `rpcMethods` (the allowlist).

## Node reads: GET /api/v1/freebank/rpc/:method?args=<JSON array>
The node's JSON as is; `args` checked as Flush's (≤ 1024 characters, at most the method's arguments). Allowlist
(freebank src/rpc/misc.cpp):
- chain and peg: getblockchaininfo, getmainchaininfo, getmainchainblockcount, getwithdrawal id,
  getwithdrawalbundle, getaveragemainchainfees numblocks startheight
- houses: listhouses, gethouse id, listhousemembers id [start count], gettokenclaims id [start count]
- bills: listbills, getbill id, listloanbook [house_id]
- pools, assets, gold: listpools, getpool id, listassets [from_asset_id count], getgoldfix, listoraclesubmitters

Shapes seen on betanet (2026-10-23, v0.2.29):
- listhouses → `[{ id, househash, type: "open"|…, tier, threshold, classid, status, effective_status, closed,
  activeescrow (ECX), mintedunits, tokenunits, depositunits, loanbookface, mintcapunits, capitalcapunits,
  reservecapunits, attestedratiobps, attest_deadline, lastattestheight, lastattestreserves (ECX), lastsettleheight,
  registeredheight, txidregister, partners: [{ index, pubkey, … }], … }]`
- listbills → `[{ id, bill_id, amount (ECX), escrow (ECX), status: "a"|"r"|…, issued_height, maturity_height,
  grace_blocks, drawer_pubkey, acceptor_pubkey, holder_pubkey, owner_house_id, issue_txid, escrow_outpoint,
  title_outpoint, endorsements: [{ from, to, at_height }] }]`
- listloanbook → `{ house_id, count, face_total (sats), bills: [bill…] }`
- getgoldfix → null before the first fix; listpools, listassets, listoraclesubmitters → [] so far.

## A transaction's FreeBank meaning: GET /api/v1/freebank/tx/:txid
Read from the raw hex of `getrawtransaction txid true` (the node names the op but leaves the payload as bytes) by
`backend/src/chain/modules/freebank/parser.ts`, a port of FreeBank's own explorer's parser
(mbdrivechains/freebank-explorer @ e3ad60793, AGPL-3.0). Never a 5xx for a bad payload: `error` says what did not read.
```
{ "txid", "confirmed": bool, "version": n,
  "family": "bill"|"house"|"note"|"deposit"|"pool"|"settle"|"oracle"|null,   // by version: 11-17; null otherwise
  "assetGenesis": bool,                                                      // version 10
  "credit": { "family", "op": n, "opName": "attest"|…|"op_<n>", "fields": { … } } | null,   // v11-v17
  "asset": { "assetId" (= txid), "ticker", "headline", "payload" (hex, reversed), "decimals",
             "supply" (vout[1]'s value; vout[0] is the control coin) } | null,              // v10
  "peg": [ { "kind", "vout", … } ] | null,                                   // null: none (at most 50 listed)
  "error": null | "The raw transaction is missing or too large" | "The raw transaction does not parse (…)"
               | "The raw transaction does not match its txid" | "The <family> <op> payload does not fit its layout" }
```
When the tx does not parse, `credit`, `asset` and `peg` are null and `version`/`family` come from the node's JSON.
When only the payload does not fit, `credit` is there with `fields: {}`. An op byte the headers do not define is
`op_<n>` with `fields: {}` and no error.

`fields` keep the payload's names (snake_case). Units: `*_sats` ECX in satoshis; `*_units`, `units` note units (1 unit
= 1 sat of face, par); `*_height` block heights; addresses base58 `X…` (P2PKH, version 75). Lists hold at most 20
items, with the full count beside them.

| family (version) | op: name → fields |
|---|---|
| bill (11) | 1 issue → face_sats, maturity_height, grace_blocks · 2 endorse → bill_id, from_pubkey, to_pubkey · 3 retire, 4 claim, 6 recourse → bill_id · 5 discount → bill_id, house_id, price_units, face_sats, maturity_height · 7 hretire, 8 hclaim, 11 hclaim_escrow → bill_id, house_id, face_sats, maturity_height · 9 hretire_notes, 10 hretire_escrow → the same + units_burned |
| house (12) | 1 register → tier, threshold, classid, denominationmggold, partners, pledge_sats · 11 register_mo → the same + house_type ("open"/"members"/"redeem") · 12 member_add, 13 member_remove, 14 member_purge → house_id, members, member_addresses[≤20] · 2 topup, 4 exit, 6 reclaim → house_id, partner_index · 7 attest → house_id, as_of_height, reserves_sats (schema 1) · 3 admit, 5 winddown, 8 defer, 9 renew, 10 release, 15 close → house_id |
| note (13) | 1 mint, 2 transfer, 8 protest, 5 unlock → house_id, units, outputs · 4 lock → house_id, units, change_units, outputs · 7 demand → house_id, units, outputs, demand_mode ("plain"/"preauth"/"preauth_queue"), prior_demand_height · 9 token_keyset → house_id, keys, largest_amount · 10 token_post → house_id, keyset_id, issued, issued_units, spent · 11 token_claim → house_id, tokens, claimed_units · 12 token_collect → house_id, claims, escrow_change · 3 redeem, 6 claim → house_id |
| deposit (14, term deposits) | 1 originate → house_id, principal_units, receipts · 2 transfer → house_id, principal_units, rate_bps, maturity_height · 5 demand → the same + origination_height, payout_address · 6 protest → the same + origination_height, demand_height · 7 discharge → house_id, payout_address · 3 withdraw, 4 claim → house_id |
| pool (15) | 1 create → pool_id, house_id, fee_bps, note_units, ecx_sats · 2 add_liq → pool_id, house_id, note_units, ecx_sats, lp_minted · 3 remove_liq → pool_id, house_id, lp_burned, note_units_out, ecx_sats_out · 4 swap → pool_id, house_id, direction ("notes_for_ecx"/"ecx_for_notes"), amount_in, amount_out · 5 retire → pool_id, house_id |
| settle (16) | 1 exchange → house_a_id, house_b_id, mode, house_a_notes_units, house_b_notes_units, residual_sats, debtor_house_id, creditor_house_id, expiry_height · 4 net → houses, house_ids[≤20], units_retired[], nets[], received_sats[] (parallel to house_ids), total_retired_units, paid_sats, bundles, expiry_height · 2, 3 reserved |
| oracle (17) | 1 bond → submitter_id, target_height, pubkey · 2 submit → submitter_id, target_height, price_mg (mg of gold per 1000 ECX) |

`peg` entries (OP_RETURN, then a raw 4-byte tag; hashes and txids reversed, as the node prints them):

| kind | where | fields |
|---|---|---|
| deposit | coinbase (`acdcf66f 'D'`) | slot, dest (as the depositor typed it), amount (sats into the treasury), ecashTxid, ecashBlock, ecashTxIndex, burnIndex, treasuryValue, bundlePayment (dest "D", amount ≤ 0: the M6 of a bundle; then ecashOutputs[≤20]), payoutVout (the output that pays it: amount − 1,000 sats to dest, by the node's claim rule; null if none) |
| stray | a deposit record outside a coinbase (not a deposit from eCash) | object: "deposit" |
| withdrawal | any tx (`'W'`) | slot, id, destRaw (eCash destination as stored), refundDest, amount (burned), ecashFee, payout |
| bundle | any tx (`'P'`) | slot, bundleHash, m6id, format ("cusf"/"legacy"/"unknown"), ecashFee, total, withdrawals, withdrawalIds[≤20], payouts[≤20] { vout, value, scriptpubkey, withdrawalId } |
| refund-request | any tx (`fcd2e546`) | withdrawalId |
| bundle-hash, bundle-paid, bundle-failed | coinbase (`ef5d1dfe`, `fb5345de`, `fa86c689`) | bundleHash |
| prev-blocks | coinbase (`fd7ad1ef`) | prevMainBlock, prevSideBlock |
| block-version | coinbase (`a7e67e1f`) | data (the 4 bytes, hex) |
| witness-commitment | coinbase (BIP 141) | commitment |
| unreadable | a tagged object that does not decode | error |

## A block's BMM fields: GET /api/v1/freebank/block/:hash, /api/v1/freebank/blocks?hashes=a,b,… (≤ 30)
`{ hash, height, mainblock: "<eCash block hash>" | null, withdrawalbundle: "<hash>" | null, onChain: bool }`, from
the 136-byte header (version, prev, merkle root, time, hashWithdrawalBundle, hashMainBlock). The batch answers
`{ <hash>: fields | null }`.

## BMM and the peg
From the eCash explorer's drivechain API for slot 130 (cockpit, events), read by the frontend from the mainchain
explorer's own /api/v1/drivechain/* (same site), as Flush's.

## Deployment (chains/pool-server/gen.py)
`betanet-freebank` at /betanet/freebank/, one backend (api 127.0.0.1:18958, MariaDB `explorer_betanet_freebank`,
oom_score_adj 800). `CORE_RPC` is the lab node's slot-130 freebankd through its method filter
(216.128.183.114:38130, firewalled to the pool server; `secrets/betanet-freebank.rpc` holds "user:password" of its
rpcauth user `explorer`).
