/**
 * What the Flush explorer reads for its visitors (chains/FLUSH-API.md): the node's read RPCs on an allowlist with
 * their arguments checked, and the GET paths of Flush's public DEX API (flushd -publicapi, backbone-flush
 * doc/public-api.md "REST") on another, their query parameters checked. Pure functions, tested in
 * __tests__/chain/flush/.
 */

export class ArgsError extends Error {}

/**
 * The node's read RPCs a visitor may call, with how many arguments each takes at most (backbone-flush
 * src/rpc/{blockchain,sidechain,pos,bitassets}.cpp). No wallet, mining, network or write method; nothing that
 * makes a block, a request or a transaction. `quote`: the route and curve searches, which take turns.
 */
export const RPC_METHODS: Record<string, { args: number; quote?: boolean }> = {
  // chain and peg
  getblockchaininfo: { args: 0 },
  getmainchaininfo: { args: 0 },
  getpeginfo: { args: 0 },
  listwithdrawals: { args: 0 },
  getwithdrawalbundle: { args: 0 },
  getsidechainstate: { args: 0 },
  gettxout: { args: 3 },       // txid n include_mempool: an output's coins and its token (the chain's state)
  // stake
  getposinfo: { args: 0 },
  getvalidators: { args: 1 },
  getvalidator: { args: 1 },
  getleaderschedule: { args: 1 },
  getanchorinfo: { args: 1 },
  listevidence: { args: 0 },
  // assets
  getasset: { args: 2 },
  listassets: { args: 3 },
  getassethistory: { args: 1 },
  searchassets: { args: 5 },   // query filters sort cursor limit
  getbitassetsinfo: { args: 0 },
  getassetindexinfo: { args: 0 },
  getverifications: { args: 3 },
  // the DEX
  listpools: { args: 3 },
  getpool: { args: 2 },
  searchpools: { args: 5 },    // query filters sort cursor limit
  getpooltwap: { args: 3 },
  getpoolcurve: { args: 2 },
  getpoolticks: { args: 2 },
  getpoolcandles: { args: 4 }, // assets-unified
  getposition: { args: 1 },
  getbook: { args: 3 },
  getorder: { args: 1 },
  getdexinfo: { args: 0 },
  gettreasury: { args: 0 },
  listauctions: { args: 4 },
  getauction: { args: 1 },
  searchauctions: { args: 5 }, // query filters sort cursor limit
  listoracles: { args: 2 },
  getoraclevalue: { args: 2 },
  getoraclecontract: { args: 1 },
  // launches
  getlaunch: { args: 1 },
  listlaunches: { args: 1 },
  getlaunchstats: { args: 0 },
  getlaunchlog: { args: 2 },
  // quotes: read-only maths on the state
  quoteswap: { args: 4, quote: true },
  getswapquote: { args: 4, quote: true },
  quoteroute: { args: 5, quote: true },
  quotelaunch: { args: 3, quote: true },
  quotebid: { args: 2, quote: true },
};

/** The `args` query parameter: its JSON text at most */
export const MAX_ARGS_TEXT = 1024;
/** A string argument (or a string in an object or array argument) at most */
const MAX_STRING = 256;
/** Keys of an object argument, elements of an array argument, at most */
const MAX_ITEMS = 20;

/**
 * One argument: a string, a finite number, a boolean, null, or an object or array of those, two levels deep (the
 * search RPCs' filters hold keyword lists: {"exclude_keywords": ["…"]}); the whole args JSON is capped in length
 */
function checkValue(v: unknown, depth: number): void {
  if (v === null || typeof v === 'boolean') {
    return;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new ArgsError('not a finite number');
    }
    return;
  }
  if (typeof v === 'string') {
    // eslint-disable-next-line no-control-regex
    if (v.length > MAX_STRING || /[\u0000-\u001f\u007f]/.test(v)) {
      throw new ArgsError('string too long or with control characters');
    }
    return;
  }
  if (depth >= 2) {
    throw new ArgsError('nested too deep');
  }
  if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) {
      throw new ArgsError('array too long');
    }
    v.forEach(x => checkValue(x, depth + 1));
    return;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    if (keys.length > MAX_ITEMS || keys.some(k => !/^[a-z_][a-z0-9_]{0,40}$/i.test(k))) {
      throw new ArgsError('object with too many or odd keys');
    }
    keys.forEach(k => checkValue((v as any)[k], depth + 1));
    return;
  }
  throw new ArgsError('unsupported argument');
}

/**
 * The arguments of an allowlisted method from the `args` query parameter (a JSON array; absent or empty = none).
 * Throws ArgsError when the method is not on the allowlist or the arguments are not acceptable.
 */
export function parseRpcArgs(method: string, text: unknown): unknown[] {
  return parseArgsFor(RPC_METHODS, method, text);
}

/** parseRpcArgs for another node's allowlist (FreeBank's: chain/modules/freebank/allowlist.ts) */
export function parseArgsFor(methods: Record<string, { args: number }>, method: string, text: unknown): unknown[] {
  const spec = Object.prototype.hasOwnProperty.call(methods, method) ? methods[method] : undefined;
  if (!spec) {
    throw new ArgsError('method not allowed');
  }
  if (text === undefined || text === '') {
    return [];
  }
  if (typeof text !== 'string' || text.length > MAX_ARGS_TEXT) {
    throw new ArgsError('args too long');
  }
  let args: unknown;
  try {
    args = JSON.parse(text);
  } catch (e) {
    throw new ArgsError('args is not JSON');
  }
  if (!Array.isArray(args)) {
    throw new ArgsError('args is not an array');
  }
  if (args.length > spec.args) {
    throw new ArgsError('too many arguments');
  }
  args.forEach(a => checkValue(a, 0));
  return args;
}

/** An asset for getassetlogo: its 64-hex id (sent as 0x<id>, as the node takes a hash) or a ticker */
export function logoAsset(id: string): string | null {
  if (/^[0-9a-f]{64}$/.test(id)) {
    return '0x' + id;
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) ? id : null;
}

// The public DEX API (doc/public-api.md "REST"): its GET reads, without the quotes, builds and broadcast (POST).
const ID = '[0-9a-f]{64}';
/** a launch or an asset by its id or ticker, a book's asset (ECX has none: its name) */
const NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const ADDRESS = '[A-Za-z0-9]{8,120}';
const MARKET_PATHS: RegExp[] = [
  'status', 'stats', 'fees', 'treasury',
  'launches', 'launches/stats', 'launches/log',
  `launches/${NAME}`, `launches/${NAME}/(?:trades|candles|holders)`,
  'assets', `assets/${NAME}`,
  'pools', `pools/${ID}`, `pools/${NAME}/${NAME}`, `pools/${ID}/(?:trades|candles|ticks)`,
  `positions/${ID}`,
  `books/${NAME}`, `books/${NAME}/${NAME}`,
  `tickers/${NAME}`,
  `addresses/${ADDRESS}/holdings`, `addresses/${ADDRESS}/trades`,
  `trades/${ID}`,                // 8.2.0: an order's outcome by its txid (or its settle's), misses included
  'verifications',
].map(p => new RegExp(`^${p}$`));

/** An asset's or a launch's logo (an image, not JSON) */
const LOGO_PATH = new RegExp(`^(?:launches|assets)/${NAME}/logo$`);
/** Paths a NAME pattern would take that are routes of their own, not ids (a quote is not a read we serve) */
const RESERVED = /^(?:launches\/(?:stats|log)\/|[a-z]+\/[^/]+\/quote$)/;

/** The query parameters the public API's reads take (it refuses others with 400) */
const MARKET_PARAMS = new Set([
  'filter', 'sort', 'q', 'cursor', 'limit', 'before', 'interval', 'from', 'to', 'from_height', 'to_height', 'market',
  'kind', 'fee_ppm', 'ecx_only', 'include_abandoned', 'depth', 'assets', 'curators',
]);

/** Whether a public API path (after /api/v1/) is one of the allowlisted reads: 'json', 'logo', or null (refused) */
export function marketPath(path: string): 'json' | 'logo' | null {
  if (typeof path !== 'string' || path.length > 300 || path.includes('..') || path.includes('//')) {
    return null;
  }
  if (/^launches\/(?:stats|log)$/.test(path)) {
    return 'json';
  }
  if (RESERVED.test(path)) {
    return null;
  }
  if (LOGO_PATH.test(path)) {
    return 'logo';
  }
  return MARKET_PATHS.some(r => r.test(path)) ? 'json' : null;
}

/**
 * The query string to send on: allowlisted keys, each once, values of printable text at most 200 characters, in a
 * canonical order (the cache key). Throws ArgsError otherwise.
 */
export function marketQuery(query: Record<string, unknown>): string {
  const keys = Object.keys(query ?? {}).sort();
  if (keys.length > 10) {
    throw new ArgsError('too many parameters');
  }
  const parts: string[] = [];
  for (const k of keys) {
    const v = query[k];
    // eslint-disable-next-line no-control-regex
    if (!MARKET_PARAMS.has(k) || typeof v !== 'string' || v.length > 200 || /[\u0000-\u001f\u007f]/.test(v)) {
      throw new ArgsError('parameter not allowed');
    }
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

/** The image types the API's logos have (PNG, JPEG); the bytes must start with the type's magic */
export function logoMime(mime: unknown, bytes: Buffer): string | null {
  if (mime === 'image/png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (mime === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}
