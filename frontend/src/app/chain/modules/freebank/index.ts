import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { ChainFrontendModule } from '@app/chain/chain-module';
import { SIDECHAIN_MARKS } from '@app/chain/marks';

/**
 * FreeBank (ECX): a drivechain sidechain of eCash on slot 130 (mbdrivechains/freebank, freebankd: a Bitcoin Core 0.16
 * base whose blocks come by blind merged mining), with credit on top: discount houses (escrow, attested reserves,
 * notes, members-only houses, token claims at a failed house), bills of exchange (issue, endorse, discount into a
 * house's loan book, retire, recourse), term deposits, settlements, note pools and a gold-price oracle. Its explorer runs
 * upstream's full UI (dashboard, blocks, block, transaction, mempool) on the FreeBank node, with FreeBank's panels on
 * those pages (views/) and these pages, from GET /api/v1/freebank/* (the node's allowlisted read RPCs, a transaction's
 * credit operation, the blocks' BMM fields: chains/FREEBANK-API.md) and the eCash explorer's drivechain API for its slot.
 * The backend keeps no address index: the address page says so (addressIndex false).
 */
const page = (load: () => Promise<any>, name: string) => () => load().then(m => m[name]);
const houses = () => import('./pages/houses.pages');
const bills = () => import('./pages/bills.pages');
const peg = () => import('./pages/peg.pages');
const gold = () => import('./pages/gold.pages');

type Get = <T>(path: string) => Observable<T>;
/** a list read of the node that is not empty */
const nonEmpty = (get: Get, method: string): Observable<boolean> =>
  get<unknown[]>('freebank/rpc/' + method).pipe(map(l => Array.isArray(l) && l.length > 0), catchError(() => of(false)));

/** "house 3", "house #3", "h3"; "bill 12", "b12"; "pool 2" */
const SEARCH: [RegExp, string][] = [[/^(?:house|h)\s*#?\s*(\d{1,9})$/i, '/house'], [/^(?:bill|b)\s*#?\s*(\d{1,9})$/i, '/bill'], [/^pool\s*#?\s*(\d{1,9})$/i, '/pool']];

const freebank: ChainFrontendModule = {
  profile: {
    id: 'freebank', kind: 'freebank', name: 'FreeBank', tagline: 'Discount houses, notes and bills of exchange on a sidechain of eCash',
    unit: 'ECX', subunit: 'sats', slot: 130, mainchain: false, color: '#c9a227', // FreeBank's gold
    ...SIDECHAIN_MARKS.freebank,
    blockWeightUnits: 4000000,
  },
  /** chainparams (beta and main alike): base58 P2PKH version 75 ('X'), P2SH 125 ('s'), bech32 fbk (regtest fbkrt) */
  addresses: {
    ecash: { bech32: 'fbk', p2pkh: 75, p2sh: 125, base58: { pubkey: ['X'], script: ['s'] } },
    ecashbeta: { bech32: 'fbk', p2pkh: 75, p2sh: 125, base58: { pubkey: ['X'], script: ['s'] } },
    ecashtest: { bech32: 'fbk', p2pkh: 75, p2sh: 125, base58: { pubkey: ['X'], script: ['s'] } },
  },
  addressIndex: false,
  broadcast: false,
  nav: [
    { path: '/houses', title: 'Discount houses', icon: 'nav-house' },
    { path: '/bills', title: 'Bills of exchange', icon: 'nav-bill' },
    { path: '/loanbook', title: 'Loan book', icon: 'nav-loanbook' },
    { path: '/peg', title: 'Drivechain: the peg and BMM on eCash', icon: 'nav-drivechain' },
    { path: '/gold', title: 'Gold fix and oracles', icon: 'nav-gold' },
    { path: '/pools', title: 'Note pools', icon: 'nav-dex' },
    { path: '/assets', title: 'Assets', icon: 'nav-assets' },
  ],
  footerNav: [
    { path: '/bmm', title: 'BMM on eCash', icon: 'nav-drivechain' },
  ],
  /** gold, pools and assets only once there is something to show */
  navIf: {
    '/gold': get => combineLatest([get<unknown>('freebank/rpc/getgoldfix').pipe(catchError(() => of(null))), nonEmpty(get, 'listoraclesubmitters')])
      .pipe(map(([fix, subs]) => !!fix || subs)),
    '/pools': get => nonEmpty(get, 'listpools'),
    '/assets': get => nonEmpty(get, 'listassets'),
  },
  routes: [
    { path: 'houses', loadComponent: page(houses, 'FreebankHousesPage') },
    { path: 'house/:id', loadComponent: page(houses, 'FreebankHousePage') },
    { path: 'bills', loadComponent: page(bills, 'FreebankBillsPage') },
    { path: 'bill/:id', loadComponent: page(bills, 'FreebankBillPage') },
    { path: 'loanbook', loadComponent: page(bills, 'FreebankLoanbookPage') },
    { path: 'peg', loadComponent: page(peg, 'FreebankPegPage') },
    { path: 'bmm', loadComponent: page(peg, 'FreebankBmmPage') },
    { path: 'gold', loadComponent: page(gold, 'FreebankGoldPage') },
    { path: 'pools', loadComponent: page(gold, 'FreebankPoolsPage') },
    { path: 'pool/:id', loadComponent: page(gold, 'FreebankPoolPage') },
    { path: 'assets', loadComponent: page(gold, 'FreebankAssetsPage') },
  ],
  /** its views on upstream's pages (app-l2-view); no address view: there is no address index */
  views: {
    block: () => import('./views/freebank-block-panel.component').then(m => m.FreebankBlockPanelComponent),
    tx: () => import('./views/freebank-tx-panel.component').then(m => m.FreebankTxPanelComponent),
    widget: () => import('./views/freebank-widget.component').then(m => m.FreebankWidgetComponent),
  },
  /** its dashboard widgets (views/freebank-widget.component.ts) */
  dashboard: {
    chain: { kind: 'freebank-chain' }, treasury: { kind: 'freebank-credit', title: 'Credit' }, bmm: { kind: 'freebank-bmm', title: 'Blind merged mining' },
    bundles: { kind: 'freebank-houses', title: 'Discount houses' }, peg: { kind: 'freebank-peg', title: 'Drivechain' },
    deposits: { kind: 'freebank-peg', title: 'Drivechain' }, withdrawals: { kind: 'freebank-bills', title: 'Bills nearest maturity' },
  },
  searchRoute: (text: string) => {
    for (const [re, path] of SEARCH) {
      const m = re.exec(text.trim());
      if (m) {
        return [path, m[1]];
      }
    }
    return null;
  },
};

export default freebank;
