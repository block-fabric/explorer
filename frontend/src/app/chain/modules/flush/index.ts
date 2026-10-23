import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * Flush (ECX): a Core-style sidechain of eCash (backbone-flush): blocks of stake every 15 s anchored to eCash by BMM,
 * assets, a DEX (pool kinds, concentrated liquidity, order books), bonding-curve launches, a treasury, oracles and
 * verified issuers. Its explorer runs upstream's full UI (dashboard, blocks, block, transaction, address, mempool) on
 * the Flush node, with Flush's panels on those pages (views/) and these pages, from GET /api/v1/flush/* (the node's
 * read RPCs and its public DEX API, chains/FLUSH-API.md) and the eCash explorer's drivechain API for its slot.
 *
 * Betanet runs Flush on slot 99 for now (its own slot is 46). Branding (colour, mark) is a placeholder: water, three waves.
 */
const page = (load: () => Promise<any>, name: string) => () => load().then(m => m[name]);
const dex = () => import('./pages/dex.pages');
const launch = () => import('./pages/launch.pages');
const asset = () => import('./pages/asset.pages');
const stake = () => import('./pages/stake.pages');
const peg = () => import('./pages/peg.pages');

const flush: ChainFrontendModule = {
  profile: {
    id: 'flush', kind: 'flush', name: 'Flush', tagline: 'Flush, tokens, assets and a DEX on a fast sidechain of eCash',
    unit: 'ECX', subunit: 'sats', slot: 99, mainchain: false, color: '#7d94ab', // Flush's brand blue-grey (chain.json brand.color)
    ...SIDECHAIN_MARKS.flush,
    blockWeightUnits: 4000000,
  },
  nav: [
    { path: '/pools', title: 'DEX: pools, order books, treasury', icon: 'nav-dex' },
    { path: '/assets', title: 'Assets', icon: 'nav-assets' },
    { path: '/launches', title: 'Launches', icon: 'nav-launch' },
    { path: '/stake', title: 'Stake: validators, leader schedule, anchors', icon: 'nav-stake' },
    { path: '/peg', title: 'Drivechain: the peg and BMM on eCash', icon: 'nav-drivechain' },
  ],
  footerNav: [
    { path: '/books', title: 'Order books', icon: 'nav-dex' },
    { path: '/treasury', title: 'Treasury', icon: 'nav-dex' },
    { path: '/auctions', title: 'Auctions', icon: 'nav-assets' },
    { path: '/oracles', title: 'Oracles', icon: 'nav-assets' },
    { path: '/verifications', title: 'Verified issuers', icon: 'nav-assets' },
    { path: '/bmm', title: 'BMM on eCash', icon: 'nav-drivechain' },
  ],
  routes: [
    { path: 'dex', redirectTo: 'pools', pathMatch: 'full' },
    { path: 'pools', loadComponent: page(dex, 'FlushPoolsPage') },
    { path: 'pool/:id', loadComponent: page(dex, 'FlushPoolPage') },
    { path: 'books', loadComponent: page(dex, 'FlushBooksPage') },
    { path: 'book/:base/:quote', loadComponent: page(dex, 'FlushBookPage') },
    { path: 'treasury', loadComponent: page(dex, 'FlushTreasuryPage') },
    { path: 'launches', loadComponent: page(launch, 'FlushLaunchesPage') },
    { path: 'launch/:id', loadComponent: page(launch, 'FlushLaunchPage') },
    { path: 'assets', loadComponent: page(asset, 'FlushAssetsPage') },
    { path: 'asset/:id', loadComponent: page(asset, 'FlushAssetPage') },
    { path: 'verifications', loadComponent: page(asset, 'FlushVerificationsPage') },
    { path: 'auctions', loadComponent: page(asset, 'FlushAuctionsPage') },
    { path: 'auction/:id', loadComponent: page(asset, 'FlushAuctionPage') },
    { path: 'oracles', loadComponent: page(asset, 'FlushOraclesPage') },
    { path: 'oracle/:id', loadComponent: page(asset, 'FlushOraclePage') },
    { path: 'stake', loadComponent: page(stake, 'FlushStakePage') },
    { path: 'validator/:key', loadComponent: page(stake, 'FlushValidatorPage') },
    { path: 'peg', loadComponent: page(peg, 'FlushPegPage') },
    { path: 'bmm', loadComponent: page(peg, 'FlushBmmPage') },
  ],
};

export default flush;
