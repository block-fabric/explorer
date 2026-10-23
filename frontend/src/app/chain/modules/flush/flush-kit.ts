import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { PROFILE } from '@app/chain/profiles';
import { SidechainLabelComponent } from '@app/chain/components/sidechain-label/sidechain-label.component';
import { ECASH_GOLD, ECASH_MARK_PATHS, ECASH_MARK_VIEWBOX } from '@app/chain/marks';
import { Observable } from 'rxjs';
import { FlushApiService, FlushLoaded } from './flush-api.service';
import { AssetInfo, ECX_ID, FlushAssetsService } from './flush-assets.service';
import { Holder, LaunchSummary, Pool, Trade } from './flush.interfaces';
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
export const STAKE_TABS: FlushTab[] = [{ path: '/stake', title: 'Validators and anchors' }];
export const PEG_TABS: FlushTab[] = [{ path: '/peg', title: 'The peg' }, { path: '/bmm', title: 'BMM on eCash' }];

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

/** The pools of the market index: pair, kind, price, liquidity, 24 h volume and change */
@Component({
  selector: 'app-flush-pools',
  standalone: true,
  imports: [CommonModule, RouterModule, FlushTokenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss', './flush-page.scss'],
  template: `
    <table class="table table-borderless table-sm">
      <thead><tr><th>Pool</th><th>Kind</th><th class="r">Price</th><th class="r">Liquidity</th><th class="r">24 h volume</th><th class="r">24 h</th>
        @if (!compact) {<th class="r d-none d-lg-table-cell">Reserves</th><th class="r d-none d-lg-table-cell">Swaps</th>}</tr></thead>
      <tbody>
        @for (p of pools; track p.pool) {
          <tr>
            <td class="nowrap"><a [routerLink]="['/pool', p.pool]" class="me-1" title="The pool's page">⇄</a>
              <app-flush-token [ticker]="p.asset_a" [id]="p.asset_a_id" [logo]="p.logo"></app-flush-token> / <app-flush-token [ticker]="p.asset_b" [id]="p.asset_b_id"></app-flush-token>
              @if (p.locked) {<span class="pill ms-1" title="A graduated launch's pool: its first shares are nobody's, its liquidity stays for good">locked</span>}
              @if (p.abandoned) {<span class="pill warn ms-1">abandoned</span>}</td>
            <td class="nowrap"><a [routerLink]="['/pool', p.pool]"><span class="pill on">{{ fx.kindLabel(p.curve) }}</span></a> <span class="muted">{{ kindDetail(p) }}</span></td>
            <td class="r nowrap">{{ fx.price(p.price) }} <span class="muted">{{ p.asset_b }}</span></td>
            <td class="r nowrap">@if (p.depth_ecx || p.liquidity_ecx) {<span>{{ fx.compact(p.liquidity_ecx || p.depth_ecx * 2) }} </span><span class="muted">ECX</span>} @else {<span class="muted">–</span>}</td>
            <td class="r nowrap">{{ fx.compact(p.volume_24h) }}</td>
            <td class="r nowrap" [class.pos]="(p.change_24h ?? 0) > 0" [class.neg]="(p.change_24h ?? 0) < 0">{{ fx.change(p.change_24h) }}</td>
            @if (!compact) {
              <td class="r nowrap d-none d-lg-table-cell">{{ fx.compact(p.reserve_a) }} / {{ fx.compact(p.reserve_b) }}</td>
              <td class="r d-none d-lg-table-cell">{{ p.swaps | number }}</td>
            }
          </tr>
        } @empty {<tr><td colspan="8" class="empty">{{ empty }}</td></tr>}
      </tbody>
    </table>`,
})
export class FlushPoolsTableComponent {
  @Input() pools: Pool[] = [];
  @Input() compact = false;
  @Input() empty = 'No pool here.';
  fx = F;

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
  imports: [CommonModule, RouterModule, SharedModule, FlushTokenComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss', './flush-page.scss'],
  template: `
    <table class="table table-borderless table-sm">
      <thead><tr><th>Token</th><th>State</th><th>Progress</th><th class="r">Price</th><th class="r">Market cap</th><th class="r">24 h volume</th>
        @if (!compact) {<th class="r">24 h</th><th class="r d-none d-lg-table-cell">Holders</th><th class="d-none d-lg-table-cell">Created</th>}</tr></thead>
      <tbody>
        @for (l of launches; track l.id) {
          <tr>
            <td class="nowrap"><app-flush-token [ticker]="l.ticker" [id]="l.id" [logo]="l.logo" [name]="l.name" [showName]="!compact" [link]="false"></app-flush-token>
              <a [routerLink]="['/launch', l.ticker || l.id]" class="ms-1">launch →</a></td>
            <td><span class="pill" [class.ok]="l.state === 'graduated'" [class.warn]="l.state === 'graduating'" [class.on]="l.state === 'curve'">{{ stateLabel(l.state) }}</span></td>
            <td class="progress-cell"><div class="bar"><div class="fill" [style.width.%]="min100(l.progress)"></div></div>
              <div class="t">{{ fx.amount(l.raised_ecx, 2) }} / {{ graduation | number }} ECX · {{ fx.pct(l.progress, 1) }}</div></td>
            <td class="r nowrap">{{ fx.price(l.price_ecx) }} <span class="muted">ECX</span></td>
            <td class="r nowrap">{{ fx.compact(l.mcap_ecx) }} <span class="muted">ECX</span></td>
            <td class="r nowrap">{{ fx.compact(l.volume_24h) }}</td>
            @if (!compact) {
              <td class="r nowrap" [class.pos]="(l.change_24h ?? 0) > 0" [class.neg]="(l.change_24h ?? 0) < 0">{{ fx.change(l.change_24h) }}</td>
              <td class="r d-none d-lg-table-cell">{{ l.holders | number }}</td>
              <td class="d-none d-lg-table-cell nowrap">@if (l.created_time) {<app-time kind="since" [time]="l.created_time" [fastRender]="true"></app-time>} @else {block {{ l.created_height | number }}}</td>
            }
          </tr>
        } @empty {<tr><td colspan="9" class="empty">{{ empty }}</td></tr>}
      </tbody>
    </table>`,
})
export class FlushLaunchesTableComponent {
  @Input() launches: LaunchSummary[] = [];
  @Input() compact = false;
  @Input() graduation = 500;
  @Input() empty = 'No launch here.';
  fx = F;

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
  imports: [CommonModule, RouterModule, SharedModule, FlushAddrComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss', './flush-page.scss'],
  template: `
    <table class="table table-borderless table-sm">
      <thead><tr><th>When</th>@if (showPair) {<th>Pair</th>}<th>Side</th><th>Venue</th><th class="r">ECX</th><th class="r">{{ tokenLabel }}</th><th class="r">Price</th><th class="d-none d-md-table-cell">To</th><th class="d-none d-lg-table-cell">Transaction</th></tr></thead>
      <tbody>
        @for (t of trades; track $index) {
          <tr>
            <td class="nowrap" [title]="'Flush block ' + t.height">@if (t.time) {<app-time kind="since" [time]="t.time" [fastRender]="true"></app-time>} @else {block {{ t.height | number }}}</td>
            @if (showPair) {<td class="nowrap">{{ t.asset_in }} → {{ t.asset_out }}</td>}
            <td><span class="pill" [class.ok]="t.side === 'buy'" [class.bad]="t.side === 'sell'">{{ t.side }}</span></td>
            <td class="nowrap">@if (t.pool) {<a [routerLink]="['/pool', t.pool]">{{ t.venue }}</a>} @else {<span>{{ t.venue }}</span>}@if (t.hops > 1) {<span class="muted"> · {{ t.hops }} hops</span>}</td>
            <td class="r nowrap">{{ fx.amount(t.ecx) }}</td>
            <td class="r nowrap">{{ fx.amount(t.tokens, 6) }}</td>
            <td class="r nowrap">{{ fx.price(t.price_ecx) }}</td>
            <td class="d-none d-md-table-cell"><app-flush-addr [address]="t.address"></app-flush-addr></td>
            <td class="d-none d-lg-table-cell mono" [title]="t.txid">{{ fx.shortId(t.txid, 6) }}</td>
          </tr>
        } @empty {<tr><td colspan="9" class="empty">{{ empty }}</td></tr>}
      </tbody>
    </table>`,
})
export class FlushTradesTableComponent {
  @Input() trades: Trade[] = [];
  @Input() tokenLabel = 'Tokens';
  @Input() showPair = false;
  @Input() empty = 'No trade yet.';
  fx = F;
}

/** Holders, largest first; the curve's and the pool's holdings tagged */
@Component({
  selector: 'app-flush-holders',
  standalone: true,
  imports: [CommonModule, FlushAddrComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss', './flush-page.scss'],
  template: `
    <table class="table table-borderless table-sm">
      <thead><tr><th>#</th><th>Holder</th><th class="r">Amount</th><th>Share</th></tr></thead>
      <tbody>
        @for (h of holders; track h.address; let i = $index) {
          <tr>
            <td class="muted">{{ i + 1 }}</td>
            <td><app-flush-addr [address]="h.address" [short]="true"></app-flush-addr> @if (h.tag) {<span class="pill on ms-1">{{ h.tag }}</span>}</td>
            <td class="r nowrap">{{ fx.amount(h.amount, 6) }}</td>
            <td class="progress-cell"><div class="bar"><div class="fill" [style.width.%]="h.share * 100"></div></div><div class="t">{{ fx.pct(h.share * 100, 2) }}</div></td>
          </tr>
        } @empty {<tr><td colspan="4" class="empty">No holder yet.</td></tr>}
      </tbody>
    </table>`,
})
export class FlushHoldersTableComponent {
  @Input() holders: Holder[] = [];
  fx = F;
}

/** "Older →" for a cursor-paged list */
@Component({
  selector: 'app-flush-pager',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.pager { display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 8px; font-size: 0.8rem; color: var(--transparent-fg); }`],
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
  CommonModule, RouterModule, SharedModule, SidechainLabelComponent, FlushStateComponent, FlushTokenComponent, FlushAddrComponent, FlushAssetComponent, FlushEcashLinkComponent,
  FlushHeadComponent, FlushPoolsTableComponent, FlushLaunchesTableComponent, FlushTradesTableComponent, FlushHoldersTableComponent,
  FlushPagerComponent,
];
