# eCash explorer: networks, data sources and chain modules

One codebase (upstream mempool + this fork's `chain/` code) runs an explorer for eCash (ECX), a fork of Bitcoin with
BIP300/301 drivechains, on each of its networks. Sidechain explorers (the LayerTwo-API nodes such as Thunder and
BitNames) come later as their own module kind.

## Networks

`CHAIN.NETWORK` (backend) and `CHAIN_NETWORK` (frontend) pick one of `backend/src/chain/networks.ts`:

| id | network | addresses |
|---|---|---|
| `ecash` | mainnet | `bc1…` |
| `ecashbeta` | betanet | `bc1…` |
| `ecashtest` | testnet (Bitcoin testnet4 under eCash rules) | `tb1…` |

ECX keeps Bitcoin's formats and schedule: 8 decimals, 10-minute blocks, 2016-block retargets, 210,000-block
halvings. The BIP300 constants (activation height, bundle and proposal thresholds) come from the enforcer.

## Where the data comes from

| | source | how |
|---|---|---|
| blocks, transactions, mempool | the eCash node | Core JSON-RPC (`CORE_RPC`), as upstream mempool |
| sidechains, escrows, deposits, withdrawal bundles, BMM | the enforcer | `ValidatorService` over Connect-JSON (`CHAIN.ENFORCER`, `backend/src/chain/enforcer.ts`) |
| BIP300 coinbase messages, BMM requests, miners | the node's raw blocks | decoded in `backend/src/chain/bip300.ts` and `drivechain.ts` |

Two setups serve the same enforcer API, byte for byte, so the explorer runs on either:

- a stock eCash node with `bip300301_enforcer` next to it (the pool server: `ecashd` on 8542, enforcer on 8123);
- Backbone (`backboned -grpc`), which enforces BIP300/301 itself and serves the API on 50051.

## Chain modules

| | backend | frontend |
|---|---|---|
| module folder | `backend/src/chain/modules/<id>/index.ts` | `frontend/src/app/chain/modules/<id>/index.ts` |
| registry | `backend/src/chain/modules/index.ts` | `frontend/src/app/chain/modules/index.ts` |
| contract | `backend/src/chain/module.ts` (`ChainModule`) | `frontend/src/app/chain/chain-module.ts` (`ChainFrontendModule`) |
| selected by | `CHAIN.PROFILE` in mempool-config.json | `CHAIN_PROFILE` in the frontend config / Docker env |

Today there is one module, `ecash`. A module can add:

Backend (`ChainModule`):

- `initRoutes(app, prefix, ctx)`: read-only routes under `/api/v1/chain/` that call the node with
  `ctx.node.call('method', ...)`; `ctx.cached`, `ctx.handler`, `ctx.fail` and `ctx.intParam` help.
- `describeTx(tx, ctx)` / `describeBlock(block, ctx)`: what a transaction or block does on the chain, served at
  `GET /api/v1/chain/tx/:txid` and `GET /api/v1/chain/block/:hash/features`.
- `start(ctx)` / `onNewBlock(block, ctx)`: background indexes.

Frontend (`ChainFrontendModule`):

- `routes` + `nav`: the module's pages (lazy `loadComponent`) and their nav entries;
- `txView` / `blockView`: standalone components showing the `describeTx` / `describeBlock` data.

## Deployment

`chains/build.sh` builds `ecash-explorer/backend` and `ecash-explorer/frontend`. `chains/pool-server/gen.py` lists
every explorer the pool server runs (URL path, profile, network, ports) and writes its Docker Compose file, backend
configs and nginx site for `https://explorer.blockfab.org/<explorer>/`; `www.sh` stages the static frontends.
