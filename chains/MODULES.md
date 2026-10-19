# Chains Explorer: chain modules

One codebase (upstream mempool + this fork's `chain/` code) runs an explorer for the Chains mainchain and for each
sidechain. `CHAIN_PROFILE` picks the chain at runtime; everything chain-specific lives in one folder per chain.

| | backend | frontend |
|---|---|---|
| module folder | `backend/src/chain/modules/<id>/index.ts` | `frontend/src/app/chain/modules/<id>/index.ts` |
| registry | `backend/src/chain/modules/index.ts` | `frontend/src/app/chain/modules/index.ts` |
| contract | `backend/src/chain/module.ts` (`ChainModule`) | `frontend/src/app/chain/chain-module.ts` (`ChainFrontendModule`) |
| selected by | `CHAIN.PROFILE` in mempool-config.json | `CHAIN_PROFILE` in the frontend config / Docker env |

## What every sidechain gets for free

With only a profile (id, name, slot, address prefix, colour, mark):

- the full mempool explorer: blocks, transactions, mempool, addresses (the node must run with `-txindex`);
- the cockpit at `/bmm`: the Chains blocks that carried the sidechain, the bids paid, BMM coverage and gaps, the
  escrow, deposits, withdrawals, withdrawal bundles with their path to payout (needs `CHAIN.MAINCHAIN_RPC`);
- on each block page: the Chains block that carried it and the bid;
- links to and from the other explorers (`CHAIN.EXPLORER_URLS` / `CHAIN_EXPLORER_URLS`).

## Adding a sidechain

1. `cp -r backend/src/chain/modules/sidechain-template backend/src/chain/modules/mychain`, then edit the profile:
   `sidechainProfile('mychain', 'MyChain', <slot>, '<bech32 prefix on main>')`.
2. Add it to `backend/src/chain/modules/index.ts`.
3. Do the same on the frontend (`frontend/src/app/chain/modules/sidechain-template`): profile with `color` and
   `mark` (SVG stroke paths, viewBox 0 0 32 32).
4. Run with `CHAIN.PROFILE: "mychain"` (backend) and `CHAIN_PROFILE=mychain` (frontend).

## Optional: the chain's own features

Backend (`ChainModule`):

- `initRoutes(app, prefix, ctx)`: read-only routes under `/api/v1/sidechain/` that call the node's own RPCs with
  `ctx.node.call('mymethod', ...)`. `ctx.cached`, `ctx.handler`, `ctx.fail` and `ctx.intParam` are there to help.
- `describeTx(tx, ctx)`: what a transaction does on the chain (decode its OP_RETURN marker with `findMarkers` and
  `Reader` from `chain/marker.ts`). Served at `GET /api/v1/sidechain/tx/:txid`.
- `describeBlock(block, ctx)`: extra block fields, served at `GET /api/v1/sidechain/block/:hash/features`.
- `start(ctx)` / `onNewBlock(block, ctx)`: background indexes.

Frontend (`ChainFrontendModule`):

- `routes` + `nav`: the module's pages (lazy `loadComponent`) and their nav entries;
- `txView` / `blockView`: standalone components showing the `describeTx` / `describeBlock` data.

The BitNames, BitAssets, Hivemind, zSide and FastBlocks backend modules show how markers are decoded.
