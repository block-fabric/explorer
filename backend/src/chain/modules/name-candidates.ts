/**
 * Plain names to try against the name hashes of BitNames and BitAssets (blake3 of the plain name): the chains keep
 * only the hash, so the explorers show a name only when one of these hashes to it (l2-views.ts revealNames), or a
 * BitNames BatchIcann tx reveals it. A wrong candidate can never label anything: its hash would differ. Add the
 * names people register here to have them shown.
 */

const TICKERS = [
  'ECX', 'ECASH', 'BTC', 'XBT', 'SATS', 'ETH', 'USD', 'USDT', 'USDC', 'DAI', 'EUR', 'EURC', 'GBP', 'JPY', 'CHF', 'CNY', 'GOLD', 'SILVER', 'XAU',
  'XAG', 'OIL', 'BETA', 'TEST', 'DEMO', 'DOGE', 'SKYDOGE', 'SKY', 'PEPE', 'MOON', 'LTC', 'BCH', 'XMR', 'ZEC', 'SOL', 'ADA', 'DOT', 'LINK',
  'UNI', 'AAVE', 'SHIB', 'BNB', 'XRP', 'TRX', 'TON', 'AVAX', 'MATIC', 'ATOM', 'NEAR', 'ARB', 'OP', 'WBTC', 'STETH', 'THUNDER', 'ZSIDE',
  'HIVE', 'HIVEMIND', 'VOTE', 'VOTECOIN', 'NAMES', 'ASSET', 'ASSETS', 'TOKEN', 'COIN', 'CASH', 'LP', 'AMM', 'DEX', 'FX', 'FXHA',
  'BITASSETS', 'BITNAMES', 'COINSHIFT', 'TRUTHCOIN', 'DRIVECHAIN', 'LAYERTWO', 'L2', 'BIP300', 'BIP301', 'SATOSHI', 'NAKAMOTO',
];

const WORDS = [
  'alice', 'bob', 'carol', 'dave', 'eve', 'test', 'test1', 'test2', 'test3', 'testing', 'hello', 'world', 'helloworld', 'example', 'demo',
  'foo', 'bar', 'baz', 'name', 'names', 'admin', 'root', 'www', 'mail', 'api', 'node', 'seed', 'explorer', 'pool', 'mempool', 'wallet',
  'bitcoin', 'satoshi', 'nakamoto', 'hal', 'finney', 'paul', 'sztorc', 'paulsztorc', 'truthcoin', 'hivemind', 'thunder', 'zside',
  'coinshift', 'bitnames', 'bitassets', 'layertwo', 'layer2', 'drivechain', 'drivechains', 'ecash', 'skydoge', 'blockfab', 'beta',
  'betanet', 'mainnet', 'testnet', 'signet', 'regtest', 'google', 'apple', 'amazon', 'microsoft', 'github', 'twitter', 'x', 'facebook',
  'bank', 'money', 'gold', 'silver', 'btc', 'eth', 'usd', 'eur', 'doge', 'pepe', 'moon', 'lambo', 'hodl', 'gm', 'wagmi', 'fxha',
  'louis', 'elektron', 'news', 'shop', 'store', 'blog', 'chat', 'music', 'game', 'games', 'art', 'nft', 'dao', 'defi', 'web', 'web3',
];

const TLDS = ['', '.com', '.org', '.net', '.io', '.btc', '.eu', '.xyz', '.bit'];

function* variants(): Generator<string> {
  for (const t of TICKERS) {
    yield t;
    yield t.toLowerCase();
    yield t[0] + t.slice(1).toLowerCase();
  }
  for (const w of WORDS) {
    for (const tld of TLDS) {
      yield w + tld;
    }
    yield w.toUpperCase();
    yield w[0].toUpperCase() + w.slice(1);
  }
}

export const NAME_CANDIDATES: string[] = [...new Set(variants())];
