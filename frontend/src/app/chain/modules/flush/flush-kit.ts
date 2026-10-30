import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { PROFILE } from '@app/chain/profiles';
import { SidechainLabelComponent } from '@app/chain/components/sidechain-label/sidechain-label.component';
import { ChainTableComponent, CxCellDirective, CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { ECASH_GOLD, ECASH_MARK_PATHS, ECASH_MARK_VIEWBOX } from '@app/chain/marks';
import { Observable, catchError, map, of } from 'rxjs';
import { FlushApiService, FlushLoaded } from './flush-api.service';
import { AssetInfo, ECX_ID, FlushAssetsService } from './flush-assets.service';
import { Holder, LaunchSummary, Pool, Trade, TreasuryInflow } from './flush.interfaces';
import * as F from './flush-format';

/*
 * The building blocks of Flush's pages: request states, tokens (logo or letter, ticker, link), page heads with their
 * sibling tabs, addresses, and the tables of pools, launches, trades and holders. Everything from the chain goes through
 * interpolation and property bindings (never [innerHTML]); creators' links only after safeLink.
 */

/** the formatting helpers, for templates */
export const FX = F;

function hue(s: string): number {
  let h = 0;
  for (const c of s.slice(0, 12)) {
    h = (h * 31 + c.charCodeAt(0)) % 360;
  }
  return h;
}

/** A request's loading, not found, unavailable and failed states */
@Component({
  selector: 'app-flush-state',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.unavail { padding: 18px; border-radius: 8px; background: var(--box-bg); color: var(--transparent-fg); }`],
  template: `
    @if (state?.loading) {
      <div class="skeleton-loader" [style.height.px]="height"></div>
    } @else if (state?.error; as e) {
      @if (e.unavailable || (list && e.status === 404)) {
        <div class="unavail">{{ what }}: not available on this network yet. Flush's public API here does not serve it.</div>
      } @else if (e.status === 404) {
        <div class="alert alert-warning">{{ what }} not found{{ id ? ': ' : '' }}<span class="text-break">{{ id }}</span></div>
      } @else if (e.status === 400) {
        <div class="alert alert-warning">Not a valid {{ what.toLowerCase() }}{{ id ? ': ' : '' }}<span class="text-break">{{ id }}</span></div>
      } @else {
        <div class="alert alert-warning">{{ what }} is not available: {{ e.message }}</div>
      }
    }`,
})
export class FlushStateComponent {
  @Input() state: FlushLoaded<any> | null;
  @Input() what = 'Data';
  @Input() id: string | null = null;
  @Input() height = 200;
  /** a list (or a page of the API): a 404 means the API has no such route here */
  @Input() list = false;
}

/** A token: its logo (or a letter in a colour of its own), its ticker, a link to its page; ECX with eCash's mark */
@Component({
  selector: 'app-flush-token',
  standalone: true,
  imports: [CommonModule, RouterModule, SidechainLabelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; max-width: 100%; }
    .tk { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: inherit; text-decoration: none; }
    a.tk .t { color: var(--chain-accent, var(--title-fg)); }
    a.tk:hover .t { text-decoration: underline; }
    .dot { flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #11131f; font-weight: 800; overflow: hidden; }
    .dot img { width: 100%; height: 100%; object-fit: cover; }
    .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .n { color: var(--transparent-fg); font-size: 0.8em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `],
  template: `
    @if (ecx) {
      <span class="tk" title="ECX, eCash's coin (8 decimals)"><app-sidechain-label chain="ecash" name="ECX"></app-sidechain-label></span>
    } @else {
      <a class="tk" [routerLink]="link ? ['/asset', ref] : null" [title]="(ticker || '') + (name ? ' · ' + name : '') + (id ? '\\n' + id : '')">
        <span class="dot" [style.width.px]="size" [style.height.px]="size" [style.font-size.px]="size * 0.55" [style.background]="color">
          @if (logoSrc && !logoFailed) {<img [src]="logoSrc" alt="" (error)="logoFailed = true">} @else {<span>{{ initial }}</span>}
        </span>
        <span class="t">{{ ticker || short }}</span>
        @if (name && showName) {<span class="n">{{ name }}</span>}
      </a>
    }`,
})
export class FlushTokenComponent implements OnChanges {
  @Input() ticker: string | null | undefined;
  @Input() id: string | null | undefined;
  /** the API's logo field: null when the asset has none */
  @Input() logo: string | null | undefined = null;
  @Input() name: string | null | undefined = null;
  @Input() showName = false;
  @Input() link = true;
  @Input() size = 18;
  ecx = false;
  ref = '';
  short = '';
  initial = '?';
  color = '#9aa4b2';
  logoSrc: string | null = null;
  logoFailed = false;

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    const t = String(this.ticker ?? '');
    this.ecx = t.toUpperCase() === 'ECX' && !this.id || /^0{64}$/.test(String(this.id ?? ''));
    this.ref = t || String(this.id ?? '');
    this.short = F.shortId(this.id, 6);
    this.initial = (t || String(this.id ?? '?')).charAt(0).toUpperCase();
    this.color = `hsl(${hue(String(this.id || t))}, 60%, 68%)`;
    this.logoFailed = false;
    this.logoSrc = this.logo && this.id ? this.api.logoUrl(this.id) : null;
  }
}

/** An asset named by its id (the node's getasset: ticker, decimals), with an amount in its units or whole units */
@Component({
  selector: 'app-flush-asset',
  standalone: true,
  imports: [CommonModule, FlushTokenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; } .mono { font-family: monospace; font-size: 0.8rem; } .a { font-variant-numeric: tabular-nums; }`],
  template: `
    @if (info$ | async; as i) {
      @if (hasAmount) {<span class="a" [class.pos]="signed && value(i) > 0">{{ signed && value(i) > 0 ? '+' : '' }}{{ fx.amount(value(i), i.decimals) }}</span>}
      <app-flush-token [ticker]="i.ticker" [id]="i.id === ecx ? null : i.id" [logo]="i.hasLogo ? 'logo' : null" [name]="i.displayName" [showName]="showName"></app-flush-token>
    } @else {
      @if (hasAmount) {<span class="a">{{ units ?? amount }}</span>}<span class="mono" [title]="id || ''">{{ fx.shortId(id, 6) }}</span>
    }`,
})
export class FlushAssetComponent implements OnChanges {
  @Input() id: string | null | undefined;
  /** an amount in the asset's smallest units (decodeassettx) */
  @Input() units: number | string | null | undefined = null;
  /** or in whole units */
  @Input() amount: number | null | undefined = null;
  @Input() showName = false;
  @Input() signed = false;
  info$: Observable<AssetInfo | null>;
  hasAmount = false;
  ecx = ECX_ID;
  fx = F;

  constructor(private assets: FlushAssetsService) {}

  ngOnChanges(): void {
    this.info$ = this.assets.info$(this.id);
    this.hasAmount = (this.units !== null && this.units !== undefined) || (this.amount !== null && this.amount !== undefined);
  }

  value(i: AssetInfo): number {
    return this.units !== null && this.units !== undefined ? Number(this.units) / Math.pow(10, i.decimals) : Number(this.amount);
  }
}

/** A link to the eCash explorer (block by hash or height, tx, address), plain text when there is none */
@Component({
  selector: 'app-flush-ecash',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.mono { font-family: monospace; } :host { white-space: nowrap; } .m { width: 1.05em; height: 1.05em; vertical-align: -0.18em; margin-right: 0.3em; }`],
  template: `@if (mark) {<svg class="m" [attr.viewBox]="viewBox" aria-hidden="true" focusable="false">@for (d of paths; track $index) {<path [attr.d]="d" [attr.fill]="gold"></path>}</svg>}@if (base$ | async; as base) {<a [href]="base + '/' + kind + '/' + id" [title]="'On the eCash explorer: ' + kind + ' ' + id" [class.mono]="kind !== 'block'">{{ text ?? id }}</a>} @else {<span [class.mono]="kind !== 'block'" [title]="id">{{ text ?? id }}</span>}`,
})
export class FlushEcashLinkComponent {
  @Input() kind: 'block' | 'tx' | 'address' = 'block';
  @Input() id: string | number = '';
  @Input() text: string | null = null;
  @Input() mark = true;
  base$: Observable<string | null>;
  paths = ECASH_MARK_PATHS;
  viewBox = ECASH_MARK_VIEWBOX;
  gold = ECASH_GOLD;

  constructor(api: FlushApiService) {
    this.base$ = api.mainchain$;
  }
}

/** An address of the chain (its holdings page), or a curve's or pool's holding ("pool:<id>") */
@Component({
  selector: 'app-flush-addr',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host { display: inline; } .mono { font-family: monospace; font-size: 0.82rem; }`],
  template: `
    @if (pool) {
      <a [routerLink]="['/pool', pool]" class="mono" [title]="address">{{ kind }} {{ short ? shortId(pool, 6) : pool }}</a>
    } @else if (address) {
      <a [routerLink]="['/address', address]" class="mono" [title]="address">{{ short ? shortId(address, 8) : address }}</a>
    } @else {<span class="muted">–</span>}`,
})
export class FlushAddrComponent implements OnChanges {
  @Input() address: string | null | undefined;
  @Input() short = true;
  pool: string | null = null;
  kind = '';
  shortId = F.shortId;

  ngOnChanges(): void {
    const m = /^(pool|curve):([0-9a-f]{64})$/.exec(String(this.address ?? ''));
    this.pool = m ? m[2] : null;
    this.kind = m ? (m[1] === 'curve' ? 'curve' : 'pool') : '';
  }
}

export interface FlushTab { path: string; title: string }

export const DEX_TABS: FlushTab[] = [
  { path: '/pools', title: 'Pools' }, { path: '/books', title: 'Order books' }, { path: '/auctions', title: 'Auctions' },
  { path: '/treasury', title: 'Treasury' },
];
export const ASSET_TABS: FlushTab[] = [
  { path: '/assets', title: 'Assets' }, { path: '/launches', title: 'Launches' }, { path: '/oracles', title: 'Oracles' },
  { path: '/verifications', title: 'Verified issuers' },
];
export const STAKE_TABS: FlushTab[] = [{ path: '/stake', title: 'Validators and anchors' }, { path: '/fees', title: 'Fees' }];
export const PEG_TABS: FlushTab[] = [{ path: '/peg', title: 'The peg' }, { path: '/bmm', title: 'BMM on eCash' }];

/** An asset whose control coin is still held: its supply is unlocked (the holder can mint more), said where it is traded.
 *  Its own getasset (not the shared cache): a failed lookup says so rather than passing for a fixed supply */
@Component({
  selector: 'app-flush-supply',
  standalone: true,
  imports: [CommonModule, RouterModule, FlushAddrComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.n { display: block; padding: 8px 12px; margin-bottom: 12px; border-radius: 8px; font-size: 0.85rem; }
    .unlocked { border: 1px solid #f5b83d55; background: #f5b83d14; } .unlocked b { color: #ffd98a; }
    .unknown { border: 1px solid var(--cx-rule, #ffffff20); color: var(--transparent-fg); }`],
  template: `
    @if (state$ | async; as st) {
      @if (st.control; as c) {
        <div class="n unlocked"><b>Supply unlocked:</b> the control coin of {{ st.ticker }}
          (<a [routerLink]="['/tx', c.txid]" class="mono">{{ fx.shortId(c.txid) }}:{{ c.vout }}</a>) is still held@if (c.address) { by <app-flush-addr [address]="c.address"></app-flush-addr>},
          so its holder can mint more {{ st.ticker }} and change the asset. Its supply is capped only once the control coin is given up.</div>
      } @else if (st.unknown) {
        <div class="n unknown">Whether {{ st.ticker }}'s supply is fixed could not be checked right now.</div>
      }
    }`,
})
export class FlushSupplyComponent implements OnChanges {
  /** the asset's id, or its ticker (case as registered); ECX, the chain's coin, has none */
  @Input() id: string | null | undefined;
  state$: Observable<{ ticker: string; control: { txid: string; vout: number; address?: string } | null; unknown: boolean } | null>;
  fx = F;

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    const t = String(this.id ?? '').trim();
    this.state$ = !t || t.toLowerCase() === ECX_ID || t.toLowerCase() === 'ecx' ? of(null) : this.api.rpc$<any>('getasset', F.assetArg(t)).pipe(
      map(a => ({ ticker: String(a?.name ?? t), control: a?.control?.txid ? a.control : null, unknown: !a || typeof a.fixed !== 'boolean' })),
      catchError(() => of({ ticker: F.isId(t) ? F.shortId(t, 6) : t, control: null, unknown: true })),
    );
  }
}

/** A page's head: the chain's mark, title, a line under it, the sibling pages' tabs */
@Component({
  selector: 'app-flush-head',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', './flush-page.scss'],
  template: `
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="28" height="28" class="cmark"></app-svg-images> {{ title }}<ng-content></ng-content></h1>
    @if (sub) {<div class="sub">{{ sub }}</div>}
    @if (tabs?.length) {
      <div class="ftabs">@for (t of tabs; track t.path) {<a [routerLink]="[t.path]" [class.on]="t.path === active">{{ t.title }}</a>}</div>
    }`,
})
export class FlushHeadComponent {
  @Input() title = '';
  @Input() sub: string | null = null;
  @Input() tabs: FlushTab[] | null = null;
  @Input() active = '';
  profile = PROFILE;
}

const TABLE_STYLES = ['../../components/module-page.scss', '../../l2/pages/l2-page.scss', './flush-page.scss'];

/** The pools of the market index: pair, kind, price, liquidity, 24 h volume and change */
@Component({
  selector: 'app-flush-pools',
  standalone: true,
  imports: [CommonModule, RouterModule, FlushTokenComponent, ChainTableComponent, CxCellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: TABLE_STYLES,
  template: `
    <app-chain-table [rows]="pools" [columns]="cols" [filters]="filters" [search]="searchable ? matches : null" searchPlaceholder="Ticker or pool id"
        [pageSize]="pageSize" [empty]="empty" [trackBy]="trackPool">
      <ng-template cxCell="pool" let-p><a [routerLink]="['/pool', p.pool]" class="me-1" title="The pool's page">⇄</a>
        <app-flush-token [ticker]="p.asset_a" [id]="p.asset_a_id" [logo]="p.logo"></app-flush-token> / <app-flush-token [ticker]="p.asset_b" [id]="p.asset_b_id"></app-flush-token>
        @if (p.locked) {<span class="pill ms-1" title="A graduated launch's pool: its first shares are nobody's, its liquidity stays for good">locked</span>}
        @if (p.abandoned) {<span class="pill warn ms-1">abandoned</span>}</ng-template>
      <ng-template cxCell="kind" let-p><a [routerLink]="['/pool', p.pool]"><span class="pill on">{{ fx.kindLabel(p.curve) }}</span></a><span class="muted ms-1">{{ kindDetail(p) }}</span></ng-template>
      <ng-template cxCell="price" let-p>{{ fx.price(p.price) }} <span class="muted">{{ p.asset_b }}</span></ng-template>
      <ng-template cxCell="liquidity" let-p>@if (p.depth_ecx || p.liquidity_ecx) {<span>{{ fx.compact(p.liquidity_ecx || p.depth_ecx * 2) }} </span><span class="muted">ECX</span>} @else {<span class="muted">–</span>}</ng-template>
      <ng-template cxCell="volume" let-p>{{ fx.compact(p.volume_24h) }}</ng-template>
      <ng-template cxCell="change" let-p><span [class.pos]="(p.change_24h ?? 0) > 0" [class.neg]="(p.change_24h ?? 0) < 0">{{ fx.change(p.change_24h) }}</span></ng-template>
      <ng-template cxCell="reserves" let-p>{{ fx.compact(p.reserve_a) }} / {{ fx.compact(p.reserve_b) }}</ng-template>
      <ng-template cxCell="swaps" let-p>{{ p.swaps | number }}</ng-template>
    </app-chain-table>`,
})
export class FlushPoolsTableComponent implements OnChanges {
  @Input() pools: Pool[] = [];
  @Input() compact = false;
  @Input() empty = 'No pool here.';
  @Input() pageSize = 25;
  /** chips of the kinds among the rows */
  @Input() kindFilter = false;
  @Input() searchable = false;
  fx = F;
  cols: CxColumn<Pool>[] = [];
  filters: CxFilter<Pool>[] = [];
  trackPool = (p: Pool) => p.pool;
  matches = (p: Pool, q: string) => `${p.asset_a} ${p.asset_b} ${p.pool}`.toLowerCase().includes(q);

  ngOnChanges(): void {
    this.cols = [
      { key: 'pool', label: 'Pool', sort: p => `${p.asset_a}/${p.asset_b}`, nowrap: true },
      { key: 'kind', label: 'Kind', sort: p => F.kindLabel(p.curve), nowrap: true },
      { key: 'price', label: 'Price', align: 'right', sort: p => p.price, nowrap: true },
      { key: 'liquidity', label: 'Liquidity', align: 'right', sort: p => p.liquidity_ecx || p.depth_ecx * 2, nowrap: true },
      { key: 'volume', label: '24 h volume', align: 'right', sort: p => p.volume_24h, nowrap: true },
      { key: 'change', label: '24 h', align: 'right', sort: p => p.change_24h, nowrap: true },
      ...(this.compact ? [] : [
        { key: 'reserves', label: 'Reserves', align: 'right', hide: 'lg', nowrap: true },
        { key: 'swaps', label: 'Swaps', align: 'right', hide: 'lg', sort: (p: Pool) => p.swaps },
      ] as CxColumn<Pool>[]),
    ];
    const kinds = [...new Set((this.pools ?? []).map(p => p.curve))];
    this.filters = this.kindFilter && kinds.length > 1 ? [{ label: 'Kind', options: kinds.map(k => ({ label: F.kindLabel(k), test: (p: Pool) => p.curve === k })) }] : [];
  }

  kindDetail(p: Pool): string {
    const parts: string[] = [];
    if (p.curve !== 'book' && p.curve !== 'launch') {
      parts.push(F.ppm(p.fee_ppm));
    }
    if (p.curve === 'stable' && p.amp) {
      parts.push('A ' + p.amp);
    }
    if (p.curve === 'weighted' && p.weight_a) {
      parts.push(`${p.weight_a}/${p.weight_b ?? 100 - p.weight_a}`);
    }
    if (p.dynamic_fee) {
      parts.push('dynamic');
    }
    return parts.join(' · ');
  }
}

/** Launches: token, state, progress to graduation, raised, price, market cap, 24 h */
@Component({
  selector: 'app-flush-launches',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, FlushTokenComponent, ChainTableComponent, CxCellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: TABLE_STYLES,
  template: `
    <app-chain-table [rows]="launches" [columns]="cols" [pageSize]="pageSize" [empty]="empty" [trackBy]="trackLaunch">
      <ng-template cxCell="token" let-l><app-flush-token [ticker]="l.ticker" [id]="l.id" [logo]="l.logo" [name]="l.name" [showName]="!compact" [link]="false"></app-flush-token>
        <a [routerLink]="['/launch', l.ticker || l.id]" class="ms-1">launch →</a></ng-template>
      <ng-template cxCell="state" let-l><span class="pill" [class.ok]="l.state === 'graduated'" [class.warn]="l.state === 'graduating'" [class.on]="l.state === 'curve'">{{ stateLabel(l.state) }}</span></ng-template>
      <ng-template cxCell="progress" let-l><div class="progress-cell"><div class="bar"><div class="fill" [style.width.%]="min100(l.progress)"></div></div>
        <div class="t">{{ fx.amount(l.raised_ecx, 2) }} / {{ graduation | number }} ECX · {{ fx.pct(l.progress, 1) }}</div></div></ng-template>
      <ng-template cxCell="price" let-l>{{ fx.price(l.price_ecx) }} <span class="muted">ECX</span></ng-template>
      <ng-template cxCell="mcap" let-l>{{ fx.compact(l.mcap_ecx) }} <span class="muted">ECX</span></ng-template>
      <ng-template cxCell="volume" let-l>{{ fx.compact(l.volume_24h) }}</ng-template>
      <ng-template cxCell="change" let-l><span [class.pos]="(l.change_24h ?? 0) > 0" [class.neg]="(l.change_24h ?? 0) < 0">{{ fx.change(l.change_24h) }}</span></ng-template>
      <ng-template cxCell="holders" let-l>{{ l.holders | number }}</ng-template>
      <ng-template cxCell="created" let-l>@if (l.created_time) {<app-time kind="since" [time]="l.created_time" [fastRender]="true"></app-time>} @else {block {{ l.created_height | number }}}</ng-template>
    </app-chain-table>`,
})
export class FlushLaunchesTableComponent implements OnChanges {
  @Input() launches: LaunchSummary[] = [];
  @Input() compact = false;
  @Input() graduation = 500;
  @Input() empty = 'No launch here.';
  @Input() pageSize = 25;
  fx = F;
  cols: CxColumn<LaunchSummary>[] = [];
  trackLaunch = (l: LaunchSummary) => l.id;

  ngOnChanges(): void {
    this.cols = [
      { key: 'token', label: 'Token', sort: l => l.ticker, nowrap: true },
      { key: 'state', label: 'State', sort: l => l.state },
      { key: 'progress', label: 'Progress', sort: l => l.progress },
      { key: 'price', label: 'Price', align: 'right', sort: l => l.price_ecx, nowrap: true },
      { key: 'mcap', label: 'Market cap', align: 'right', sort: l => l.mcap_ecx, nowrap: true },
      { key: 'volume', label: '24 h volume', align: 'right', sort: l => l.volume_24h, nowrap: true },
      ...(this.compact ? [] : [
        { key: 'change', label: '24 h', align: 'right', sort: (l: LaunchSummary) => l.change_24h, nowrap: true },
        { key: 'holders', label: 'Holders', align: 'right', hide: 'lg', sort: (l: LaunchSummary) => l.holders },
        { key: 'created', label: 'Created', hide: 'lg', sort: (l: LaunchSummary) => l.created_height, nowrap: true },
      ] as CxColumn<LaunchSummary>[]),
    ];
  }

  min100(n: number): number {
    return Math.max(0, Math.min(100, Number(n) || 0));
  }

  stateLabel(s: string): string {
    return s === 'curve' ? 'on the curve' : s;
  }
}

/** Trades, newest first: when, side, venue, amounts, price, who got what came out */
@Component({
  selector: 'app-flush-trades',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, FlushAddrComponent, ChainTableComponent, CxCellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: TABLE_STYLES,
  template: `
    <app-chain-table [rows]="trades" [columns]="cols" [filters]="tools ? sides : null" [search]="tools ? matches : null" searchPlaceholder="Address or transaction"
        [pageSize]="pageSize" [empty]="empty">
      <ng-template cxCell="when" let-t><span [title]="'Flush block ' + t.height">@if (t.time) {<app-time kind="since" [time]="t.time" [fastRender]="true"></app-time>} @else {block {{ t.height | number }}}</span></ng-template>
      <ng-template cxCell="pair" let-t>{{ t.asset_in }} → {{ t.asset_out }}</ng-template>
      <ng-template cxCell="side" let-t><span class="pill" [class.ok]="t.side === 'buy'" [class.bad]="t.side === 'sell'">{{ t.side }}</span></ng-template>
      <ng-template cxCell="venue" let-t>@if (t.pool) {<a [routerLink]="['/pool', t.pool]">{{ t.venue }}</a>} @else {<span>{{ t.venue }}</span>}@if (t.hops > 1) {<span class="muted"> · {{ t.hops }} hops</span>}</ng-template>
      <ng-template cxCell="ecx" let-t>{{ fx.amount(t.ecx) }}</ng-template>
      <ng-template cxCell="tokens" let-t>{{ fx.amount(t.tokens, 6) }}</ng-template>
      <ng-template cxCell="price" let-t>{{ fx.price(t.price_ecx) }}</ng-template>
      <ng-template cxCell="to" let-t><app-flush-addr [address]="t.address"></app-flush-addr></ng-template>
      <ng-template cxCell="tx" let-t><span class="mono" [title]="t.txid">{{ fx.shortId(t.txid, 6) }}</span></ng-template>
    </app-chain-table>`,
})
export class FlushTradesTableComponent implements OnChanges {
  @Input() trades: Trade[] = [];
  @Input() tokenLabel = 'Tokens';
  @Input() showPair = false;
  @Input() empty = 'No trade yet.';
  @Input() pageSize = 25;
  /** the side chips and the search box (none in a widget) */
  @Input() tools = true;
  fx = F;
  cols: CxColumn<Trade>[] = [];
  sides: CxFilter<Trade>[] = [{ label: 'Side', options: [{ label: 'buy', test: t => t.side === 'buy' }, { label: 'sell', test: t => t.side === 'sell' }] }];
  matches = (t: Trade, q: string) => `${t.address ?? ''} ${t.txid ?? ''}`.toLowerCase().includes(q);

  ngOnChanges(): void {
    this.cols = [
      { key: 'when', label: 'When', sort: t => t.height, nowrap: true },
      ...(this.showPair ? [{ key: 'pair', label: 'Pair', nowrap: true }] : []),
      { key: 'side', label: 'Side', sort: t => t.side },
      { key: 'venue', label: 'Venue', sort: t => t.venue, nowrap: true },
      { key: 'ecx', label: 'ECX', align: 'right', sort: t => t.ecx, nowrap: true },
      { key: 'tokens', label: this.tokenLabel, align: 'right', sort: t => t.tokens, nowrap: true },
      { key: 'price', label: 'Price', align: 'right', sort: t => t.price_ecx, nowrap: true },
      { key: 'to', label: 'To', hide: 'md' },
      { key: 'tx', label: 'Transaction', hide: 'lg' },
    ];
  }
}

/** Holders, largest first; the curve's and the pool's holdings tagged */
@Component({
  selector: 'app-flush-holders',
  standalone: true,
  imports: [CommonModule, FlushAddrComponent, ChainTableComponent, CxCellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: TABLE_STYLES,
  template: `
    <app-chain-table [rows]="rows" [columns]="cols" [search]="matches" searchPlaceholder="Address" [pageSize]="pageSize" empty="No holder yet." [trackBy]="trackHolder">
      <ng-template cxCell="rank" let-h><span class="muted">{{ h.rank }}</span></ng-template>
      <ng-template cxCell="holder" let-h><app-flush-addr [address]="h.address" [short]="true"></app-flush-addr>@if (h.tag) {<span class="pill on ms-1">{{ h.tag }}</span>}</ng-template>
      <ng-template cxCell="amount" let-h>{{ fx.amount(h.amount, 6) }}</ng-template>
      <ng-template cxCell="share" let-h><div class="progress-cell"><div class="bar"><div class="fill" [style.width.%]="h.share * 100"></div></div><div class="t">{{ fx.pct(h.share * 100, 2) }}</div></div></ng-template>
    </app-chain-table>`,
})
export class FlushHoldersTableComponent implements OnChanges {
  @Input() holders: Holder[] = [];
  @Input() pageSize = 25;
  fx = F;
  rows: (Holder & { rank: number })[] = [];
  cols: CxColumn<Holder & { rank: number }>[] = [
    { key: 'rank', label: '#', sort: h => -h.rank },
    { key: 'holder', label: 'Holder' },
    { key: 'amount', label: 'Amount', align: 'right', sort: h => h.amount, nowrap: true },
    { key: 'share', label: 'Share', sort: h => h.share },
  ];
  trackHolder = (h: Holder) => h.address;
  matches = (h: Holder, q: string) => `${h.address ?? ''} ${h.tag ?? ''}`.toLowerCase().includes(q);

  ngOnChanges(): void {
    this.rows = (this.holders ?? []).map((h, i) => ({ ...h, rank: i + 1 }));
  }
}

/** The treasury's inflows by block (GET market/treasury): source, asset, ECX, its parts from swaps and launches */
@Component({
  selector: 'app-flush-inflows',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, ChainTableComponent, CxCellDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: TABLE_STYLES,
  template: `
    <app-chain-table [rows]="inflows" [columns]="cols" [filters]="filters" [search]="matches" searchPlaceholder="Block or asset" sort="height"
        [pageSize]="pageSize" empty="No inflow yet.">
      <ng-template cxCell="height" let-i><a [routerLink]="['/block', i.height]">{{ i.height | number }}</a></ng-template>
      <ng-template cxCell="time" let-i><app-time kind="since" [time]="i.time" [fastRender]="true"></app-time></ng-template>
      <ng-template cxCell="source" let-i><span class="pill on">{{ i.source }}</span></ng-template>
      <ng-template cxCell="amount" let-i>{{ fx.amount(i.amount_ecx) }}</ng-template>
      <ng-template cxCell="from_swaps" let-i>{{ fx.amount(i.from_swaps) }}</ng-template>
      <ng-template cxCell="from_launches" let-i>{{ fx.amount(i.from_launches) }}</ng-template>
      <ng-template cxCell="security_held" let-i>{{ fx.amount(i.security_held) }}</ng-template>
    </app-chain-table>`,
})
export class FlushInflowsTableComponent implements OnChanges {
  @Input() inflows: TreasuryInflow[] = [];
  @Input() pageSize = 25;
  fx = F;
  cols: CxColumn<TreasuryInflow>[] = [
    { key: 'height', label: 'Block', sort: i => i.height },
    { key: 'time', label: 'Time', sort: i => i.time, nowrap: true, hide: 'sm' },
    { key: 'source', label: 'Source', sort: i => i.source },
    { key: 'asset', label: 'Asset', sort: i => i.asset },
    { key: 'amount', label: 'ECX', align: 'right', sort: i => i.amount_ecx, nowrap: true },
    { key: 'from_swaps', label: 'From swaps', align: 'right', sort: i => i.from_swaps, nowrap: true, hide: 'md' },
    { key: 'from_launches', label: 'From launches', align: 'right', sort: i => i.from_launches, nowrap: true, hide: 'md' },
    { key: 'security_held', label: 'Security held', align: 'right', sort: i => i.security_held, nowrap: true, hide: 'lg' },
  ];
  filters: CxFilter<TreasuryInflow>[] = [];
  matches = (i: TreasuryInflow, q: string) => `${i.height} ${i.asset ?? ''}`.toLowerCase().includes(q);

  ngOnChanges(): void {
    const sources = [...new Set((this.inflows ?? []).map(i => i.source))];
    this.filters = sources.length ? [{ label: 'Source', options: sources.map(x => ({ label: x, test: (i: TreasuryInflow) => i.source === x })) }] : [];
  }
}

/** "Older →" for a cursor-paged list */
@Component({
  selector: 'app-flush-pager',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: TABLE_STYLES,
  template: `
    <div class="pager">
      @if (total !== null) {<span>{{ total | number }} in all</span>}
      @if (hasPrev) {<button class="btn btn-sm btn-secondary" (click)="first.emit()">First</button>}
      @if (next) {<button class="btn btn-sm btn-secondary" (click)="more.emit(next)">Next →</button>}
    </div>`,
})
export class FlushPagerComponent {
  @Input() next: string | null | undefined = null;
  @Input() total: number | null = null;
  @Input() hasPrev = false;
  @Output() more = new EventEmitter<string>();
  @Output() first = new EventEmitter<void>();
}

export const FLUSH_PAGE_IMPORTS = [
  CommonModule, RouterModule, SharedModule, SidechainLabelComponent, FlushStateComponent, FlushTokenComponent, FlushAddrComponent, FlushAssetComponent, FlushEcashLinkComponent, FlushSupplyComponent,
  FlushHeadComponent, FlushPoolsTableComponent, FlushLaunchesTableComponent, FlushTradesTableComponent, FlushHoldersTableComponent,
  FlushPagerComponent, FlushInflowsTableComponent, ChainTableComponent, CxCellDirective,
];
