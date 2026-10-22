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
  tag: string;                 // as the pool writes it, slashes included
  name: string;                // the display name
  logo: string | null;         // file under /resources/pool-logos/, null: no logo in the list
}

const POOLS: Record<NetworkId, PoolMeta[]> = {
  ecashbeta: [
    { tag: '/bip300xyz/', name: 'bip300.xyz', logo: 'bip300xyz.svg' },
    { tag: '/ecpool.tech/', name: 'eCPool.tech', logo: 'ecpool.png' },
    { tag: 'ePool', name: 'ePool', logo: 'epool.png' },
    { tag: '/powre/', name: 'Pow.re', logo: null },
    { tag: '/avonpool/', name: 'avonpool', logo: 'avonpool.svg' },
    { tag: '/ecxfreebank.com/', name: 'FreeBank', logo: 'freebank.svg' },
  ],
  ecash: [
    { tag: '/ecxfreebank.com/', name: 'FreeBank', logo: 'freebank.svg' },
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
