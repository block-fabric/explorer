import { createHash } from 'crypto';
import { BITCOIN_POOLS, BitcoinPool } from './bitcoin-pools';
import { NETWORK, NetworkId } from './networks';
import { PROFILE } from './profile';

/**
 * The eCash mining pools, per network, from LayerTwo's mining-pools list (the source of pool attribution for the
 * explorer): https://github.com/LayerTwo-Labs/mining-pools/tree/31f236b/networks/<net>/pools.json
 *
 * A pool stamps its `coinbase_tag` into the coinbase of every block it finds; that tag is the only attribution key
 * the chain gives us, so it is what we match on. The names and logos are copied from that repository (the logos into
 * frontend/src/resources/pool-logos/); update this table when the list changes.
 *
 * Mainnet and betanet are Bitcoin's chain up to their fork block: there Bitcoin's pools (chain/bitcoin-pools.ts,
 * mempool's list) attribute the blocks eCash's list does not, by their tags and payout addresses, as upstream does.
 */

export interface PoolMeta {
  id: number;                  // its unique id in mempool's pools table (from 100001: clear of mempool.space's ids)
  tag: string;                 // as the pool writes it, slashes included
  name: string;                // the display name
  logo: string | null;         // file under /resources/pool-logos/, null: no logo in the list
}

const POOLS: Record<NetworkId, PoolMeta[]> = {
  ecashbeta: [
    { id: 100001, tag: '/bip300xyz/', name: 'bip300.xyz', logo: 'bip300xyz.svg' },
    { id: 100002, tag: '/ecpool.tech/', name: 'eCPool.tech', logo: 'ecpool.png' },
    { id: 100003, tag: 'ePool', name: 'ePool', logo: 'epool.png' },
    { id: 100004, tag: '/powre/', name: 'Pow.re', logo: null },
    { id: 100005, tag: '/avonpool/', name: 'avonpool', logo: 'avonpool.svg' },
    { id: 100006, tag: '/ecxfreebank.com/', name: 'FreeBank', logo: 'freebank.svg' },
  ],
  ecash: [
    { id: 100006, tag: '/ecxfreebank.com/', name: 'FreeBank', logo: 'freebank.svg' },
  ],
  ecashtest: [],
};

const key = (tag: string): string => tag.trim().replace(/^\/+|\/+$/g, '').trim().toLowerCase();

/** A coinbase tag without the slashes and padding a pool may wrap it in, for display */
export function normalizeTag(tag: string | null | undefined): string | null {
  if (!tag) {
    return null;
  }
  const t = tag.trim().replace(/^\/+|\/+$/g, '').trim();
  return t || null;
}

/** The pool a coinbase tag belongs to on this network, if the list knows it */
export function poolFor(tag: string | null | undefined): PoolMeta | null {
  if (!tag) {
    return null;
  }
  const pools = POOLS[NETWORK.id] ?? [];
  const exact = pools.find(p => p.tag === tag);
  if (exact) {
    return exact;
  }
  const k = key(tag);
  return pools.find(p => key(p.tag) === k) ?? null;
}

/** The display name of a coinbase tag: the pool's, else the tag without its slashes */
export function poolName(tag: string | null | undefined): string | null {
  return poolFor(tag)?.name ?? normalizeTag(tag);
}

/** The logo file of a coinbase tag, if the list has one */
export function poolLogo(tag: string | null | undefined): string | null {
  return poolFor(tag)?.logo ?? null;
}

/**
 * FreeBank's block producers (its blocks are BMM'd: the producer stamps its tag, without slashes, in the coinbase), from
 * the FreeBank explorer's list (mbdrivechains/freebank-explorer backend/src/tasks/freebank-pools.json)
 */
const FREEBANK_PRODUCERS: PoolMeta[] = [
  { id: 100006, tag: 'ecxfreebank.com', name: 'FreeBank', logo: 'freebank.svg' },
];

/**
 * The pools of this explorer's chain: eCash's on its network; FreeBank's producers; none for Flush (blocks of stake,
 * every one "Unknown")
 */
function chainPools(): PoolMeta[] {
  return PROFILE.kind === 'flush' ? [] : PROFILE.kind === 'freebank' ? FREEBANK_PRODUCERS : POOLS[NETWORK.id] ?? [];
}

/** Bitcoin's pools on this explorer's chain: the eCash explorer of a network with Bitcoin's history (a fork block) */
function bitcoinPools(): BitcoinPool[] {
  return PROFILE.kind === 'l1' && NETWORK.fork ? BITCOIN_POOLS : [];
}

/** Compiled tags of Bitcoin's pools (a tag that is not a valid regular expression never matches) */
const bitcoinTags = new Map<BitcoinPool, RegExp[]>();
function tagsOf(p: BitcoinPool): RegExp[] {
  let res = bitcoinTags.get(p);
  if (!res) {
    res = p.tags.flatMap(t => { try { return [new RegExp(t)]; } catch { return []; } });
    bitcoinTags.set(p, res);
  }
  return res;
}

/**
 * The Bitcoin pool of a coinbase on this network, as upstream attributes it: its text matches one of the pool's tags,
 * or it pays one of the pool's addresses
 */
export function bitcoinPoolFor(coinbaseText: string, payouts: string[]): BitcoinPool | null {
  const pools = bitcoinPools();
  return pools.find(p => tagsOf(p).some(re => re.test(coinbaseText)))
    ?? pools.find(p => p.addresses.some(a => payouts.includes(a))) ?? null;
}

/**
 * This network's pools in mempool's pools-v2.json format, for upstream's block attribution (tasks/pools-updater.ts
 * imports it instead of mempool.space's Bitcoin list): the coinbase tag, escaped, is the regex its blocks match; then
 * Bitcoin's pools as mempool's list has them
 */
export function poolsJson(): { id: number; name: string; link: string; addresses: string[]; tags: string[] }[] {
  return [...chainPools().map(p => ({
    id: p.id, name: p.name, link: '', addresses: [], tags: [p.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')],
  })), ...bitcoinPools().map(p => ({ id: p.id, name: p.name, link: p.link, addresses: p.addresses, tags: p.tags }))];
}

/** A version stamp of this network's pool list (stands in for the GitHub sha of pools-v2.json) */
export function poolsSha(): string {
  return createHash('sha256').update(JSON.stringify(poolsJson())).digest('hex').slice(0, 40);
}

/** The pools-table unique ids this network's list uses */
export function poolIds(): number[] {
  return [...chainPools(), ...bitcoinPools()].map(p => p.id);
}
