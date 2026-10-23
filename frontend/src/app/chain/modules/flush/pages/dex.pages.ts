import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ChartSeries, L2ChartComponent } from '@app/chain/l2/features/feature-kit';
import { FlushApiService, FlushLoaded, flushLoaded } from '../flush-api.service';
import { DEX_TABS, FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { FLUSH_CHARTS } from '../flush-charts';
import { Book, Candle, FlushStats, FlushTreasury, Page, Pool, PoolTicks, Trade } from '../flush.interfaces';
import * as F from '../flush-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];
export const KINDS = ['constant_product', 'stable', 'weighted', 'concentrated', 'launch', 'book'];
export const INTERVALS = ['5m', '1h', '4h', '1d'];

/** /pools: the DEX's pools (the market index, GET market/pools): kind, price, liquidity, 24 h volume and change */
@Component({
  selector: 'app-flush-pools-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="DEX" sub="Flush's pools of every kind and its order books: every order of a block clears together, at one price per pool" [tabs]="tabs" active="/pools"></app-flush-head>
    @if (stats$ | async; as s) {
      @if (s.data; as st) {
        <div class="kpis">
          <div class="kpi"><div class="l">Pools</div><div class="v">{{ (st.pools ?? 0) | number }}</div><div class="s">in the market index</div></div>
          <div class="kpi"><div class="l">Liquidity</div><div class="v">{{ fx.compact(st.liquidity_ecx) }} <span class="muted">ECX</span></div><div class="s">ECX held by the pools</div></div>
          <div class="kpi"><div class="l">24 h volume</div><div class="v">{{ fx.compact(st.volume_24h) }} <span class="muted">ECX</span></div><div class="s">launches and pools</div></div>
          <div class="kpi"><div class="l">Swap fee</div><div class="v">{{ fx.bps(st.fees.pool_fee_bps) }}</div><div class="s">the default tier</div></div>
        </div>
      }
    }
    <div class="filters">
      <div class="chips">
        <button class="chip" [class.on]="!q.kind" (click)="set({ kind: '' })">All kinds</button>
        @for (k of kinds; track k) {<button class="chip" [class.on]="q.kind === k" (click)="set({ kind: k })">{{ fx.kindLabel(k) }}</button>}
      </div>
      <label>Sort <select class="form-select" [value]="q.sort" (change)="set({ sort: $any($event.target).value })">
        <option value="liquidity">liquidity</option><option value="volume">24 h volume</option><option value="change">24 h change</option><option value="newest">newest</option></select></label>
      <input class="form-control" type="search" placeholder="Ticker or name" [value]="q.q" (change)="set({ q: $any($event.target).value })" aria-label="Search pools">
      <label><input type="checkbox" [checked]="q.ecx_only" (change)="set({ ecx_only: $any($event.target).checked })"> with ECX only</label>
      <label><input type="checkbox" [checked]="q.include_abandoned" (change)="set({ include_abandoned: $any($event.target).checked })"> abandoned too</label>
    </div>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Pools" [list]="true" [height]="400"></app-flush-state>
      @if (v.data; as d) {
        <div class="box"><app-flush-pools [pools]="d.items" empty="No pool matches."></app-flush-pools></div>
        @if (d.partial) {<p class="note">The index stopped at its search budget: the next page goes on.</p>}
        <app-flush-pager [next]="d.next_cursor" [total]="d.total" [hasPrev]="!!q.cursor" (more)="set({ cursor: $event }, true)" (first)="set({ cursor: '' }, true)"></app-flush-pager>
      }
    }
    <p class="note">Prices are of each pool's second asset per whole unit of its first (ECX per token for a pool with ECX). Liquidity and volume
      count ECX, so a pair without ECX shows none. Kinds: constant product (x·y = k), stable (Curve's StableSwap with its amplification A),
      weighted (Balancer, x^wa·y^wb = k), concentrated (Uniswap v3 positions between ticks), a launch's bonding curve, and order books.</p>
  </div>`,
})
export class FlushPoolsPage implements OnInit {
  tabs = DEX_TABS;
  kinds = KINDS;
  fx = F;
  q = { kind: '', sort: 'liquidity', q: '', ecx_only: false, include_abandoned: false, cursor: '' };
  private q$ = new BehaviorSubject(this.q);
  view$: Observable<FlushLoaded<Page<Pool>>>;
  stats$: Observable<FlushLoaded<FlushStats>>;

  constructor(private api: FlushApiService, private seo: SeoService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush DEX: pools');
    const kind = this.route.snapshot.queryParamMap.get('kind');
    if (kind && KINDS.includes(kind)) {
      this.set({ kind });
    }
    this.stats$ = flushLoaded(this.api.market$<FlushStats>('stats'));
    this.view$ = this.q$.pipe(switchMap(q => flushLoaded(this.api.market$<Page<Pool>>('pools', { ...q, limit: 50 }))));
  }

  set(p: Partial<typeof this.q>, paging = false): void {
    this.q = { ...this.q, ...p, ...(paging ? {} : { cursor: '' }) };
    this.q$.next(this.q);
  }
}

/** The price impact of a trade by its size (getpoolcurve's depth): a series per direction */
function depthSeries(c: any): ChartSeries[] {
  const side = (s: string, name: string, color: string): ChartSeries => ({
    name, color, points: (c?.depth ?? []).filter((d: any) => d.side === s).map((d: any) => [Number(d.size_percent), Number(d.price_impact)] as [number, number]),
  });
  return [side('sell_a', 'selling ' + (c?.asset_a ?? 'a'), '#ff6b6b'), side('sell_b', 'selling ' + (c?.asset_b ?? 'b'), '#3bd16f')];
}

/** /pool/:id: one pool: its kind's parameters, reserves, price, TWAP, depth, candles, trades (and ticks) */
@Component({
  selector: 'app-flush-pool-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, ...FLUSH_CHARTS, L2ChartComponent],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    @if (view$ | async; as v) {
      @if (v.data; as p) {
        <app-flush-head [title]="p.asset_a + ' / ' + p.asset_b" [tabs]="tabs" active="/pools"><span class="pill on ms-2" style="font-size: 0.8rem">{{ fx.kindLabel(p.curve) }}</span></app-flush-head>
        <div class="sub"><span class="id">{{ p.pool }}</span> <app-clipboard [text]="p.pool"></app-clipboard>
          @if (p.locked) {<span class="pill ms-2">locked liquidity</span>} @if (p.abandoned) {<span class="pill warn ms-2">abandoned</span>}</div>
        <div class="kpis">
          <div class="kpi"><div class="l">Price</div><div class="v">{{ fx.price(p.price) }}</div><div class="s">{{ p.asset_b }} per {{ p.asset_a }}</div></div>
          <div class="kpi"><div class="l">Reserve {{ p.asset_a }}</div><div class="v">{{ fx.compact(p.reserve_a) }}</div><div class="s"><app-flush-token [ticker]="p.asset_a" [id]="p.asset_a_id" [logo]="p.logo"></app-flush-token></div></div>
          <div class="kpi"><div class="l">Reserve {{ p.asset_b }}</div><div class="v">{{ fx.compact(p.reserve_b) }}</div><div class="s"><app-flush-token [ticker]="p.asset_b" [id]="p.asset_b_id"></app-flush-token></div></div>
          <div class="kpi"><div class="l">Liquidity</div><div class="v">{{ fx.compact(p.liquidity_ecx) }} <span class="muted">ECX</span></div><div class="s">{{ fx.compact(p.depth_ecx) }} ECX held</div></div>
          <div class="kpi"><div class="l">24 h</div><div class="v" [class.pos]="(p.change_24h ?? 0) > 0" [class.neg]="(p.change_24h ?? 0) < 0">{{ fx.change(p.change_24h) }}</div><div class="s">volume {{ fx.compact(p.volume_24h) }} ECX · {{ p.swaps | number }} swaps in all</div></div>
          <div class="kpi"><div class="l">Fee</div><div class="v">{{ p.curve === 'book' ? 'none' : fx.ppm(p.fee_ppm) }}</div><div class="s">@if (p.dynamic_fee) {dynamic: {{ fx.bps(p.fee_now_bps) }} now} @else {fixed tier}</div></div>
        </div>
        <div class="grid2">
          <div class="card-box">
            <h3>{{ kindTitle(p) }}</h3>
            <table class="kv"><tbody>
              @switch (p.curve) {
                @case ('constant_product') {<tr><th>Invariant</th><td>x · y = k, k = {{ fx.compact(p.reserve_a * p.reserve_b) }} @if (p.default_kind) {<span class="pill ms-1">the pair's default pool</span>}</td></tr>}
                @case ('stable') {<tr><th>Amplification A</th><td>{{ p.amp | number }} <span class="muted">(1 to 10,000: the higher, the flatter around one for one)</span></td></tr>}
                @case ('weighted') {<tr><th>Weights</th><td>{{ p.weight_a }}% {{ p.asset_a }} / {{ p.weight_b ?? (100 - (p.weight_a ?? 50)) }}% {{ p.asset_b }}</td></tr>}
                @case ('concentrated') {
                  @if (p.concentrated; as c) {
                    <tr><th>Tick now</th><td>{{ c.tick | number }} <span class="muted">(spacing {{ c.tick_spacing }})</span></td></tr>
                    <tr><th>Liquidity in range</th><td class="mono">{{ c.liquidity }}</td></tr>
                    <tr><th>√price (Q64.96)</th><td class="mono">{{ c.sqrt_price_x96 }}</td></tr>
                  }
                }
                @case ('launch') {<tr><th>Launch</th><td>the bonding curve of <a [routerLink]="['/launch', p.launch || p.asset_a]">{{ p.launch || p.asset_a }}</a>: nobody can add liquidity until it graduates</td></tr>}
                @case ('book') {<tr><th>Order book</th><td><a [routerLink]="['/book', p.asset_a, p.asset_b]">its ladder, best bid and ask →</a></td></tr>}
              }
              <tr><th>Shares</th><td>{{ fx.amount(p.shares, 0) }}</td></tr>
              <tr><th>Created</th><td>@if (p.created) {block <a [routerLink]="['/block', p.created]">{{ p.created | number }}</a>} @else {–}</td></tr>
              <tr><th>Last activity</th><td>@if (p.last_activity) {block <a [routerLink]="['/block', p.last_activity]">{{ p.last_activity | number }}</a>} @else {–}</td></tr>
              <tr><th>All-time volume</th><td>{{ fx.amount(p.volume_a) }} {{ p.asset_a }} · {{ fx.amount(p.volume_b) }} {{ p.asset_b }}</td></tr>
              @if (p.launch) {<tr><th>Graduated from</th><td><a [routerLink]="['/launch', p.launch]">the launch of {{ p.launch }}</a></td></tr>}
            </tbody></table>
          </div>
          <div class="card-box">
            <h3>Time-weighted price <span class="hint">getpooltwap</span></h3>
            @if (twap$ | async; as t) {
              @if (t.data; as tw) {
                <table class="kv"><tbody>
                  <tr><th>{{ tw.asset_b }} per {{ tw.asset_a }}</th><td>{{ fx.price(tw.twap_b) }}</td></tr>
                  <tr><th>{{ tw.asset_a }} per {{ tw.asset_b }}</th><td>{{ fx.price(tw.twap_a) }}</td></tr>
                  <tr><th>Over</th><td>{{ tw.seconds | number }} s, {{ tw.observations }} observations</td></tr>
                  <tr><th>Spot</th><td>{{ fx.price(tw.spot_a) }} {{ tw.asset_a }} per {{ tw.asset_b }}</td></tr>
                </tbody></table>
              } @else if (!t.loading) {<p class="muted mb-0">No time-weighted price over the last hour (the pool has not changed in it, or keeps no observation yet).</p>}
            }
            <h3 class="mt-3">Price impact by trade size <span class="hint">getpoolcurve</span></h3>
            @if (curve$ | async; as c) {
              @if (c.data; as cd) {<app-l2-chart [series]="depth(cd)" [height]="140" [percent]="false" unit="%" xPrefix="size % " [legend]="true" emptyText="No depth for this pool."></app-l2-chart>}
              @else if (!c.loading) {<p class="muted mb-0">No depth curve for this pool.</p>}
            }
          </div>
        </div>
        @if (p.curve === 'concentrated') {
          <h2>Liquidity by price</h2>
          <div class="box">
            @if (ticks$ | async; as t) {
              <app-flush-state [state]="t" what="Ticks" [height]="200"></app-flush-state>
              @if (t.data; as td) {<app-flush-ticks [ticks]="td" [unit]="p.asset_b + ' per ' + p.asset_a"></app-flush-ticks>}
            }
          </div>
        }
        <h2>Price <span class="chips d-inline-flex ms-2">@for (i of intervals; track i) {<button class="chip" [class.on]="interval === i" (click)="setInterval(i)">{{ i }}</button>}</span></h2>
        <div class="box">
          @if (candles$ | async; as c) {
            <app-flush-state [state]="c" what="Candles" [height]="260" [list]="true"></app-flush-state>
            @if (c.data; as cd) {<app-flush-candles [candles]="cd" [unit]="p.asset_b + ' per ' + p.asset_a" [volumeUnit]="p.asset_a === 'ECX' || p.asset_b === 'ECX' ? 'ECX' : p.asset_a"></app-flush-candles>}
          }
        </div>
        <h2>Trades</h2>
        <div class="box">
          @if (trades$ | async; as t) {
            <app-flush-state [state]="t" what="Trades" [height]="200" [list]="true"></app-flush-state>
            @if (t.data; as td) {
              <app-flush-trades [trades]="td.items" [tokenLabel]="p.asset_b === 'ECX' ? p.asset_a : p.asset_b"></app-flush-trades>
              <app-flush-pager [next]="td.next_cursor" [total]="td.total" [hasPrev]="!!cursor" (more)="page($event)" (first)="page('')"></app-flush-pager>
            }
          }
        </div>
      } @else {
        <app-flush-head title="Pool" [tabs]="tabs" active="/pools"></app-flush-head>
        <app-flush-state [state]="v" what="Pool" [id]="id" [height]="400"></app-flush-state>
      }
    }
  </div>`,
})
export class FlushPoolPage implements OnInit {
  tabs = DEX_TABS;
  intervals = INTERVALS;
  fx = F;
  id = '';
  interval = '1h';
  cursor = '';
  private interval$ = new BehaviorSubject('1h');
  private cursor$ = new BehaviorSubject('');
  view$: Observable<FlushLoaded<Pool>>;
  candles$: Observable<FlushLoaded<Candle[]>>;
  trades$: Observable<FlushLoaded<Page<Trade>>>;
  ticks$: Observable<FlushLoaded<PoolTicks>>;
  twap$: Observable<FlushLoaded<any>>;
  curve$: Observable<FlushLoaded<any>>;
  depth = depthSeries;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    const id$ = this.route.paramMap.pipe(map(p => String(p.get('id') ?? '')), tap(id => {
      this.id = id;
      this.seo.setTitle('Flush pool ' + F.shortId(id, 6));
    }));
    this.view$ = id$.pipe(switchMap(id => flushLoaded(this.api.market$<Pool>('pools/' + this.api.seg(id)))));
    this.candles$ = combineLatest([id$, this.interval$]).pipe(
      switchMap(([id, i]) => flushLoaded(this.api.market$<{ items: Candle[] }>(`pools/${this.api.seg(id)}/candles`, { interval: i }).pipe(map(r => r.items ?? [])))),
    );
    this.trades$ = combineLatest([id$, this.cursor$]).pipe(
      switchMap(([id, c]) => flushLoaded(this.api.market$<Page<Trade>>(`pools/${this.api.seg(id)}/trades`, { cursor: c, limit: 25 }))),
    );
    this.ticks$ = id$.pipe(switchMap(id => flushLoaded(this.api.market$<PoolTicks>(`pools/${this.api.seg(id)}/ticks`, { limit: 500 }))));
    // the TWAP over the last day, else the last hour (a window must not start before the pool's oldest observation)
    this.twap$ = id$.pipe(switchMap(id => flushLoaded(this.api.rpc$<any>('getpooltwap', id, null, 86400).pipe(
      catchError(() => this.api.rpc$<any>('getpooltwap', id, null, 3600)),
    ))));
    this.curve$ = id$.pipe(switchMap(id => flushLoaded(this.api.rpc$<any>('getpoolcurve', id))));
  }

  setInterval(i: string): void {
    this.interval = i;
    this.interval$.next(i);
  }

  page(c: string): void {
    this.cursor = c;
    this.cursor$.next(c);
  }

  kindTitle(p: Pool): string {
    return ({ constant_product: 'Constant product', stable: 'StableSwap', weighted: 'Weighted', concentrated: 'Concentrated liquidity',
      launch: 'Launch curve', book: 'Order book' } as Record<string, string>)[p.curve] ?? F.kindLabel(p.curve);
  }
}

/** /books: the order books (pools of kind book) */
@Component({
  selector: 'app-flush-books-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Order books" sub="Limit orders beside the pools: each block clears a book as a call auction, at one price" [tabs]="tabs" active="/books"></app-flush-head>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Order books" [list]="true" [height]="300"></app-flush-state>
      @if (v.data; as d) {
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Book</th><th class="r">Last price</th><th class="r">Held</th><th class="r">24 h volume</th><th>Created</th></tr></thead>
            <tbody>
              @for (b of d.items; track b.pool) {
                <tr>
                  <td><a [routerLink]="['/book', b.asset_a, b.asset_b]"><app-flush-token [ticker]="b.asset_a" [id]="b.asset_a_id" [link]="false"></app-flush-token> / <app-flush-token [ticker]="b.asset_b" [id]="b.asset_b_id" [link]="false"></app-flush-token></a></td>
                  <td class="r">{{ fx.price(b.price) }}</td>
                  <td class="r nowrap">{{ fx.compact(b.reserve_a) }} {{ b.asset_a }} · {{ fx.compact(b.reserve_b) }} {{ b.asset_b }}</td>
                  <td class="r">{{ fx.compact(b.volume_24h) }}</td>
                  <td>@if (b.created) {<a [routerLink]="['/block', b.created]">{{ b.created | number }}</a>}</td>
                </tr>
              } @empty {<tr><td colspan="5" class="empty">No order book yet: the first order of a pair makes its book.</td></tr>}
            </tbody>
          </table>
        </div>
        <app-flush-pager [next]="d.next_cursor" [total]="d.total"></app-flush-pager>
      }
    }
  </div>`,
})
export class FlushBooksPage implements OnInit {
  tabs = DEX_TABS;
  fx = F;
  view$: Observable<FlushLoaded<Page<Pool>>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush order books');
    this.view$ = flushLoaded(this.api.market$<Page<Pool>>('pools', { kind: 'book', include_abandoned: true, limit: 200 }));
  }
}

/** /book/:base/:quote: a book's ladder (GET market/books/{base}/{quote}), best bid and ask, its depth */
@Component({
  selector: 'app-flush-book-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, ...FLUSH_CHARTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head [title]="base + ' / ' + quote + ' order book'" [tabs]="tabs" active="/books"></app-flush-head>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Order book" [id]="base + '/' + quote" [height]="400"></app-flush-state>
      @if (v.data; as b) {
        <div class="sub">Asks sell {{ b.base }} for {{ b.quote }}; prices in {{ b.quote }} per {{ b.base }} · book <span class="id">{{ b.book }}</span>
          · <a [routerLink]="['/pool', b.book]">its pool record</a></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Best bid</div><div class="v pos">{{ b.best_bid_exact ?? fx.price(b.best_bid) }}</div><div class="s">{{ b.bid_orders | number }} buy orders</div></div>
          <div class="kpi"><div class="l">Best ask</div><div class="v neg">{{ b.best_ask_exact ?? fx.price(b.best_ask) }}</div><div class="s">{{ b.ask_orders | number }} sell orders</div></div>
          <div class="kpi"><div class="l">Spread</div><div class="v">{{ fx.price(b.spread) }}</div><div class="s">{{ spreadPct(b) }}</div></div>
        </div>
        <h2>Depth</h2>
        <div class="box"><app-flush-depth [book]="b"></app-flush-depth></div>
        <div class="grid2 mt-3">
          <div class="card-box"><h3>Bids <span class="hint">buy {{ b.base }}</span></h3>
            <table class="table table-borderless table-sm"><thead><tr><th class="r">Price</th><th class="r">Amount</th><th class="r">Orders</th><th class="r">Total</th></tr></thead>
              <tbody>@for (l of b.bids; track $index) {<tr><td class="r pos">{{ l.price_exact ?? fx.price(l.price) }}</td><td class="r">{{ fx.amount(l.amount) }}</td><td class="r">{{ l.orders }}</td><td class="r">{{ fx.amount(l.total) }}</td></tr>}
                @empty {<tr><td colspan="4" class="empty">No bid.</td></tr>}</tbody></table></div>
          <div class="card-box"><h3>Asks <span class="hint">sell {{ b.base }}</span></h3>
            <table class="table table-borderless table-sm"><thead><tr><th class="r">Price</th><th class="r">Amount</th><th class="r">Orders</th><th class="r">Total</th></tr></thead>
              <tbody>@for (l of b.asks; track $index) {<tr><td class="r neg">{{ l.price_exact ?? fx.price(l.price) }}</td><td class="r">{{ fx.amount(l.amount) }}</td><td class="r">{{ l.orders }}</td><td class="r">{{ fx.amount(l.total) }}</td></tr>}
                @empty {<tr><td colspan="4" class="empty">No ask.</td></tr>}</tbody></table></div>
        </div>
        <p class="note">Open orders rest until they fill, are settled or expire; makers fill by limit, then by id; an order sells a whole unit
          at least (0.01 ECX of a pair with ECX). A side holds at most 1,000 orders: a better order then takes the worst one's place.</p>
      }
    }
  </div>`,
})
export class FlushBookPage implements OnInit {
  tabs = DEX_TABS;
  fx = F;
  base = '';
  quote = '';
  view$: Observable<FlushLoaded<Book>>;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      tap(p => {
        this.base = String(p.get('base') ?? '');
        this.quote = String(p.get('quote') ?? '');
        this.seo.setTitle(`Flush order book ${this.base}/${this.quote}`);
      }),
      switchMap(() => flushLoaded(this.api.market$<Book>(`books/${this.api.seg(this.base)}/${this.api.seg(this.quote)}`, { depth: 50 }))),
    );
  }

  spreadPct(b: Book): string {
    return b.spread !== null && b.best_bid ? F.pct(100 * b.spread / b.best_bid, 2) + ' of the best bid' : 'one side is empty';
  }
}

/** /treasury: the protocol's treasury (GET market/treasury, gettreasury): balances by asset, inflows, the parts in force */
@Component({
  selector: 'app-flush-treasury-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, L2ChartComponent],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Treasury" sub="The protocol's parts of the DEX's fees, held by the chain itself: no key, no output" [tabs]="tabs" active="/treasury"></app-flush-head>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Treasury" [list]="true" [height]="300"></app-flush-state>
      @if (v.data; as t) {
        <div class="kpis">
          <div class="kpi"><div class="l">Held</div><div class="v">{{ fx.amount(t.balance_ecx, 4) }} <span class="muted">ECX</span></div><div class="s">{{ t.address ? t.address : 'no address: the chain holds it' }}</div></div>
          <div class="kpi"><div class="l">Last 24 h</div><div class="v">+{{ fx.amount(t.inflow_24h_ecx, 4) }}</div><div class="s">ECX in, from the market index</div></div>
          <div class="kpi"><div class="l">Security paid</div><div class="v">{{ fx.amount(t.security_paid_ecx, 4) }}</div><div class="s">ECX to the BMM bidder and validators</div></div>
          <div class="kpi"><div class="l">Spending rule</div><div class="v">{{ t.spending_rule ? 'yes' : 'none yet' }}</div><div class="s">{{ t.reason }}</div></div>
        </div>
        <div class="grid2">
          <div class="card-box"><h3>Balances by asset</h3>
            <table class="table table-borderless table-sm"><thead><tr><th>Asset</th><th class="r">Held</th><th class="r">From swaps</th><th class="r">From launches</th><th class="r">Security held</th></tr></thead>
              <tbody>@for (b of t.balances; track b.asset) {
                <tr><td><app-flush-token [ticker]="b.asset" [id]="b.asset_id"></app-flush-token></td><td class="r">{{ fx.amount(b.balance) }}</td><td class="r">{{ fx.amount(b.from_swaps) }}</td><td class="r">{{ fx.amount(b.from_launches) }}</td><td class="r">{{ fx.amount(b.security_held) }}</td></tr>
              } @empty {<tr><td colspan="5" class="empty">Nothing held yet.</td></tr>}</tbody></table>
            <p class="note mb-0">Security parts of fees paid in an asset cannot be paid by a coinbase: the treasury holds them per asset for a later rule.</p>
          </div>
          <div class="card-box"><h3>The parts in force <span class="hint">gettreasury</span></h3>
            @if (parts$ | async; as pp) {
              @if (pp.data?.fee_parts; as f) {
                <table class="kv"><tbody>
                  <tr><th>Swap fees</th><td>{{ f.swap_liquidity_providers }}% liquidity providers · {{ f.swap_security }}% security · {{ f.swap_protocol }}% treasury</td></tr>
                  <tr><th>Launch fee</th><td>{{ f.launch_fee }}% of a trade on a curve: {{ f.launch_creator }}% creator · {{ f.launch_protocol }}% treasury · {{ f.launch_security }}% security</td></tr>
                </tbody></table>
              } @else if (!pp.loading) {<p class="muted mb-0">Not available.</p>}
            }
          </div>
        </div>
        <h2>Inflows by block</h2>
        <div class="box">
          <app-l2-chart [series]="series(t)" kind="bar" unit="ECX" [legend]="true" emptyText="No inflow yet."></app-l2-chart>
          <table class="table table-borderless table-sm mt-2"><thead><tr><th>Block</th><th>Time</th><th>Source</th><th>Asset</th><th class="r">ECX</th><th class="r">From swaps</th><th class="r">From launches</th></tr></thead>
            <tbody>@for (i of t.inflows; track $index) {
              <tr><td><a [routerLink]="['/block', i.height]">{{ i.height | number }}</a></td><td><app-time kind="since" [time]="i.time" [fastRender]="true"></app-time></td>
                <td><span class="pill on">{{ i.source }}</span></td><td>{{ i.asset }}</td><td class="r">{{ fx.amount(i.amount_ecx) }}</td><td class="r">{{ fx.amount(i.from_swaps) }}</td><td class="r">{{ fx.amount(i.from_launches) }}</td></tr>
            } @empty {<tr><td colspan="7" class="empty">No inflow yet.</td></tr>}</tbody></table>
        </div>
      }
    }
  </div>`,
})
export class FlushTreasuryPage implements OnInit {
  tabs = DEX_TABS;
  fx = F;
  view$: Observable<FlushLoaded<FlushTreasury>>;
  parts$: Observable<FlushLoaded<any>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush treasury');
    this.view$ = flushLoaded(this.api.market$<FlushTreasury>('treasury'));
    this.parts$ = flushLoaded(this.api.rpc$<any>('gettreasury'));
  }

  series(t: FlushTreasury): ChartSeries[] {
    const by = (k: 'from_swaps' | 'from_launches', name: string, color: string): ChartSeries =>
      ({ name, color, points: t.inflows.map(i => [i.height, i[k]] as [number, number]) });
    return [by('from_launches', 'from launches', 'var(--chain-accent, #7d94ab)'), by('from_swaps', 'from swaps', '#f5b83d')];
  }
}
