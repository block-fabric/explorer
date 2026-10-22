import { ChainInfo } from '@app/chain/chain.interfaces';
import { NETWORKS, PROFILE, PROFILES } from '@app/chain/profiles';

export interface ChainLink {
  id: string;
  name: string;
  /** the mark (app-svg-images chain-mark fill) and its colour */
  mark: string;
  color: string;
  url: string | null;
  here: boolean;
}

/**
 * The explorers of the other chains of this network (GET /api/v1/chain): the eCash explorer and the sidechain
 * explorers, each with a URL (null: not running, hidden). The header shows it next to the network switcher, on the
 * eCash explorer and on the sidechain explorers alike.
 */
export function chainLinks(c: ChainInfo | null): ChainLink[] {
  const link = (id: string, url: string | null, name?: string): ChainLink => {
    const p = PROFILES[id];
    return { id, name: p?.name ?? name ?? id, mark: p ? id : 'sidechain', color: p?.color ?? '#9aa4b2', url, here: id === PROFILE.id };
  };
  const out: ChainLink[] = [];
  const explorers = c?.explorers ?? {};
  const ecashUrl = PROFILE.mainchain ? null : (c?.mainchainExplorer ?? explorers['ecash'] ?? null);
  out.push(link('ecash', ecashUrl, 'eCash'));
  const slots = new Map((c?.sidechains ?? []).map(s => [s.id, s]));
  // the explorers map is keyed by chain (profile) id and, for the eCash explorer, by network id too (ecashbeta, ...):
  // the network ids belong to the network switcher, not here; the eCash entry is the mainchain explorer above
  const networkIds = new Set<string>([...Object.keys(NETWORKS), ...(c?.networks ?? []).map(n => n.id)]);
  const ids = Object.keys(explorers).filter(id => id !== 'ecash' && (!networkIds.has(id) || !!PROFILES[id]));
  if (!PROFILE.mainchain && !ids.includes(PROFILE.id)) {
    ids.push(PROFILE.id);
  }
  ids.sort((a, b) => (PROFILES[a]?.slot ?? slots.get(a)?.slot ?? 999) - (PROFILES[b]?.slot ?? slots.get(b)?.slot ?? 999));
  for (const id of ids) {
    out.push(link(id, explorers[id] ?? null, slots.get(id)?.name));
  }
  return out.filter(l => l.here || !!l.url);
}
