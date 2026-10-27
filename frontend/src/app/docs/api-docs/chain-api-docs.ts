import { ChainProfile } from '@app/chain/chain-module';
import { L2_LEAN, PROFILE } from '@app/chain/profiles';

/**
 * The chain API docs of this explorer: the endpoints the chain modules add on top of upstream mempool's API.
 * Only the entries of the running profile are returned, so the eCash explorer, a sidechain explorer, Flush and
 * FreeBank each document what their backend actually serves. The data has the shape of api-docs-data.ts.
 */

const SHOW = [''];
const SHOW_JS = { '': false, 'testnet': false, 'testnet4': false, 'signet': false, 'liquid': false, 'liquidtestnet': false };

interface ApiDoc {
  type: string;
  category: string;
  fragment: string;
  title: string;
  showConditions: string[];
  [key: string]: unknown;
}

interface EndpointSpec {
  category: string;
  fragment: string;
  title: string;
  url: string;
  description: string;
  response?: string;
  method?: 'GET' | 'POST';
  curl?: string;
}

const category = (fragment: string, title: string): ApiDoc => ({
  type: 'category',
  category: fragment,
  fragment,
  title,
  showConditions: SHOW,
});

const ZERO64 = '0'.repeat(64);

const endpoint = (spec: EndpointSpec): ApiDoc => {
  const post = spec.method === 'POST';
  const curl = spec.curl ?? (post ? `%{1}" "[[hostname]][[baseNetworkUrl]]/api${spec.url}` : '/api' + spec.url);
  return {
    type: 'endpoint',
    category: spec.category,
    httpRequestMethod: spec.method ?? 'GET',
    fragment: spec.fragment,
    title: spec.title,
    description: { default: spec.description },
    urlString: spec.url,
    showConditions: SHOW,
    showJsExamples: SHOW_JS,
    codeExample: {
      default: {
        codeTemplate: { curl },
        codeSampleMainnet: { esModule: [], commonJS: [], curl: post ? ['<signed transaction hex>'] : [], response: spec.response ?? '' },
      },
    },
  };
};

const chainProfile = (): ApiDoc[] => [
  category('chain-api', 'Chain API'),
  endpoint({
    category: 'chain',
    fragment: 'chain-profile',
    title: 'GET Chain Profile',
    url: '/v1/chain',
    description: 'Returns this explorer\'s chain profile: <code>id</code>, <code>kind</code> (<code>l1</code>, <code>l2</code>, '
      + '<code>flush</code> or <code>freebank</code>), <code>name</code>, <code>unit</code>, <code>slot</code>, <code>mainchain</code>, '
      + '<code>network</code>, <code>networkName</code>, the other explorers of the network, the BIP300 sidechains, the chain '
      + 'module\'s hooks, the index state and, where the chain has one, its feature list and the node RPC allowlist.',
    response: `{
  "id": "flush",
  "kind": "flush",
  "name": "Flush",
  "unit": "ECX",
  "slot": 99,
  "mainchain": false,
  "network": "ecashbeta",
  "networkName": "Betanet",
  ...
}`,
  }),
];

const drivechainDocs = (): ApiDoc[] => [
  category('drivechain-api', 'Drivechain (eCash)'),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-summary',
    title: 'GET Drivechain Summary',
    url: '/v1/drivechain/summary',
    description: 'The BIP300 constants, the active sidechains with their escrow and pending bundles, the sidechain proposals, '
      + 'the pending withdrawal bundles with their votes, and per-sidechain totals over the drivechain index.',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-blocks',
    title: 'GET Drivechain Blocks',
    url: '/v1/drivechain/blocks',
    description: 'Per-block summaries of what each block did for the drivechain: BMM, deposits, withdrawals, votes and proposals, '
      + 'newest first. Use <code>to=&amp;count=</code> (count 1 to 100, default 15) or <code>hashes=</code> with up to 100 '
      + 'comma-separated block hashes.',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-block',
    title: 'GET Drivechain Block',
    url: '/v1/drivechain/block/:hashOrHeight',
    curl: '/api/v1/drivechain/block/0',
    description: 'Everything a block did for the drivechain: its BMM accepts and requests, deposits, withdrawals, votes and '
      + 'proposals. Accepts a block hash or a height.',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-events',
    title: 'GET Drivechain Events',
    url: '/v1/drivechain/events/:kind',
    description: 'Paged drivechain events. <code>kind</code> is one of <code>bmm</code>, <code>bmm-requests</code>, '
      + '<code>deposits</code>, <code>withdrawals</code>, <code>votes</code>, <code>proposals</code> or <code>bundles</code>. '
      + 'Optional <code>slot</code> (0 to 255), <code>before</code> (an eCash height, exclusive) and <code>limit</code> '
      + '(1 to 500, default 50).',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-tx',
    title: 'GET Drivechain Transaction',
    url: '/v1/drivechain/tx/:txid',
    curl: '/api/v1/drivechain/tx/' + ZERO64,
    description: 'What a transaction did for the drivechain: a deposit (M5), a withdrawal (M6) or a BMM request (M8).',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-stats',
    title: 'GET Drivechain Stats',
    url: '/v1/drivechain/stats',
    description: 'Per-sidechain totals over the drivechain index.',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-cockpit',
    title: 'GET Drivechain Cockpit',
    url: '/v1/drivechain/cockpit',
    description: 'Statistics over a window of mainchain blocks and the live state from the enforcer: BMM coverage and bids, '
      + 'deposits, withdrawals, votes, bundles, escrow, miners and a time series. <code>window</code> is a number of blocks '
      + '(default 144; 0 means everything indexed), <code>slot</code> optionally narrows it to one sidechain.',
  }),
  endpoint({
    category: 'drivechain',
    fragment: 'drivechain-mining',
    title: 'GET Drivechain Mining',
    url: '/v1/drivechain/mining',
    description: 'Mining pools by coinbase tag (DATUM miners), hashrate, difficulty, the retarget and epochs. '
      + '<code>window</code> is a number of blocks (default 1008; 0 means everything indexed).',
  }),
];

const l2Docs = (): ApiDoc[] => [
  category('l2-api', 'Sidechain (L2)'),
  endpoint({
    category: 'l2',
    fragment: 'l2-summary',
    title: 'GET Sidechain Summary',
    url: '/v1/l2/summary',
    description: 'The chain tip, index progress, block/transaction/address counts, sidechain wealth, the eCash escrow, the '
      + 'pending withdrawal bundle, the node\'s mempool count and BMM coverage over the newest 144 eCash blocks.',
    response: `{
  "tip": { "height": 2283, "hash": "…", "time": 1792668688 },
  "indexed": 2283,
  "ready": true,
  "blocks": 2284,
  "txs": 412,
  "addresses": 96,
  "wealth": 101206236589,
  "escrow": { "amount": 101206335589, "txid": "…", "sequence": 25 },
  "deposits": { "count": 31, "amount": 0 },
  "withdrawals": { "count": 4, "amount": 0 },
  "pendingBundle": null,
  "mempool": { "count": 0 },
  "bmm": { "window": 144, "mainHeight": 973926, "accepts": 135, "coverage": 0.9375, "lastMainHeight": 973926, "bidMedian": 376 }
}`,
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-blocks',
    title: 'GET Sidechain Blocks',
    url: '/v1/l2/blocks',
    description: 'Block summaries, newest first, with the eCash block that carried each one by BMM and its BMM bid. '
      + '<code>before</code> is exclusive; <code>limit</code> is at most 50.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-block',
    title: 'GET Sidechain Block',
    url: '/v1/l2/block/:hashOrHeight',
    curl: '/api/v1/l2/block/0',
    description: 'A block with its summary, merkle root, coinbase, transactions, deposits, bundle spends and the BMM request '
      + 'competition in the carrying eCash block. Accepts a block hash or a height.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-tx',
    title: 'GET Sidechain Transaction',
    url: '/v1/l2/tx/:txid',
    curl: '/api/v1/l2/tx/' + ZERO64,
    description: 'A transaction from the index, or an unconfirmed one from the node\'s mempool. Includes its inputs, outputs, '
      + 'fee, TxData, signers and the chain-specific data: shielded actions (zSide), market payouts (Truthcoin).',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-broadcast',
    title: 'POST Sidechain Transaction',
    url: '/v1/l2/tx',
    method: 'POST',
    description: 'Broadcasts a signed transaction to the sidechain node. The body (at most 64 KB) is the chain\'s serialized '
      + 'hex (<code>Content-Type: text/plain</code>, or JSON <code>{ "hex": "…" }</code>) or the node\'s own JSON form for '
      + 'the signed transaction. Replies <code>{ "txid": "…" }</code>. Rate limited to 6 a minute per IP with a burst of 6.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-address',
    title: 'GET Sidechain Address',
    url: '/v1/l2/address/:address',
    description: 'An address\'s funded and spent totals, confirmed balance, transaction history, up to 500 unspent outputs and, '
      + 'when the node lists a mempool, its unconfirmed transactions and their net effect on the balance. '
      + '<code>before</code> and <code>limit</code> page the history.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-deposits',
    title: 'GET Sidechain Deposits',
    url: '/v1/l2/deposits',
    description: 'Deposits from eCash, newest first, with the sidechain address credited, the eCash transaction, height and '
      + 'whether the output has been spent. <code>before</code> and <code>limit</code> page the list.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-withdrawals',
    title: 'GET Sidechain Withdrawals',
    url: '/v1/l2/withdrawals',
    description: 'Withdrawals to eCash, newest first, with their status (<code>pending</code>, <code>bundled</code> or '
      + '<code>paid</code>), mainchain address, amount, fee and bundle id. <code>before</code> and <code>limit</code> page the list.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-search',
    title: 'GET Sidechain Search',
    url: '/v1/l2/search/:query',
    curl: '/api/v1/l2/search/100',
    description: 'Resolves a block height, block hash, txid or address to <code>{ "type": "block" | "tx" | "address" | null, '
      + '"id": "…" }</code>.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-bmm-cockpit',
    title: 'GET Sidechain BMM Cockpit',
    url: '/v1/l2/bmm/cockpit',
    description: 'The eCash explorer\'s drivechain cockpit for this sidechain\'s slot: totals, BMM coverage and bids, deposits, '
      + 'withdrawals, votes, bundles, miners and the live state. <code>window</code> is a number of eCash blocks (default 1440; '
      + '0 means everything indexed). Requires <code>CHAIN.MAINCHAIN_API</code>; otherwise 404.',
  }),
  endpoint({
    category: 'l2',
    fragment: 'l2-bmm-events',
    title: 'GET Sidechain BMM Events',
    url: '/v1/l2/bmm/events/:kind',
    description: 'The eCash explorer\'s drivechain events for this sidechain\'s slot. <code>kind</code> is <code>bmm</code>, '
      + '<code>bmm-requests</code>, <code>deposits</code>, <code>withdrawals</code>, <code>votes</code>, <code>proposals</code> '
      + 'or <code>bundles</code>. <code>before</code> is an exclusive eCash height; <code>limit</code> is at most 500 (default 50). '
      + 'Requires <code>CHAIN.MAINCHAIN_API</code>; otherwise 404.',
  }),
];

const bitnamesDocs = (): ApiDoc[] => [
  category('l2-names', 'Names (BitNames)'),
  endpoint({
    category: 'names',
    fragment: 'l2-names-list',
    title: 'GET Names',
    url: '/v1/l2/feature/names',
    description: 'Every name known to the chain: its plain name when known (from an ICANN reveal or a module candidate), owner, '
      + 'registration, update and transfer counts, last event and the reservation totals.',
  }),
  endpoint({
    category: 'names',
    fragment: 'l2-names-item',
    title: 'GET Name',
    url: '/v1/l2/feature/names/:id',
    curl: '/api/v1/l2/feature/names/' + ZERO64,
    description: 'One name by its blake3 hash: its data, owner, registration and the full history of reservations, '
      + 'registrations, updates, transfers and ICANN reveals.',
  }),
];

const bitassetsDocs = (): ApiDoc[] => [
  category('l2-assets', 'Assets (BitAssets)'),
  endpoint({
    category: 'assets',
    fragment: 'l2-assets-list',
    title: 'GET Assets',
    url: '/v1/l2/feature/assets',
    description: 'Every asset with its supply, holders, controller, registration, last activity, price and pools, plus the '
      + 'asset reservation totals. <code>AssetId</code> is the hex of the borsh: <code>00</code> for sats, '
      + '<code>01…</code> for an asset and <code>02…</code> for its control coin.',
  }),
  endpoint({
    category: 'assets',
    fragment: 'l2-assets-item',
    title: 'GET Asset',
    url: '/v1/l2/feature/assets/:id',
    curl: '/api/v1/l2/feature/assets/' + ZERO64,
    description: 'One asset by hash or <code>01…</code>/<code>02…</code> id, with its top 100 holders, mints, activity and price '
      + 'history.',
  }),
  category('l2-pools', 'Pools (BitAssets)'),
  endpoint({
    category: 'pools',
    fragment: 'l2-pools-list',
    title: 'GET Asset Pools',
    url: '/v1/l2/feature/pools',
    description: 'The AMM pools of the index\'s LP tokens and AMM transactions, with reserves, price, creation, swap counts, '
      + 'volume and last event.',
  }),
  endpoint({
    category: 'pools',
    fragment: 'l2-pools-item',
    title: 'GET Asset Pool',
    url: '/v1/l2/feature/pools/:id',
    description: 'One pool by <code>&lt;asset0&gt;-&lt;asset1&gt;</code>, with its mint, burn and swap history and a price and '
      + 'reserve series.',
  }),
  category('l2-auctions', 'Auctions (BitAssets)'),
  endpoint({
    category: 'auctions',
    fragment: 'l2-auctions-list',
    title: 'GET Dutch Auctions',
    url: '/v1/l2/feature/auctions',
    description: 'Dutch auctions with their state, status, current price, block range, assets, bids and collections.',
  }),
  endpoint({
    category: 'auctions',
    fragment: 'l2-auctions-item',
    title: 'GET Dutch Auction',
    url: '/v1/l2/feature/auctions/:id',
    curl: '/api/v1/l2/feature/auctions/' + ZERO64,
    description: 'One auction (id: its create transaction) with its parameters, price curve, bids and collections.',
  }),
];

const truthcoinDocs = (): ApiDoc[] => [
  category('l2-markets', 'Markets (Truthcoin)'),
  endpoint({
    category: 'markets',
    fragment: 'l2-markets-list',
    title: 'GET Markets',
    url: '/v1/l2/feature/markets',
    description: 'The node\'s market list, each market with its trade count, last trade and creation.',
  }),
  endpoint({
    category: 'markets',
    fragment: 'l2-markets-item',
    title: 'GET Market',
    url: '/v1/l2/feature/markets/:id',
    curl: '/api/v1/l2/feature/markets/000000000000',
    description: 'One market (12 hex) with its state, trades, last trade, creation, price history and the full trade list.',
  }),
  endpoint({
    category: 'markets',
    fragment: 'l2-positions',
    title: 'GET Address Positions',
    url: '/v1/l2/address/:address/positions',
    description: 'The address\'s prediction-market positions and Votecoin balance: shares, current LMSR price and value per '
      + 'outcome.',
  }),
  category('l2-oracle', 'Oracle (Truthcoin)'),
  endpoint({
    category: 'oracle',
    fragment: 'l2-decisions-list',
    title: 'GET Oracle Decisions',
    url: '/v1/l2/feature/decisions',
    description: 'The open oracle periods: status, counts by state and each decision with the markets it decides.',
  }),
  endpoint({
    category: 'oracle',
    fragment: 'l2-decisions-item',
    title: 'GET Oracle Decision',
    url: '/v1/l2/feature/decisions/:id',
    curl: '/api/v1/l2/feature/decisions/000000',
    description: 'One decision (6 hex) with its entry, votes and markets.',
  }),
  endpoint({
    category: 'oracle',
    fragment: 'l2-votes',
    title: 'GET Oracle Votes',
    url: '/v1/l2/feature/votes',
    description: 'The oracle\'s current period, voters by Votecoin balance, open periods with their pricing, and the vote '
      + 'transactions in the index.',
  }),
];

const zsideDocs = (): ApiDoc[] => [
  category('l2-shielded', 'Shielded (zSide)'),
  endpoint({
    category: 'shielded',
    fragment: 'l2-shielded',
    title: 'GET Shielded Pool',
    url: '/v1/l2/feature/shielded',
    description: 'The Orchard shielded pool: transaction and action counts, shielded in/out, value balance, nullifiers, '
      + 'commitments, pool size, a series by block and the most recent shielded transactions.',
  }),
];

const thunderDocs = (): ApiDoc[] => [
  category('l2-richlist', 'Rich List (Thunder)'),
  endpoint({
    category: 'richlist',
    fragment: 'l2-richlist',
    title: 'GET Rich List',
    url: '/v1/l2/feature/richlist',
    description: 'The top 100 addresses by balance, with totals, payment statistics, a history series and the largest '
      + 'transactions.',
  }),
];

const coinshiftDocs = (): ApiDoc[] => [
  category('l2-swaps', 'Swaps (Coinshift)'),
  endpoint({
    category: 'swaps',
    fragment: 'l2-swaps-list',
    title: 'GET Swaps',
    url: '/v1/l2/feature/swaps',
    description: 'Every swap the node knows, with its create, accept and claim transactions in the index and the sats held '
      + 'for it. Swap state is partly node-local: it shows what this node has seen of the eCash side.',
  }),
  endpoint({
    category: 'swaps',
    fragment: 'l2-swaps-item',
    title: 'GET Swap',
    url: '/v1/l2/feature/swaps/:id',
    curl: '/api/v1/l2/feature/swaps/' + ZERO64,
    description: 'One swap (64 hex): the node\'s status, its transactions, the sats it holds and whether the node knows it.',
  }),
];

const featureDocs = (profile: ChainProfile): ApiDoc[] => {
  switch (profile.id) {
    case 'bitnames': return bitnamesDocs();
    case 'bitassets': return bitassetsDocs();
    case 'truthcoin': return truthcoinDocs();
    case 'zside': return zsideDocs();
    case 'thunder': return thunderDocs();
    case 'coinshift': return coinshiftDocs();
    default: return [];
  }
};

const flushDocs = (): ApiDoc[] => [
  category('flush-api', 'Flush API'),
  endpoint({
    category: 'flush',
    fragment: 'flush-rpc',
    title: 'GET Flush RPC',
    url: '/v1/flush/rpc/:method',
    description: 'An allowlisted read RPC of the Flush node, answered as the node answers it. <code>args</code> is a JSON array '
      + '(at most 1024 characters) with the method\'s arguments: strings up to 256 characters, finite numbers, booleans, null, '
      + 'and objects (up to 20 keys) or arrays (up to 20 items) of those, two levels deep. The allowlist covers chain and peg, '
      + 'stake, assets, DEX, launches and read-only quote methods.',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-logo',
    title: 'GET Asset Logo',
    url: '/v1/flush/logo/:asset',
    curl: '/api/v1/flush/logo/ECX',
    description: 'An asset\'s logo as PNG or JPEG bytes (at most 64 KB) by 64-hex asset id or ticker, with its MIME type. 404 '
      + 'when the asset or its logo does not exist.',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-tx',
    title: 'GET Flush Transaction',
    url: '/v1/flush/tx/:txid',
    curl: '/api/v1/flush/tx/' + ZERO64,
    description: 'What a transaction does on Flush: its asset operation, peg operations (withdrawal, refund, bundle) and stake '
      + 'operations (bond, unbond, evidence, validator pool, validator shares).',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-block',
    title: 'GET Flush Block',
    url: '/v1/flush/block/:hash',
    curl: '/api/v1/flush/block/' + ZERO64,
    description: 'A block\'s stake fields: kind (<code>pos</code> or <code>bmm</code>), slot, proposer, mainchain height, '
      + 'anchor acknowledgement, evidence and finality.',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-blocks',
    title: 'GET Flush Blocks',
    url: '/v1/flush/blocks',
    description: 'The same stake fields for 1 to 30 blocks at once, keyed by hash. <code>hashes=</code> takes comma-separated '
      + 'block hashes; duplicates are dropped, non-64-hex entries ignored, and a block the node did not answer is '
      + '<code>null</code>. 400 when no valid hash is left or there are more than 30.',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-block-fees',
    title: 'GET Flush Block Fees',
    url: '/v1/flush/block-fees',
    description: 'The indexed blocks of a range and their fees, newest first. <code>range</code> is <code>24h</code>, '
      + '<code>48h</code>, <code>7d</code> or <code>30d</code> (default <code>48h</code>); <code>page</code> is 0 to 100000 '
      + 'and <code>size</code> 1 to 100 (default 25), clamped when out of range; <code>fees=1</code> keeps only blocks with '
      + 'fees. The reply carries the range totals and a per-kind breakdown. Cached 15 s.',
    response: `{
  "range": "48h",
  "page": 0,
  "size": 25,
  "feesOnly": false,
  "total": 11520,
  "totals": {
    "blocks": 11520,
    "withFees": 11520,
    "fees": 123456789,
    "fromHeight": 1000,
    "toHeight": 12519,
    "byKind": { "pos": 120000000, "bmm": 3456789, "unknown": 0 },
    "unknownBlocks": 0,
    "beyondKinds": 0
  },
  "indexedFrom": { "height": 1, "time": 1790000000 },
  "blocks": [
    { "height": 12519, "hash": "…", "time": 1792668688, "fees": 10000, "txs": 2, "kind": "pos" }
  ]
}`,
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-market',
    title: 'GET Flush DEX API',
    url: '/v1/flush/market/<path>',
    description: 'An allowlisted GET of the public DEX API\'s <code>/api/v1/&lt;path&gt;</code>, with its JSON re-serialized as '
      + 'is, or a PNG/JPEG logo. Paths include <code>status</code>, <code>stats</code>, <code>fees</code>, <code>treasury</code>, '
      + '<code>launches</code>, <code>pools</code>, <code>positions</code>, <code>books</code>, <code>tickers</code>, '
      + '<code>addresses</code>, <code>verifications</code> and <code>assets</code>. 404 when the public API is not configured.',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-assets',
    title: 'GET Assets',
    url: '/v1/flush/market/assets',
    curl: '/api/v1/flush/market/assets?sort=newest&limit=1',
    description: 'The asset registry, a page at a time: each asset\'s id, ticker, display name, info text, decimals, supply (as a '
      + 'number of whole units and exactly, in base units, as <code>supply_units</code>), holders, whether the supply is fixed, '
      + 'its registration (height and txid), whether it was launched, its controller, and its market: <code>status</code> (the '
      + 'first of <code>curve</code>, <code>pool</code>, <code>book</code>, <code>auction</code>, <code>none</code>), '
      + '<code>progress</code> towards graduation (0 to 1) on a curve, the counts of pools, books and auctions, the price in ECX '
      + 'and the 24-hour volume. Query: <code>q</code> (search), <code>sort</code> (<code>newest</code>, <code>oldest</code>, '
      + '<code>name</code>, <code>supply</code>, <code>volume</code>, <code>holders</code>, <code>activity</code>), '
      + '<code>market</code> (<code>all</code>, <code>none</code>, <code>curve</code>, <code>pool</code>, <code>book</code>, '
      + '<code>auction</code>; it filters the page: go on with <code>next_cursor</code>), <code>cursor</code>, <code>limit</code> '
      + '(at most 100). <code>logo</code> is a path of the DEX API: its logo is at <code>/api/v1/flush/market</code> followed by '
      + 'that path without its <code>/api/v1</code>, or at <i>GET Asset Logo</i>.',
    response: `{
  "items": [
    {
      "id": "1b17d8e71787ea5cb91bbae670e8f2a9001fac0bdf6958291551e0fc83c2c4b8",
      "ticker": "ECASH",
      "display_name": "eCash",
      "info": "eCash on eCash via Flush. …",
      "decimals": 6,
      "supply": 100,
      "supply_units": "100000000",
      "holders": 0,
      "logo": "/api/v1/assets/1b17d8e71787ea5cb91bbae670e8f2a9001fac0bdf6958291551e0fc83c2c4b8/logo?v=3ef95d5eec88",
      "fixed_supply": true,
      "registered_height": 19157,
      "registration_txid": "822e95fa79cde1dbaf40f1f82ddc2503096c8f18a16e8631f0113807e1eb73d4",
      "launched": true,
      "market": {
        "status": "curve",
        "kinds": ["curve"],
        "progress": 0,
        "pools": 0,
        "books": 0,
        "auctions": 0,
        "price_ecx": 0.4444444444444444,
        "volume_24h_ecx": 0
      },
      "controller": null,
      "seq": 13
    }
  ],
  "next_cursor": "0141530200a06ffffffff2",
  "total": 14
}`,
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-asset',
    title: 'GET Asset',
    url: '/v1/flush/market/assets/:asset',
    curl: '/api/v1/flush/market/assets/1b17d8e71787ea5cb91bbae670e8f2a9001fac0bdf6958291551e0fc83c2c4b8',
    description: 'One asset by 64-hex id or ticker: everything <i>GET Assets</i> gives, plus its whole '
      + 'description and links, its launch (bonding curve: state, raised and sold amounts, price, market cap, graduation '
      + 'target, fee and its split), its pools (at most 10), books (at most 10) and open auctions (at most 20), and '
      + '<code>can_curve</code>: whether it may still be put on a launch curve, and why not. 404 when there is no such asset.',
    response: `{
  "id": "1b17d8e71787ea5cb91bbae670e8f2a9001fac0bdf6958291551e0fc83c2c4b8",
  "ticker": "ECASH",
  "display_name": "eCash",
  "decimals": 6,
  "supply": 100,
  "supply_units": "100000000",
  "fixed_supply": true,
  "market": { "status": "curve", "price_ecx": 0.4444444444444444, … },
  "links": [],
  "launch": {
    "state": "curve",
    "creator": "bflx1qx9vl7xr5p9z20rq5ynh6a3rzx46dxj6kgvwuhk",
    "created_height": 19157,
    "raised_ecx": 0,
    "price_ecx": 0.4444444444444444,
    "mcap_ecx": 44.44444444444444,
    "graduation_ecx": 100,
    "curve_supply": 75,
    "pool_supply": 25,
    "fee_bps": 115,
    "fee_split": [{ "to": "creator", "bps": 7500, "kind": "creator", "paid_ecx": 0, "owed_ecx": 0 }],
    …
  },
  "pools": [],
  "books": [],
  "auctions": [],
  "can_curve": { "allowed": false, "reason": "it was launched or put on a curve already" },
  …
}`,
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-asset-record',
    title: 'GET Asset Record (node)',
    url: '/v1/flush/rpc/getasset',
    curl: '/api/v1/flush/rpc/getasset?args=%5B%220x1b17d8e71787ea5cb91bbae670e8f2a9001fac0bdf6958291551e0fc83c2c4b8%22%5D',
    description: 'The node\'s own record of an asset (<i>GET Flush RPC</i> <code>getasset</code>; name it by '
      + 'its id as <code>0x&lt;id&gt;</code>, or by its name, optionally with a height): name, display name, decimals, supply, '
      + 'minted and burned amounts, whether it is fixed, its registration (<code>registered</code> height and '
      + '<code>registration</code> txid), its data fields, its control output (an asset that can still mint) and its logo\'s '
      + 'hash, type and size. The other asset reads of the node: <code>listassets</code> [count skip match], '
      + '<code>searchassets</code> [options], <code>getassethistory</code> asset (every data field\'s values, with the '
      + 'transaction and height that set each), <code>getverifications</code> asset [curators] [curator].',
    response: `{
  "asset": "1b17d8e71787ea5cb91bbae670e8f2a9001fac0bdf6958291551e0fc83c2c4b8",
  "name": "ECASH",
  "display_name": "eCash",
  "label": "ECASH",
  "seq": "2730-0320",
  "decimals": 6,
  "supply": 100,
  "minted": 100,
  "burned": 0,
  "fixed": true,
  "registered": 19157,
  "registration": "822e95fa79cde1dbaf40f1f82ddc2503096c8f18a16e8631f0113807e1eb73d4",
  "data": { "info": "eCash on eCash via Flush. …" },
  "releasable": false,
  "logo": {
    "hash": "3ef95d5eec88e25e50d1e4d4d1c52e355aa8729b1bb875aedaf0c65837c6358e",
    "mime": "image/png",
    "size": 5464,
    "height": 19157,
    "txid": "822e95fa79cde1dbaf40f1f82ddc2503096c8f18a16e8631f0113807e1eb73d4"
  }
}`,
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-holdings',
    title: 'GET Address Holdings',
    url: '/v1/flush/market/addresses/:address/holdings',
    curl: '/api/v1/flush/market/addresses/bflx1qx9vl7xr5p9z20rq5ynh6a3rzx46dxj6kgvwuhk/holdings',
    description: 'What a Flush address holds besides ECX: its assets (with their value in ECX), LP shares, liquidity positions '
      + 'and open orders; each with its ticker, asset id, kind (<code>asset</code>, <code>lp</code>, <code>position</code>, '
      + '<code>order</code>), amount, and exact amount in base units (<code>amount_units</code>).',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-verifications',
    title: 'GET Asset Verifications',
    url: '/v1/flush/market/verifications',
    description: 'Which assets curators verified: <code>assets</code> takes 1 to 50 comma-separated asset ids and '
      + '<code>curators</code> 1 to 20 comma-separated curator ids, the client\'s own list (both required). Each asset comes with '
      + 'whether it is verified and the word of each curator (name, verified, round, height).',
  }),
  endpoint({
    category: 'flush',
    fragment: 'flush-utxo-tokens',
    title: 'GET Address UTXO (with tokens)',
    url: '/address/:address/utxo',
    curl: '/api/address/bflx1ql8lnext2t57s7e3yv986mdem844x9anccn3wyy/utxo',
    description: 'An address\'s unspent outputs, as on Bitcoin, each with what it carries besides its ECX: <code>token</code> '
      + 'is <code>{ kind, id, amount_units }</code> (kind: 0 asset, 1 control, 2 reservation, 3 LP, 4 receipt, 5 position, '
      + '6 order; <code>amount_units</code> an integer as a string) or <code>null</code> for plain ECX; and '
      + '<code>spendable</code>. A confirmed output\'s token is the node\'s own state (the results of swaps and launches '
      + 'included); an unconfirmed one\'s is its transaction\'s, and an output whose token is not known until its block '
      + 'applies it (an order\'s result) has <code>token: null, spendable: false</code>. No <code>token</code> field: not '
      + 'known (an older node). The same for <code>/scripthash/:hash/utxo</code>.',
    response: `[
  {
    "txid": "7958bc9b161e2bacc98e66bd7c6a01457809817a4c0cfcecc749504ad38e8d44",
    "vout": 0,
    "value": 0,
    "status": {
      "confirmed": true,
      "block_height": 8462,
      "block_hash": "2684a41d0b59311ef8daaed2953b53b5d7f8d916c7073749252b5f223e30b33e"
    },
    "token": { "kind": 1, "id": "7351ccd9fd2f091cce3f9d8e3cd0b95f278885f4610620784b8c64be8b0237c1", "amount_units": "1" },
    "spendable": true
  }
]`,
  }),
];

const freebankDocs = (): ApiDoc[] => [
  category('freebank-api', 'FreeBank API'),
  endpoint({
    category: 'freebank',
    fragment: 'freebank-rpc',
    title: 'GET FreeBank RPC',
    url: '/v1/freebank/rpc/:method',
    description: 'An allowlisted read RPC of the FreeBank node, answered as the node answers it. <code>args</code> is a JSON '
      + 'array checked like Flush\'s. The allowlist covers chain and peg, discount houses, bills and loan books, pools, assets '
      + 'and the gold fix.',
  }),
  endpoint({
    category: 'freebank',
    fragment: 'freebank-tx',
    title: 'GET FreeBank Transaction',
    url: '/v1/freebank/tx/:txid',
    curl: '/api/v1/freebank/tx/' + ZERO64,
    description: 'What a transaction means on FreeBank: its version and credit family, the decoded operation and fields '
      + '(bills, houses, notes, term deposits, pools, settlements, oracle), asset genesis, and its peg outputs.',
  }),
  endpoint({
    category: 'freebank',
    fragment: 'freebank-block',
    title: 'GET FreeBank Block',
    url: '/v1/freebank/block/:hash',
    curl: '/api/v1/freebank/block/' + ZERO64,
    description: 'A block\'s BMM fields: its eCash block, withdrawal bundle, whether it is on the active chain and its credit '
      + 'operation counts by family.',
  }),
  endpoint({
    category: 'freebank',
    fragment: 'freebank-blocks',
    title: 'GET FreeBank Blocks',
    url: '/v1/freebank/blocks',
    description: 'The same BMM and credit fields for 1 to 30 blocks at once, keyed by hash. <code>hashes=</code> takes '
      + 'comma-separated block hashes; entries the node did not answer are <code>null</code>. 400 when no valid hash is left '
      + 'or there are more than 30.',
  }),
  endpoint({
    category: 'freebank',
    fragment: 'freebank-activity',
    title: 'GET FreeBank Credit Activity',
    url: '/v1/freebank/activity',
    description: 'Every credit operation (versions 11 to 17) and asset genesis on the chain, newest first. Filters: '
      + '<code>family</code> (bill, house, note, deposit, pool, settle, oracle, asset), <code>house</code>, <code>bill</code>, '
      + '<code>limit</code> (1 to 200, default 50) and <code>before</code> (the previous page\'s <code>next</code>). The reply '
      + 'also carries the indexed range and whether it reaches the genesis block.',
    response: `{
  "items": [
    {
      "txid": "…",
      "height": 4242,
      "time": 1792668688,
      "index": 3,
      "family": "bill",
      "op": 1,
      "opName": "issue",
      "fields": { "face_sats": 100000, "maturity_height": 5000, "grace_blocks": 144 },
      "error": null
    }
  ],
  "next": "4242:3",
  "index": { "low": 0, "high": 4242, "tip": 4242, "complete": true }
}`,
  }),
];

/** The chain API docs of the running profile */
export function chainApiDocsFor(profile: ChainProfile = PROFILE): ApiDoc[] {
  const docs = chainProfile();
  switch (profile.kind) {
    case 'l1': return docs.concat(drivechainDocs());
    case 'l2': return docs.concat(l2Docs(), featureDocs(profile));
    case 'flush': return docs.concat(flushDocs());
    case 'freebank': return docs.concat(freebankDocs());
    default: return docs;
  }
}

/**
 * The REST API docs of the running explorer: the chain API above, followed by upstream mempool's REST docs when the
 * explorer runs the full backend. A lean sidechain explorer (CHAIN_UI=lean) has only the chain and sidechain API.
 */
export function restApiDocsFor(restDocs: ApiDoc[], profile: ChainProfile = PROFILE): ApiDoc[] {
  const docs = chainApiDocsFor(profile);
  return L2_LEAN ? docs : docs.concat(restDocs);
}
