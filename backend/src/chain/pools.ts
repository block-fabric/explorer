import { createHash } from 'crypto';
import { NETWORK, NetworkId } from './networks';

/**
 * The eCash mining pools, per network, from LayerTwo's mining-pools list (the source of pool attribution for the
 * explorer): https://github.com/LayerTwo-Labs/mining-pools/tree/31f236b/networks/<net>/pools.json
 *
 * A pool stamps its `coinbase_tag` into the coinbase of every block it finds; that tag is the only attribution key
 * the chain gives us, so it is what we match on. The names and logos are copied from that repository (the logos into
 * frontend/src/resources/pool-logos/); update this table when the list changes.
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
 * This network's pools in mempool's pools-v2.json format, for upstream's block attribution (tasks/pools-updater.ts
 * imports it instead of mempool.space's Bitcoin list): the coinbase tag, escaped, is the regex its blocks match.
 */
export function poolsJson(): { id: number; name: string; link: string; addresses: string[]; tags: string[] }[] {
  return (POOLS[NETWORK.id] ?? []).map(p => ({
    id: p.id, name: p.name, link: '', addresses: [], tags: [p.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')],
  }));
}

/** A version stamp of this network's pool list (stands in for the GitHub sha of pools-v2.json) */
export function poolsSha(): string {
  return createHash('sha256').update(JSON.stringify(poolsJson())).digest('hex').slice(0, 40);
}

/** The pools-table unique ids this network's list uses */
export function poolIds(): number[] {
  return (POOLS[NETWORK.id] ?? []).map(p => p.id);
}
