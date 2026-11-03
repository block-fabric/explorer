import axios from 'axios';
import config from '../config';
import DB from '../database';
import logger from '../logger';

/**
 * The console's outside data (/console, eCash mainnet's explorer only): ECX's markets and eCash's news.
 *
 *   markets  wECX and waECX on Solana (DexScreener's public API: every pool of the two mints), ECX on neoxa.exchange
 *            (its CoinGecko-format tickers: ECX_USDC, ECX_USDT, ECX_BTC, the BTC pair priced with its BTC_USDC),
 *            and ECX's price over them weighted by their 24 h volume in USD. A snapshot every SNAPSHOT_EVERY is kept
 *            (chain_intel_prices, INTEL_KEEP), for the price over time; neoxa's hourly candles besides.
 *   news     ecash.com's blog (its RSS).
 *
 * Every source is a fixed URL (nothing from a request reaches one), read with a timeout and a size bound; one that
 * fails leaves the last good answer in place.
 */

const WECX = '6ombVv3YMs9qpx1QkycD9XW8HKSfv7vGrCFX3cxCYMVY'; // wECX, Solana
const WAECX = 'BZEmayLHNAD4aaQ86Jkf9YTT8QT7xXfPGMmCg6JncmhZ'; // waECX ("Wrapped Alpha eCash"), Solana
const DEXSCREENER = 'https://api.dexscreener.com/token-pairs/v1/solana/';
const NEOXA = 'https://neoxa.exchange';
const NEOXA_PAIRS = ['ECX_USDC', 'ECX_USDT', 'ECX_BTC'];
const ECASH_BLOG = 'https://ecash.com/blog/rss.xml';

const MARKETS_TTL = 60_000;
const NEWS_TTL = 30 * 60_000;
const CANDLES_TTL = 10 * 60_000;
const SNAPSHOT_EVERY = 5 * 60_000;
const INTEL_KEEP = 90 * 86400;
const TIMEOUT = 15_000;
const MAX_BYTES = 5_000_000;

export interface MarketPair {
  venue: string; // "orca", "raydium", "neoxa"
  chain: string; // "solana", "neoxa"
  pair: string; // "wECX/USDC"
  asset: 'ECX' | 'waECX'; // what is priced: wECX and neoxa's ECX are ECX; waECX is another asset
  priceUsd: number | null;
  priceQuote: number | null; // in the quote currency
  quote: string;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  change24h: number | null; // percent
  high24h: number | null; low24h: number | null; // in the quote currency, where the venue says
  url: string;
}

export interface Markets {
  updated: number; // unix seconds
  ecx: { priceUsd: number | null; volume24hUsd: number; venues: number }; // over the ECX pairs, by 24 h USD volume
  pairs: MarketPair[];
  history: { time: number; priceUsd: number; volume24hUsd: number }[]; // ECX's snapshots
}

let markets: Markets | null = null;
const priceHistory: Markets['history'] = []; // ECX's snapshots, oldest first
let marketsAt = 0;
let news: { updated: number; items: { title: string; link: string; time: number; source: string }[] } | null = null;
let newsAt = 0;
const candles = new Map<string, { at: number; value: any[] }>();
let started = false;

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};

/** GET a fixed URL as JSON or text @asyncUnsafe */
async function $get(url: string, responseType: 'json' | 'text' = 'json'): Promise<any> {
  const res = await axios.get(url, { timeout: TIMEOUT, maxContentLength: MAX_BYTES, responseType, validateStatus: () => true,
    headers: { 'User-Agent': 'eCash-Explorer/1.0 (+https://explorer.blockfab.org)' } });
  if (res.status !== 200) {
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  return res.data;
}

/** @asyncUnsafe */
async function $solanaPairs(mint: string, asset: MarketPair['asset']): Promise<MarketPair[]> {
  const list: any[] = await $get(DEXSCREENER + mint);
  return (Array.isArray(list) ? list : [])
    // the pools where this mint is the base, with any trading or liquidity
    .filter(p => p?.baseToken?.address === mint && ((num(p?.volume?.h24) ?? 0) > 0 || (num(p?.liquidity?.usd) ?? 0) > 0))
    .slice(0, 20)
    .map(p => ({
      venue: String(p.dexId ?? '?').slice(0, 24), chain: 'solana',
      pair: `${String(p.baseToken.symbol).slice(0, 12)}/${String(p.quoteToken?.symbol ?? '?').slice(0, 12)}`,
      asset, priceUsd: num(p.priceUsd), priceQuote: num(p.priceNative), quote: String(p.quoteToken?.symbol ?? '?').slice(0, 12),
      volume24hUsd: num(p.volume?.h24), liquidityUsd: num(p.liquidity?.usd), change24h: num(p.priceChange?.h24),
      high24h: null, low24h: null,
      url: /^[A-Za-z0-9]{20,64}$/.test(p.pairAddress) ? `https://dexscreener.com/solana/${p.pairAddress}` : 'https://dexscreener.com',
    }));
}

/** @asyncUnsafe */
async function $neoxaPairs(): Promise<MarketPair[]> {
  const list: any[] = await $get(NEOXA + '/api/v1/cg/tickers');
  const by = new Map((Array.isArray(list) ? list : []).map(t => [String(t?.ticker_id), t]));
  const btcUsd = num(by.get('BTC_USDC')?.last_price);
  const out: MarketPair[] = [];
  for (const id of NEOXA_PAIRS) {
    const t = by.get(id);
    if (!t) {
      continue;
    }
    const quote = id.split('_')[1];
    const toUsd = quote === 'BTC' ? btcUsd : 1; // USDC, USDT taken at a dollar
    const last = num(t.last_price);
    const quoteVolume = num(t.target_volume);
    out.push({
      venue: 'neoxa', chain: 'neoxa', pair: `ECX/${quote}`, asset: 'ECX', quote,
      priceQuote: last, priceUsd: last !== null && toUsd ? last * toUsd : null,
      volume24hUsd: quoteVolume !== null && toUsd ? quoteVolume * toUsd : null, liquidityUsd: null, change24h: null,
      high24h: num(t.high), low24h: num(t.low), url: `${NEOXA}/trade/${id}`,
    });
  }
  return out;
}

/** the markets, refreshed when older than MARKETS_TTL (a source that fails keeps its last pairs) @asyncSafe */
export async function $getMarkets(): Promise<Markets | null> {
  if (markets && Date.now() - marketsAt < MARKETS_TTL) {
    return markets;
  }
  marketsAt = Date.now();
  const old = markets?.pairs ?? [];
  const parts = await Promise.allSettled([$solanaPairs(WECX, 'ECX'), $solanaPairs(WAECX, 'waECX'), $neoxaPairs()]);
  const keep = (i: number, pick: (p: MarketPair) => boolean): MarketPair[] => {
    const r = parts[i];
    if (r.status === 'fulfilled') {
      return r.value;
    }
    logger.debug(`Console markets: ${r.reason instanceof Error ? r.reason.message : r.reason}`, 'Intel');
    return old.filter(pick);
  };
  const pairs = [
    ...keep(0, p => p.chain === 'solana' && p.asset === 'ECX'), ...keep(1, p => p.asset === 'waECX'), ...keep(2, p => p.venue === 'neoxa'),
  ];
  const ecx = pairs.filter(p => p.asset === 'ECX' && p.priceUsd !== null && (p.volume24hUsd ?? 0) > 0);
  const volume = ecx.reduce((s, p) => s + (p.volume24hUsd ?? 0), 0);
  const price = volume > 0 ? ecx.reduce((s, p) => s + (p.priceUsd as number) * (p.volume24hUsd as number), 0) / volume : null;
  markets = {
    updated: Math.floor(Date.now() / 1000), ecx: { priceUsd: price, volume24hUsd: volume, venues: ecx.length }, pairs,
    history: priceHistory,
  };
  return markets;
}

/** a pair's hourly candles on neoxa (the last week), for one of its ECX pairs @asyncSafe */
export async function $getCandles(pair: string): Promise<any[]> {
  if (!NEOXA_PAIRS.includes(pair)) {
    return [];
  }
  const c = candles.get(pair);
  if (c && Date.now() - c.at < CANDLES_TTL) {
    return c.value;
  }
  try {
    const d = await $get(`${NEOXA}/api/exchange/candles/${pair}?interval=1h&limit=168`);
    const value = (Array.isArray(d?.candles) ? d.candles : []).slice(-200)
      .map((k: any) => ({ time: num(k.time), open: num(k.open), high: num(k.high), low: num(k.low), close: num(k.close), volume: num(k.volume) }))
      .filter((k: any) => k.time !== null && k.close !== null);
    candles.set(pair, { at: Date.now(), value });
    return value;
  } catch (e) {
    logger.debug(`Console candles ${pair}: ${e instanceof Error ? e.message : e}`, 'Intel');
    return c?.value ?? [];
  }
}

/** a feed's text with its HTML entities as characters (&#39; is ') */
function decode(s: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    const code = e[0] === '#' ? (e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : NaN;
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : named[e.toLowerCase()] ?? m;
  });
}

/** ecash.com's blog, newest first @asyncSafe */
export async function $getNews(): Promise<typeof news> {
  if (news && Date.now() - newsAt < NEWS_TTL) {
    return news;
  }
  newsAt = Date.now();
  try {
    const xml: string = String(await $get(ECASH_BLOG, 'text'));
    const items: { title: string; link: string; time: number; source: string }[] = [];
    const tag = (s: string, t: string): string => (new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`).exec(s)?.[1] ?? '').trim();
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const link = tag(m[1], 'link');
      const time = Date.parse(tag(m[1], 'pubDate'));
      if (/^https:\/\/ecash\.com\//.test(link) && items.length < 30) {
        items.push({ title: decode(tag(m[1], 'title').replace(/<[^>]*>/g, '')).slice(0, 200), link, time: Number.isFinite(time) ? Math.floor(time / 1000) : 0, source: 'ecash.com' });
      }
    }
    news = { updated: Math.floor(Date.now() / 1000), items: items.sort((a, b) => b.time - a.time) };
  } catch (e) {
    logger.debug(`Console news: ${e instanceof Error ? e.message : e}`, 'Intel');
  }
  return news;
}

// --- the price over time --------------------------------------------------------------------------------------------

/** @asyncSafe */
async function $snapshot(): Promise<void> {
  try {
    const m = await $getMarkets();
    if (!m || m.ecx.priceUsd === null) {
      return;
    }
    const time = Math.floor(Date.now() / 1000);
    priceHistory.push({ time, priceUsd: m.ecx.priceUsd, volume24hUsd: m.ecx.volume24hUsd });
    while (priceHistory.length && priceHistory[0].time < time - INTEL_KEEP) {
      priceHistory.shift();
    }
    if (config.DATABASE.ENABLED) {
      await DB.query('INSERT IGNORE INTO chain_intel_prices (time, price_usd, volume_usd) VALUES (?,?,?)', [time, m.ecx.priceUsd, m.ecx.volume24hUsd]);
      await DB.query('DELETE FROM chain_intel_prices WHERE time < ?', [time - INTEL_KEEP]);
    }
  } catch (e) {
    logger.debug(`Console price snapshot: ${e instanceof Error ? e.message : e}`, 'Intel');
  }
}

/** load the kept snapshots, then take one every SNAPSHOT_EVERY @asyncSafe */
export async function $startIntel(): Promise<void> {
  if (started) {
    return;
  }
  started = true;
  if (config.DATABASE.ENABLED) {
    try {
      await DB.query(`CREATE TABLE IF NOT EXISTS chain_intel_prices (
        time int unsigned NOT NULL PRIMARY KEY, price_usd double NOT NULL, volume_usd double NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const [rows]: any = await DB.query('SELECT time, price_usd, volume_usd FROM chain_intel_prices WHERE time >= UNIX_TIMESTAMP() - ? ORDER BY time', [INTEL_KEEP]);
      priceHistory.push(...rows.map((r: any) => ({ time: r.time, priceUsd: r.price_usd, volume24hUsd: r.volume_usd })));
    } catch (e) {
      logger.warn(`Console: could not load the price history: ${e instanceof Error ? e.message : e}`, 'Intel');
    }
  }
  await $snapshot();
  setInterval(() => { void $snapshot(); }, SNAPSHOT_EVERY);
}
