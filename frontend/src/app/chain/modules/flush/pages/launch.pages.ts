import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, shareReplay, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { FlushApiService, FlushLoaded, flushLoaded } from '../flush-api.service';
import { ASSET_TABS, FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { FLUSH_CHARTS } from '../flush-charts';
import { Candle, FlushStatus, Holder, LaunchDetail, LaunchParams, LaunchStats, LaunchSummary, Page, Trade } from '../flush.interfaces';
import * as F from '../flush-format';
import { INTERVALS } from './dex.pages';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];
const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'new', label: 'New (a day)' }, { id: 'near', label: 'Near graduation' },
  { id: 'curve', label: 'On the curve' }, { id: 'graduated', label: 'Graduated' },
];

/** /launches: bonding-curve launches (GET market/launches): progress to graduation, raised, price, market cap, 24 h */
@Component({
  selector: 'app-flush-launches-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Launches" sub="Tokens launched on a bonding curve: buyers pay ECX into the curve until it raises the graduation amount, then the token trades in a pool whose liquidity is locked for good" [tabs]="tabs" active="/launches"></app-flush-head>
    @if (stats$ | async; as s) {
      @if (s.data; as st) {
        <div class="kpis">
          <div class="kpi"><div class="l">Launches</div><div class="v">{{ st.launches | number }}</div><div class="s">{{ st.launches_24h | number }} in the last day</div></div>
          <div class="kpi"><div class="l">On the curve</div><div class="v">{{ st.on_curve | number }}</div><div class="s">raising ECX</div></div>
          <div class="kpi"><div class="l">Graduated</div><div class="v">{{ st.graduated | number }}</div><div class="s">{{ st.graduated_24h | number }} in the last day</div></div>
          <div class="kpi"><div class="l">Raised</div><div class="v">{{ fx.compact(st.raised_ecx) }} <span class="muted">ECX</span></div><div class="s">volume {{ fx.compact(st.volume_ecx) }} ECX in all, {{ fx.compact(st.volume_24h) }} in 24 h</div></div>
          <div class="kpi"><div class="l">Graduation</div><div class="v">{{ st.graduation_ecx | number }} <span class="muted">ECX</span></div><div class="s">fee {{ st.fee_percent }}% a trade, {{ st.creator_share_percent }}% of it to the creator</div></div>
        </div>
      }
    }
    @if (rules$ | async; as r) {
      <div class="card-box mb-3">
        <h3>Launch rules <span class="hint">since block {{ r.height | number }}</span></h3>
        <table class="kv"><tbody>
          <tr><th>Trade fee</th><td>{{ fx.bps(r.fee_default_bps) }} by default · {{ fx.bps(r.fee_min_bps) }} to {{ fx.bps(r.fee_max_bps) }}, the creator's choice</td></tr>
          <tr><th>Supply</th><td>{{ fx.compact(+r.supply_min_units) }} to {{ fx.compact(+r.supply_max_units) }} base units (before decimals), a multiple of {{ r.supply_multiple_units | number }}</td></tr>
          <tr><th>Decimals</th><td>{{ r.decimals_default }} by default, at most {{ r.decimals_max }}</td></tr>
        </tbody></table>
      </div>
    }
    <div class="filters">
      <div class="chips">@for (f of filters; track f.id) {<button class="chip" [class.on]="q.filter === f.id" (click)="set({ filter: f.id })">{{ f.label }}</button>}</div>
      <label>Sort <select class="form-select" [value]="q.sort" (change)="set({ sort: $any($event.target).value })">
        <option value="newest">newest</option><option value="oldest">oldest</option><option value="progress">progress</option><option value="mcap">market cap</option>
        <option value="volume">24 h volume</option><option value="trades">24 h trades</option></select></label>
      <input class="form-control" type="search" placeholder="Ticker, name or id" [value]="q.q" (change)="set({ q: $any($event.target).value })" aria-label="Search launches">
    </div>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Launches" [list]="true" [height]="400"></app-flush-state>
      @if (v.data; as d) {
        <div class="box"><app-flush-launches [launches]="d.items" [graduation]="graduation" [pageSize]="50" empty="No launch matches."></app-flush-launches></div>
        <app-flush-pager [next]="d.next_cursor" [total]="d.total" [hasPrev]="!!q.cursor" (more)="set({ cursor: $event }, true)" (first)="set({ cursor: '' }, true)"></app-flush-pager>
      }
    }
  </div>`,
})
export class FlushLaunchesPage implements OnInit {
  tabs = ASSET_TABS;
  filters = FILTERS;
  fx = F;
  graduation = 500;
  q = { filter: 'all', sort: 'newest', q: '', cursor: '' };
  private q$ = new BehaviorSubject(this.q);
  view$: Observable<FlushLoaded<Page<LaunchSummary>>>;
  stats$: Observable<FlushLoaded<LaunchStats>>;
  /** the launch rules in force (the public API's status, Flush v2); none before */
  rules$: Observable<LaunchParams | null>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush launches');
    this.stats$ = flushLoaded(this.api.market$<LaunchStats>('launches/stats').pipe(tap(s => this.graduation = s.graduation_ecx || 500)));
    this.rules$ = this.api.market$<FlushStatus>('status').pipe(map(s => s.launch_params?.active ? s.launch_params : null), catchError(() => of(null)));
    this.view$ = this.q$.pipe(switchMap(q => flushLoaded(this.api.market$<Page<LaunchSummary>>('launches', { ...q, filter: q.filter === 'all' ? '' : q.filter, limit: 50 }))));
  }

  set(p: Partial<typeof this.q>, paging = false): void {
    this.q = { ...this.q, ...p, ...(paging ? {} : { cursor: '' }) };
    this.q$.next(this.q);
  }
}

/** /launch/:id: a launch (GET market/launches/{id}): its curve with where it is, progress, candles, trades, holders, fees */
@Component({
  selector: 'app-flush-launch-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, ...FLUSH_CHARTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    @if (view$ | async; as v) {
      @if (v.data; as l) {
        <app-flush-head [title]="l.ticker + ' launch'" [tabs]="tabs" active="/launches"></app-flush-head>
        <div class="title-row mb-2">
          <app-flush-token [ticker]="l.ticker" [id]="l.id" [logo]="l.logo" [size]="40" [name]="l.name" [showName]="true"></app-flush-token>
          <span class="pill" [class.ok]="l.state === 'graduated'" [class.warn]="l.state === 'graduating'" [class.on]="l.state === 'curve'">{{ l.state === 'curve' ? 'on the curve' : l.state }}</span>
          @if (l.state === 'graduated' && l.pool_id) {<a [routerLink]="['/pool', l.pool_id]">its pool (locked liquidity) →</a>}
          @else if (l.pool_id) {<a [routerLink]="['/pool', l.pool_id]">the curve's pool →</a>}
        </div>
        <div class="sub"><span class="id">{{ l.id }}</span> <app-clipboard [text]="l.id"></app-clipboard></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Price</div><div class="v">{{ fx.price(l.price_ecx) }}</div><div class="s">ECX per {{ l.ticker }}</div></div>
          <div class="kpi"><div class="l">Market cap</div><div class="v">{{ fx.compact(l.mcap_ecx) }} <span class="muted">ECX</span></div><div class="s">the supply at the price</div></div>
          <div class="kpi"><div class="l">Raised</div><div class="v">{{ fx.amount(l.raised_ecx, 2) }}</div><div class="s">of {{ l.curve.graduation_ecx | number }} ECX</div>
            <div class="bar mt-1"><div class="fill" [style.width.%]="min100(l.progress)"></div></div></div>
          <div class="kpi"><div class="l">Holders</div><div class="v">{{ l.holders | number }}</div><div class="s">{{ fx.compact(l.sold) }} tokens sold</div></div>
          <div class="kpi"><div class="l">Volume</div><div class="v">{{ fx.compact(l.volume_24h) }} <span class="muted">ECX</span></div><div class="s">24 h · {{ fx.compact(l.volume_total) }} ECX, {{ l.trades_total | number }} trades in all</div></div>
          <div class="kpi"><div class="l">24 h</div><div class="v" [class.pos]="(l.change_24h ?? 0) > 0" [class.neg]="(l.change_24h ?? 0) < 0">{{ fx.change(l.change_24h) }}</div><div class="s">{{ l.trades_24h | number }} trades</div></div>
        </div>

        <h2>The bonding curve</h2>
        <div class="box">
          <app-flush-curve [curve]="l.curve" [sold]="l.state === 'curve' ? l.sold : l.curve.sale_supply"></app-flush-curve>
          <p class="note mb-0">A constant product of virtual reserves: {{ l.curve.virtual_ecx | number }} ECX against {{ fx.compact(l.curve.virtual_tokens) }} tokens. Selling the curve's
            {{ fx.compact(l.curve.sale_supply) }} tokens raises exactly {{ l.curve.graduation_ecx | number }} ECX; the last {{ fx.compact(l.curve.pool_supply) }} go with the ECX raised
            into a constant-product pool at the curve's last price, its shares nobody's. Every buy and sale of a block clears at one price.
            @if (l.state !== 'curve') { Graduated@if (l.graduated_height) { at block <a [routerLink]="['/block', l.graduated_height]">{{ l.graduated_height | number }}</a>}.}</p>
        </div>

        <h2>Price <span class="chips d-inline-flex ms-2">@for (i of intervals; track i) {<button class="chip" [class.on]="interval === i" (click)="setInterval(i)">{{ i }}</button>}</span></h2>
        <div class="box">
          @if (candles$ | async; as c) {
            <app-flush-state [state]="c" what="Candles" [height]="260" [list]="true"></app-flush-state>
            @if (c.data; as cd) {<app-flush-candles [candles]="cd" [unit]="'ECX per ' + l.ticker + ', across its graduation'"></app-flush-candles>}
          }
        </div>

        <div class="grid2 mt-3">
          <div class="card-box">
            <h3>Details</h3>
            <table class="kv"><tbody>
              <tr><th>Creator</th><td><app-flush-addr [address]="l.creator" [short]="false"></app-flush-addr></td></tr>
              <tr><th>Launched</th><td>block <a [routerLink]="['/block', l.created_height]">{{ l.created_height | number }}</a>@if (l.created_time) {, <app-time kind="since" [time]="l.created_time" [fastRender]="true"></app-time>}
                · <a [routerLink]="['/tx', l.create_txid]" class="mono">{{ fx.shortId(l.create_txid) }}</a></td></tr>
              <tr><th>First buy</th><td>{{ l.first_buy_ecx ? fx.amount(l.first_buy_ecx) + ' ECX, in its own block' : 'none' }}</td></tr>
              <tr><th>Buy limits</th><td>{{ l.min_buy_ecx ? 'at least ' + fx.amount(l.min_buy_ecx) + ' ECX' : 'no minimum' }} · {{ l.max_buy_ecx ? 'at most ' + fx.amount(l.max_buy_ecx) + ' ECX' : 'no maximum' }}</td></tr>
              <tr><th>Creator's allocation</th><td>{{ l.allocation_percent ? fx.pct(l.allocation_percent) + ' of the supply, minted at graduation' + (l.allocation_claimed ? ' (claimed)' : '') : 'none' }}</td></tr>
              <tr><th>Curve tokens left</th><td>{{ fx.amount(l.curve_tokens_left, 6) }}</td></tr>
              <tr><th>Supply</th><td>{{ fx.amount(l.curve.supply, 0) }} tokens of {{ l.curve.decimals ?? 6 }} decimals, fixed</td></tr>
            </tbody></table>
            @if (l.description) {<h3 class="mt-3">About</h3><p class="desc">{{ l.description }}</p>}
            @if (links(l).length) {
              <div class="d-flex flex-wrap gap-3">@for (k of links(l); track k.url) {<a [href]="k.url" target="_blank" rel="noopener noreferrer nofollow">{{ k.label || k.url }} ↗</a>}</div>
            }
          </div>
          <div class="card-box">
            <h3>Fees</h3>
            <table class="kv"><tbody>
              <tr><th>Trade fee</th><td>{{ fx.bps(l.trade_fee_bps) }} of a trade on the curve, in ECX</td></tr>
              <tr><th>Its parts</th><td>{{ l.creator_share_percent }}% creator · {{ l.protocol_share_percent }}% treasury · {{ l.security_share_percent }}% chain security; the rest into the pool at graduation</td></tr>
              <tr><th>Creator's fees</th><td>{{ fx.amount(l.creator_fees_owed_ecx) }} ECX owed · {{ fx.amount(l.creator_fees_paid_ecx) }} ECX paid (claimed by anyone, paid to the creator)</td></tr>
            </tbody></table>
          </div>
        </div>

        <div class="grid2 mt-3">
          <div class="card-box">
            <h3>Trades</h3>
            @if (trades$ | async; as t) {
              <app-flush-state [state]="t" what="Trades" [height]="200" [list]="true"></app-flush-state>
              @if (t.data; as td) {
                <app-flush-trades [trades]="td.items" [tokenLabel]="l.ticker"></app-flush-trades>
                <app-flush-pager [next]="td.next_cursor" [total]="td.total" [hasPrev]="!!cursor" (more)="page($event)" (first)="page('')"></app-flush-pager>
              }
            }
          </div>
          <div class="card-box">
            <h3>Holders</h3>
            @if (holders$ | async; as h) {
              <app-flush-state [state]="h" what="Holders" [height]="200" [list]="true"></app-flush-state>
              @if (h.data; as hd) {
                <app-flush-holders [holders]="hd.items" [pageSize]="10"></app-flush-holders>
                <app-flush-pager [total]="hd.total"></app-flush-pager>
              }
            }
          </div>
        </div>
      } @else {
        <app-flush-head title="Launch" [tabs]="tabs" active="/launches"></app-flush-head>
        <app-flush-state [state]="v" what="Launch" [id]="id" [height]="400"></app-flush-state>
      }
    }
  </div>`,
})
export class FlushLaunchPage implements OnInit {
  tabs = ASSET_TABS;
  intervals = INTERVALS;
  fx = F;
  id = '';
  interval = '1h';
  cursor = '';
  private interval$ = new BehaviorSubject('1h');
  private cursor$ = new BehaviorSubject('');
  view$: Observable<FlushLoaded<LaunchDetail>>;
  candles$: Observable<FlushLoaded<Candle[]>>;
  trades$: Observable<FlushLoaded<Page<Trade>>>;
  holders$: Observable<FlushLoaded<Page<Holder>>>;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    const id$ = this.route.paramMap.pipe(map(p => String(p.get('id') ?? '')), tap(id => {
      this.id = id;
      this.seo.setTitle('Flush launch ' + id);
    }), shareReplay(1));
    this.view$ = id$.pipe(switchMap(id => flushLoaded(this.api.market$<LaunchDetail>('launches/' + this.api.seg(id)))));
    this.candles$ = combineLatest([id$, this.interval$]).pipe(switchMap(([id, i]) =>
      flushLoaded(this.api.market$<{ items: Candle[] }>(`launches/${this.api.seg(id)}/candles`, { interval: i }).pipe(map(r => r.items ?? [])))));
    this.trades$ = combineLatest([id$, this.cursor$]).pipe(switchMap(([id, c]) =>
      flushLoaded(this.api.market$<Page<Trade>>(`launches/${this.api.seg(id)}/trades`, { cursor: c, limit: 25 }))));
    this.holders$ = id$.pipe(switchMap(id => flushLoaded(this.api.market$<Page<Holder>>(`launches/${this.api.seg(id)}/holders`, { limit: 50 }))));
  }

  setInterval(i: string): void {
    this.interval = i;
    this.interval$.next(i);
  }

  page(c: string): void {
    this.cursor = c;
    this.cursor$.next(c);
  }

  min100(n: number): number {
    return Math.max(0, Math.min(100, Number(n) || 0));
  }

  /** the creator's links the API passed as safe, checked again (https only, no credentials) */
  links(l: LaunchDetail): { label: string; url: string }[] {
    return (l.links ?? []).map(k => ({ label: String(k.label ?? ''), url: F.safeLink(k.url) })).filter(k => !!k.url) as { label: string; url: string }[];
  }
}
