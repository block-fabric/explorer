import { NavItem } from '@app/chain/chain-module';

/**
 * The feature pages of the sidechain explorers (GET /api/v1/l2/feature/<api>): which chain feature each belongs to
 * (GET /api/v1/chain features), and whether its items have a page of their own (feature/<api>/:id).
 */
export interface L2FeaturePage {
  /** route path and title */
  path: string;
  title: string;
  feature: string;
  /** GET /api/v1/l2/feature/<api> */
  api: string;
  /** what an item of the list is called */
  item: string;
  /** items have a page, /<path>/:id */
  detail: boolean;
  /** a line under the title */
  about: string;
  /** a note under it */
  note?: string;
}

export const L2_FEATURE_PAGES: L2FeaturePage[] = [
  { path: 'names', title: 'Names', feature: 'names', api: 'names', item: 'BitName', detail: true,
    about: 'The BitNames registered on this sidechain (the node\'s bitnames list), by name hash' },
  { path: 'assets', title: 'Assets', feature: 'assets', api: 'assets', item: 'BitAsset', detail: true,
    about: 'The BitAssets registered on this sidechain (the node\'s bitassets list)' },
  { path: 'auctions', title: 'Dutch auctions', feature: 'assets', api: 'auctions', item: 'Auction', detail: false,
    about: 'Dutch auctions of BitAssets (the node\'s dutch_auctions)' },
  { path: 'pools', title: 'AMM pools', feature: 'assets', api: 'pools', item: 'Pool', detail: false,
    about: 'The AMM pools seen in the index, with their state (get_amm_pool_state)' },
  { path: 'markets', title: 'Markets', feature: 'markets', api: 'markets', item: 'Market', detail: true,
    about: 'Hivemind\'s prediction markets (the node\'s market_list)' },
  { path: 'decisions', title: 'Decisions', feature: 'markets', api: 'decisions', item: 'Decision', detail: true,
    about: 'The oracle\'s decisions past "created": claimed, voting and resolved, with the markets that use them' },
  { path: 'votes', title: 'Votes', feature: 'markets', api: 'votes', item: 'Vote', detail: false,
    about: 'The oracle\'s current voting period, the Votecoin holders (voters) and the decision slot pricing' },
  { path: 'shielded', title: 'Shielded pool', feature: 'shielded', api: 'shielded', item: 'Total', detail: false,
    about: 'zSide\'s Orchard pool: what went in and out of it, from the index' },
  { path: 'richlist', title: 'Top addresses', feature: 'richlist', api: 'richlist', item: 'Address', detail: false,
    about: 'The addresses holding the most sats, and the payments over the chain\'s blocks, from the index' },
  { path: 'swaps', title: 'Swaps', feature: 'swaps', api: 'swaps', item: 'Swap', detail: true,
    about: 'Coinshift\'s swaps between a parent chain (L1) and Coinshift: the L1 recipient and amount, the L2 amount, state, confirmations and expiry',
    note: 'A swap\'s state is partly node-local in Coinshift\'s design: until it is claimed on the sidechain, what this node knows of '
      + 'its parent-chain payment (state, confirmations) can differ from another node\'s.' },
];

export function featurePage(path: string): L2FeaturePage | undefined {
  return L2_FEATURE_PAGES.find(p => p.path === path);
}

/** The pages of the chain's features: all of them (footer), or the first of each feature (header) */
export function l2FeatureNav(features: string[], firstOnly = false): NavItem[] {
  const seen = new Set<string>();
  return L2_FEATURE_PAGES
    .filter(p => features.includes(p.feature))
    .filter(p => !firstOnly || (!seen.has(p.feature) && !!seen.add(p.feature)))
    .map(p => ({ path: '/' + p.path, title: p.title, icon: 'chain-mark' }));
}

/** The core pages of a sidechain explorer */
export const L2_NAV: NavItem[] = [
  { path: '/blocks', title: 'Blocks', icon: 'nav-cubes' },
  { path: '/bmm', title: 'Drivechain: BMM, deposits and withdrawals', icon: 'nav-drivechain' },
];
