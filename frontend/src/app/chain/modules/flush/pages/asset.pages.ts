import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { FlushApiService, FlushLoaded, flushLoaded } from '../flush-api.service';
import { ASSET_TABS, DEX_TABS, FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { FLUSH_CHARTS } from '../flush-charts';
import { AssetDetail, AssetSummary, Candle, Holder, LaunchDetail, Page, Pool } from '../flush.interfaces';
import * as F from '../flush-format';
import { INTERVALS } from './dex.pages';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];
/** the viewer's curators (oracle ids) for verified issuers, kept in this browser only */
const CURATORS_KEY = 'flush-curators';

export function savedCurators(): string[] {
  try {
    return String(localStorage.getItem(CURATORS_KEY) ?? '').split(/[\s,]+/).filter(F.isId).slice(0, 20);
  } catch {
    return [];
  }
}

function saveCurators(c: string[]): void {
  try {
    localStorage.setItem(CURATORS_KEY, c.join(','));
  } catch {
    // private window: kept for this page only
  }
}

/** searchassets' row (the node's asset search index) */
export interface AssetRow {
  asset: string;
  name: string;
  display_name?: string;
  label?: string;
  decimals: number;
  supply: number;
  minted: number;
  burned: number;
  fixed: boolean;
  retired?: boolean;
  has_logo?: boolean;
  logo?: boolean;
  has_pool?: boolean;
  pools?: number;
  pool_depth?: number;
  volume?: number;
  created?: number;
  registered: number;
  last_activity?: number;
  registration: string;
  data: Record<string, string>;
  releasable: boolean;
  control?: { txid: string; vout: number; address?: string };
}

/** an asset of the registry's list, with its market (the public API's asset list), when it has one */
export type AssetListRow = AssetRow & { m: AssetSummary | null };

/** an auction's status as chips: those among the rows */
function statusFilter(rows: any[] | null | undefined): CxFilter<any>[] {
  const statuses = [...new Set((rows ?? []).map(x => String(x.status)))];
  return statuses.length > 1 ? [{ label: 'Status', options: statuses.map(st => ({ label: st, test: (x: any) => String(x.status) === st })) }] : [];
}

/** /assets: the asset registry (searchassets): ticker, display name, supply, pools, depth, activity */
@Component({
  selector: 'app-flush-assets-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Assets" sub="The assets registered on Flush: tickers (reserved, then revealed), display names, logos, supply, control coins" [tabs]="tabs" active="/assets"></app-flush-head>
    @if (info$ | async; as i) {
      @if (i.data; as b) {
        <div class="kpis">
          <div class="kpi"><div class="l">Assets</div><div class="v">{{ (b.assets ?? 0) | number }}</div><div class="s">registered</div></div>
          <div class="kpi"><div class="l">Auctions</div><div class="v">{{ (b.auctions ?? 0) | number }}</div><div class="s">open · <a routerLink="/auctions">all</a></div></div>
          <div class="kpi"><div class="l">Oracles</div><div class="v">{{ (b.oracles ?? '–') }}</div><div class="s"><a routerLink="/oracles">oracles and curators</a></div></div>
        </div>
      }
    }
    <div class="filters">
      <input class="form-control" type="search" placeholder="Ticker, name or id" [value]="q.q" (change)="set({ q: $any($event.target).value })" aria-label="Search assets">
      <label>Sort <select class="form-select" [value]="q.sort" (change)="set({ sort: $any($event.target).value })">
        <option value="relevance">relevance</option><option value="activity">activity</option><option value="volume">volume</option><option value="pool_depth">pool depth</option>
        <option value="newest">newest</option><option value="oldest">oldest</option><option value="supply">supply</option><option value="name">name</option></select></label>
      <label><input type="checkbox" [checked]="q.has_pool" (change)="set({ has_pool: $any($event.target).checked })"> with a pool</label>
      <label><input type="checkbox" [checked]="q.has_logo" (change)="set({ has_logo: $any($event.target).checked })"> with a logo</label>
    </div>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Assets" [list]="true" [height]="400"></app-flush-state>
      @if (v.data; as d) {
        <div class="box">
          <app-chain-table [rows]="d.rows" [columns]="cols" [filters]="filters" [pageSize]="50" empty="No asset matches." [trackBy]="trackAsset">
            <ng-template cxCell="asset" let-a><app-flush-token [ticker]="a.name" [id]="a.asset" [logo]="a.has_logo || a.logo ? 'logo' : null" [name]="a.display_name" [showName]="true"></app-flush-token>
              @if (a.fixed) {<span class="pill ms-1" title="No more can be minted">fixed</span>}@if (a.retired) {<span class="pill warn ms-1">retired</span>}</ng-template>
            <ng-template cxCell="supply" let-a>{{ fx.compact(a.supply) }}</ng-template>
            <ng-template cxCell="holders" let-a>{{ a.m ? (a.m.holders | number) : '–' }}</ng-template>
            <ng-template cxCell="price" let-a>{{ a.m?.market?.price_ecx ? fx.price(a.m.market.price_ecx) + ' ECX' : '–' }}@if (a.m && a.m.market.status !== 'none') {<div class="muted small">{{ a.m.market.kinds.join(' · ') || a.m.market.status }}</div>}</ng-template>
            <ng-template cxCell="pools" let-a>{{ a.pools ?? 0 }}</ng-template>
            <ng-template cxCell="depth" let-a>{{ a.pool_depth ? fx.compact(a.pool_depth) + ' ECX' : '–' }}</ng-template>
            <ng-template cxCell="volume" let-a>{{ a.volume ? fx.compact(a.volume) + ' ECX' : '–' }}</ng-template>
            <ng-template cxCell="registered" let-a><a [routerLink]="['/block', a.registered]">{{ a.registered | number }}</a></ng-template>
            <ng-template cxCell="last" let-a>@if (a.last_activity) {<a [routerLink]="['/block', a.last_activity]">{{ a.last_activity | number }}</a>}</ng-template>
          </app-chain-table>
        </div>
        @if (d.partial) {<p class="note">The search stopped at its budget ({{ d.scanned | number }} scanned): the next page goes on.</p>}
        <app-flush-pager [next]="d.next_cursor" [total]="null" [hasPrev]="!!q.cursor" (more)="set({ cursor: $event }, true)" (first)="set({ cursor: '' }, true)"></app-flush-pager>
      }
    }
  </div>`,
})
export class FlushAssetsPage implements OnInit {
  tabs = ASSET_TABS;
  fx = F;
  q = { q: '', sort: 'activity', has_pool: false, has_logo: false, cursor: '' };
  private q$ = new BehaviorSubject(this.q);
  view$: Observable<FlushLoaded<{ assets: AssetRow[]; rows: AssetListRow[]; next_cursor: string | null; partial: boolean; scanned: number; market: Record<string, AssetSummary> }>>;
  cols: CxColumn<AssetListRow>[] = [
    { key: 'asset', label: 'Asset', sort: a => a.name, nowrap: true },
    { key: 'supply', label: 'Supply', align: 'right', sort: a => a.supply, nowrap: true },
    { key: 'holders', label: 'Holders', align: 'right', sort: a => a.m?.holders },
    { key: 'price', label: 'Price', align: 'right', sort: a => a.m?.market?.price_ecx || null, nowrap: true },
    { key: 'pools', label: 'Pools', align: 'right', sort: a => a.pools ?? 0, hide: 'sm' },
    { key: 'depth', label: 'Pool depth', align: 'right', sort: a => a.pool_depth ?? 0, nowrap: true, hide: 'md' },
    { key: 'volume', label: 'Volume', align: 'right', sort: a => a.volume ?? 0, nowrap: true, hide: 'md' },
    { key: 'registered', label: 'Registered', sort: a => a.registered, hide: 'md' },
    { key: 'last', label: 'Last active', sort: a => a.last_activity, hide: 'lg' },
  ];
  filters: CxFilter<AssetListRow>[] = [{ label: 'Supply', options: [
    { label: 'fixed', test: a => !!a.fixed }, { label: 'mintable', test: a => !a.fixed && !a.retired }, { label: 'retired', test: a => !!a.retired },
  ] }];
  trackAsset = (a: AssetListRow) => a.asset;
  info$: Observable<FlushLoaded<any>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush assets');
    this.info$ = flushLoaded(this.api.rpc$<any>('getbitassetsinfo'));
    this.view$ = this.q$.pipe(switchMap(q => {
      const filters: Record<string, boolean> = {};
      if (q.has_pool) {
        filters['has_pool'] = true;
      }
      if (q.has_logo) {
        filters['has_logo'] = true;
      }
      const sort = q.sort === 'relevance' && !q.q ? 'activity' : q.sort;
      // searchassets query filters sort cursor limit; a backend that allows the query alone (400) gets the query alone
      const search$ = this.api.rpc$<any>('searchassets', q.q, filters, sort, q.cursor, 50).pipe(
        catchError(e => e?.status === 400 ? this.api.rpc$<any>('searchassets', q.q) : throwError(() => e)),
      );
      // holders, price and market of the page's assets: the public API's asset list (Flush v2), by id; none before v2
      const market$ = this.api.market$<Page<AssetSummary>>('assets', { q: q.q, limit: 100 }).pipe(
        map(p => Object.fromEntries((p.items ?? []).map(a => [a.id, a]))),
        catchError(() => of({} as Record<string, AssetSummary>)),
      );
      return flushLoaded(combineLatest([search$, market$]).pipe(map(([r, market]) => ({
        ...r, market, rows: (r?.assets ?? []).map((a: AssetRow) => ({ ...a, m: market[a.asset] ?? null })),
      }))));
    }));
  }

  set(p: Partial<typeof this.q>, paging = false): void {
    this.q = { ...this.q, ...p, ...(paging ? {} : { cursor: '' }) };
    this.q$.next(this.q);
  }
}

/** a change of an asset's field (getassethistory) */
interface HistoryRow { field: string; value: string | null; txid: string; height: number }

/** /asset/:id: an asset (getasset, getassethistory): details, logo, control, verifications, pools, books, auctions, launch */
@Component({
  selector: 'app-flush-asset-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, ...FLUSH_CHARTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    @if (view$ | async; as v) {
      @if (v.data; as a) {
        <app-flush-head [title]="a.name" [tabs]="tabs" active="/assets"></app-flush-head>
        <div class="title-row mb-2">
          <app-flush-token [ticker]="a.name" [id]="a.asset" [logo]="a.logo || a.has_logo ? 'logo' : null" [size]="48" [name]="a.display_name" [showName]="true" [link]="false"></app-flush-token>
          @if (verified$ | async; as vf) {
            @if (vf.data; as vd) {<span class="pill" [class.ok]="vd.verified" [title]="'Per your curators: ' + curatorNames(vd)">{{ vd.verified ? 'verified issuer' : 'not verified by your curators' }}</span>}
          }
          @if (a.fixed) {<span class="pill">fixed supply</span>}
        </div>
        <div class="sub"><span class="id">{{ a.asset }}</span> <app-clipboard [text]="a.asset"></app-clipboard></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Supply</div><div class="v">{{ fx.compact(a.supply) }}</div><div class="s">{{ fx.amount(a.minted, a.decimals) }} minted · {{ fx.amount(a.burned, a.decimals) }} burned</div></div>
          <div class="kpi"><div class="l">Decimals</div><div class="v">{{ a.decimals }}</div><div class="s">places of a unit</div></div>
          <div class="kpi"><div class="l">Registered</div><div class="v"><a [routerLink]="['/block', a.registered]">{{ a.registered | number }}</a></div><div class="s"><a [routerLink]="['/tx', a.registration]" class="mono">{{ fx.shortId(a.registration, 6) }}</a></div></div>
          <div class="kpi"><div class="l">Sequence</div><div class="v">{{ a.seq || '–' }}</div><div class="s">its place in the registry</div></div>
        </div>
        @if (market$ | async; as mk) {
          @if (mk.data; as m) {
            <div class="kpis">
              <div class="kpi"><div class="l">Holders</div><div class="v">{{ m.holders | number }}</div><div class="s">addresses holding it</div></div>
              <div class="kpi"><div class="l">Price</div><div class="v">{{ m.market.price_ecx ? fx.price(m.market.price_ecx) : '–' }} <span class="muted">ECX</span></div><div class="s">24 h volume {{ fx.compact(m.market.volume_24h_ecx) }} ECX</div></div>
              <div class="kpi"><div class="l">Market</div><div class="v">{{ m.market.status }}</div><div class="s">{{ m.market.pools }} pool{{ m.market.pools === 1 ? '' : 's' }} · {{ m.market.books }} book{{ m.market.books === 1 ? '' : 's' }} · {{ m.market.auctions }} auction{{ m.market.auctions === 1 ? '' : 's' }}@if (m.market.progress !== null) { · curve {{ m.market.progress | number: '1.0-1' }}%}</div></div>
              <div class="kpi"><div class="l">Bonding curve</div><div class="v">{{ m.launched ? 'launched' : m.can_curve?.allowed ? 'can launch' : 'no' }}</div><div class="s">{{ m.can_curve?.reason || (m.launched ? 'launched on a curve' : 'not launched') }}</div></div>
            </div>
            @if (m.description || m.info || linkList(m).length) {
              <div class="card-box mb-3">
                @if (m.description || m.info) {<p class="desc mb-1">{{ m.description || m.info }}</p>}
                @for (l of linkList(m); track l.url) {<a [href]="l.url" target="_blank" rel="noopener noreferrer nofollow" class="me-3">{{ l.label }}</a>}
              </div>
            }
          }
        }
        <div class="grid2">
          <div class="card-box">
            <h3>Details</h3>
            <table class="kv"><tbody>
              <tr><th>Ticker</th><td>{{ a.name }}@if (a.label && a.label !== a.name) { <span class="muted">({{ a.label }})</span>}</td></tr>
              <tr><th>Display name</th><td>{{ a.display_name || '–' }}</td></tr>
              <tr><th>Control coin</th><td>@if (a.control; as c) {<a [routerLink]="['/tx', c.txid]" class="mono">{{ fx.shortId(c.txid) }}:{{ c.vout }}</a>@if (c.address) { held by <app-flush-addr [address]="c.address"></app-flush-addr>}} @else {<span class="muted">none: nobody can mint more or change it</span>}</td></tr>
              <tr><th>Releasable</th><td>{{ a.releasable ? 'yes' : 'no' }}</td></tr>
              @for (kv of dataRows(a); track kv[0]) {<tr><th>{{ kv[0] }}</th><td class="desc">{{ kv[1] }}</td></tr>}
            </tbody></table>
          </div>
          <div class="card-box">
            <h3>History <span class="hint">getassethistory</span></h3>
            @if (history$ | async; as h) {
              @if (h.data; as hd) {
                <app-chain-table [rows]="hd" [columns]="historyCols" [search]="historyMatches" searchPlaceholder="Field or value" sort="height" [pageSize]="10"
                    empty="No change since its registration.">
                  <ng-template cxCell="field" let-r><span class="muted">{{ r.field }}</span></ng-template>
                  <ng-template cxCell="value" let-r><span class="desc">{{ r.value === null ? '(none)' : r.value }}</span></ng-template>
                  <ng-template cxCell="height" let-r><a [routerLink]="['/tx', r.txid]">{{ r.height | number }}</a></ng-template>
                </app-chain-table>
              } @else if (!h.loading) {<p class="muted mb-0">No history.</p>}
            }
          </div>
        </div>

        @if (launch$ | async; as l) {
          @if (l.data; as ld) {
            <h2>Its launch</h2>
            <div class="box"><app-flush-launches [launches]="[ld]" [graduation]="ld.curve?.graduation_ecx ?? 500"></app-flush-launches></div>
          }
        }

        <h2>Pools and books</h2>
        @if (pools$ | async; as p) {
          <app-flush-state [state]="p" what="Pools" [list]="true" [height]="120"></app-flush-state>
          @if (p.data; as pd) {<div class="box"><app-flush-pools [pools]="pd" [compact]="true" [kindFilter]="true" empty="No pool or book of this asset."></app-flush-pools></div>
            @if (mainPool(pd); as mp) {
              <h2>Price in its {{ mp.asset_a }}/{{ mp.asset_b }} pool <span class="chips d-inline-flex ms-2">@for (i of intervals; track i) {<button class="chip" [class.on]="interval === i" (click)="setInterval(i)">{{ i }}</button>}</span></h2>
              <div class="box">
                @if (candles$ | async; as c) {
                  <app-flush-state [state]="c" what="Candles" [height]="240" [list]="true"></app-flush-state>
                  @if (c.data; as cd) {<app-flush-candles [candles]="cd" [unit]="mp.asset_b + ' per ' + mp.asset_a"></app-flush-candles>}
                }
              </div>
            }
          }
        }

        @if (holders$ | async; as h) {
          @if (h.data; as hd) {<h2>Holders</h2><div class="box"><app-flush-holders [holders]="hd.items"></app-flush-holders><app-flush-pager [total]="hd.total"></app-flush-pager></div>}
        }

        <h2>Auctions</h2>
        @if (auctions$ | async; as au) {
          <app-flush-state [state]="au" what="Auctions" [list]="true" [height]="100"></app-flush-state>
          @if (au.data; as ad) {
            <div class="box">
              <app-chain-table [rows]="ad" [columns]="auctionCols" [filters]="auctionFilters" [pageSize]="25" empty="No auction of this asset." [trackBy]="trackAuction">
                <ng-template cxCell="auction" let-x><a [routerLink]="['/auction', x.auction]" class="mono">{{ fx.shortId(x.auction, 6) }}</a></ng-template>
                <ng-template cxCell="sells" let-x>{{ fx.amount(x.amount) }} {{ x.base }} for {{ x.quote }}</ng-template>
                <ng-template cxCell="left" let-x>{{ fx.amount(x.remaining) }}</ng-template>
                <ng-template cxCell="unit" let-x>{{ fx.price(x.unit_price) }} {{ x.quote }}</ng-template>
                <ng-template cxCell="blocks" let-x>{{ x.start_height | number }} to {{ x.end_height | number }}</ng-template>
                <ng-template cxCell="status" let-x><span class="pill" [class.on]="x.status === 'open'">{{ x.status }}</span></ng-template>
              </app-chain-table>
            </div>
          }
        }
      } @else {
        <app-flush-head title="Asset" [tabs]="tabs" active="/assets"></app-flush-head>
        <app-flush-state [state]="v" what="Asset" [id]="id" [height]="400"></app-flush-state>
      }
    }
  </div>`,
})
export class FlushAssetPage implements OnInit {
  tabs = ASSET_TABS;
  intervals = INTERVALS;
  fx = F;
  historyCols: CxColumn<HistoryRow>[] = [
    { key: 'field', label: 'Field', sort: r => r.field },
    { key: 'value', label: 'Value' },
    { key: 'height', label: 'Block', sort: r => r.height },
  ];
  historyMatches = (r: HistoryRow, q: string) => `${r.field} ${r.value ?? ''}`.toLowerCase().includes(q);
  auctionCols: CxColumn<any>[] = [
    { key: 'auction', label: 'Auction' },
    { key: 'sells', label: 'Sells', sort: x => Number(x.amount) },
    { key: 'left', label: 'Left', align: 'right', sort: x => Number(x.remaining) },
    { key: 'unit', label: 'Unit price now', align: 'right', sort: x => Number(x.unit_price), nowrap: true },
    { key: 'blocks', label: 'Blocks', sort: x => Number(x.start_height), nowrap: true, hide: 'md' },
    { key: 'status', label: 'Status', sort: x => x.status },
  ];
  auctionFilters: CxFilter<any>[] = [];
  trackAuction = (x: any) => x.auction;
  id = '';
  interval = '1h';
  private interval$ = new BehaviorSubject('1h');
  view$: Observable<FlushLoaded<any>>;
  history$: Observable<FlushLoaded<HistoryRow[]>>;
  launch$: Observable<FlushLoaded<LaunchDetail>>;
  pools$: Observable<FlushLoaded<Pool[]>>;
  candles$: Observable<FlushLoaded<Candle[]>>;
  holders$: Observable<FlushLoaded<Page<Holder>>>;
  auctions$: Observable<FlushLoaded<any[]>>;
  verified$: Observable<FlushLoaded<any>>;
  market$: Observable<FlushLoaded<AssetDetail>>;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    const asset$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('Flush asset ' + id);
      }),
      switchMap(id => flushLoaded(this.api.rpc$<AssetRow>('getasset', F.assetArg(id)))),
      shareReplay(1),
    );
    this.view$ = asset$;
    const ok = <T>(f: (id: string, a: AssetRow) => Observable<T>) => asset$.pipe(switchMap(v => v.data ? flushLoaded(f(v.data.asset, v.data)) : of({ loading: false } as FlushLoaded<T>)));
    this.history$ = ok(id => this.api.rpc$<any>('getassethistory', F.assetArg(id)).pipe(map(h => this.historyRows(h))));
    // its market from the public API (Flush v2: GET assets/{id}); none before v2
    this.market$ = ok(id => this.api.market$<AssetDetail>('assets/' + id)).pipe(map(m => m.error ? { loading: false } : m));
    this.launch$ = ok(id => this.api.market$<LaunchDetail>('launches/' + id));
    this.holders$ = ok(id => this.api.market$<Page<Holder>>(`launches/${id}/holders`, { limit: 25 }));
    this.pools$ = ok((id, a) => this.api.market$<Page<Pool>>('pools', { q: a.name, include_abandoned: true, limit: 50 }).pipe(
      map(p => p.items.filter(x => x.asset_a_id === id || x.asset_b_id === id)),
      // with the books (pools of kind book are left out of the default list)
      switchMap(items => this.api.market$<Page<Pool>>('pools', { q: a.name, kind: 'book', limit: 50 }).pipe(
        map(b => [...items, ...b.items.filter(x => (x.asset_a_id === id || x.asset_b_id === id) && !items.some(i => i.pool === x.pool))]),
        catchError(() => of(items)),
      )),
    ));
    this.candles$ = combineLatest([this.pools$, this.interval$]).pipe(switchMap(([p, i]) => {
      const mp = p.data ? this.mainPool(p.data) : null;
      return mp ? flushLoaded(this.api.market$<{ items: Candle[] }>(`pools/${mp.pool}/candles`, { interval: i }).pipe(map(r => r.items ?? []))) : of({ loading: false } as FlushLoaded<Candle[]>);
    }));
    this.auctions$ = ok((id, a) => this.api.rpc$<any[]>('listauctions', true, 50, 0, a.name).pipe(tap(rows => this.auctionFilters = statusFilter(rows))));
    const curators = savedCurators();
    this.verified$ = curators.length ? ok(id => this.api.rpc$<any>('getverifications', F.assetArg(id), curators)) : of({ loading: false });
  }

  setInterval(i: string): void {
    this.interval = i;
    this.interval$.next(i);
  }

  /** its deepest pool with ECX, else its first */
  mainPool(pools: Pool[]): Pool | null {
    const withEcx = pools.filter(p => p.curve !== 'book' && (p.asset_a === 'ECX' || p.asset_b === 'ECX')).sort((a, b) => b.depth_ecx - a.depth_ecx);
    return withEcx[0] ?? pools.find(p => p.curve !== 'book') ?? null;
  }

  /** its links that are http(s) URLs (the API gives URLs, or { label, url }) */
  linkList(m: AssetDetail): { label: string; url: string }[] {
    return (m.links ?? []).map((l: any) => typeof l === 'string' ? { label: l, url: l } : { label: String(l?.label || l?.url || ''), url: String(l?.url ?? '') })
      .filter(l => /^https?:\/\/[^\s"'<>]+$/i.test(l.url)).slice(0, 10);
  }

  dataRows(a: AssetRow): [string, string][] {
    return Object.entries(a.data ?? {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, String(v)]);
  }

  historyRows(h: Record<string, { value: string | null; txid: string; height: number }[]>): HistoryRow[] {
    return Object.entries(h ?? {}).flatMap(([field, rows]) => (Array.isArray(rows) ? rows : []).filter(r => r.value !== null || rows.length > 1)
      .map(r => ({ field, value: r.value === null ? null : String(r.value), txid: r.txid, height: r.height })))
      .sort((x, y) => y.height - x.height);
  }

  curatorNames(v: any): string {
    return (v?.curators ?? []).map((c: any) => `${c.name || F.shortId(c.curator, 6)}: ${c.verified ? 'yes' : 'no'}`).join(', ');
  }
}

interface VerificationRow { asset: string; loading: boolean; data?: any; error?: string }

/** /verifications: verified issuers per the viewer's own curator list (getverifications) */
@Component({
  selector: 'app-flush-verifications-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Verified issuers" sub="A curator (an oracle) verifies an asset by attesting it; anyone can be a curator, so a verification means something only for the curators you choose" [tabs]="tabs" active="/verifications"></app-flush-head>
    <div class="card-box mb-3">
      <h3>Your curators <span class="hint">oracle ids, kept in this browser only</span></h3>
      <textarea class="form-control mono" rows="3" [value]="curatorsText" (change)="curatorsText = $any($event.target).value" placeholder="64-hex oracle ids, one per line (1 to 20)" aria-label="Curators"></textarea>
      <h3 class="mt-2">Assets <span class="hint">tickers or ids, comma separated</span></h3>
      <input class="form-control" [value]="assetsText" (change)="assetsText = $any($event.target).value" aria-label="Assets">
      <button class="btn btn-sm btn-primary mt-2" (click)="check()">Check</button>
      <p class="hint mt-2 mb-0">Curators are oracles: <a routerLink="/oracles">the registered oracles</a>. A curator's word on an asset is its last attested round of
        "Layers verification &lt;asset&gt; #round": 1 verifies, 0 takes it back.</p>
    </div>
    @if (rows.length) {
      <div class="box">
        <app-chain-table [rows]="rows" [columns]="cols" [filters]="verdicts" [search]="matches" searchPlaceholder="Asset" [pageSize]="25" empty="No asset to check.">
          <ng-template cxCell="asset" let-r>@if (r.data) {<app-flush-asset [id]="r.data.asset"></app-flush-asset>} @else {<span>{{ r.asset }}</span>}</ng-template>
          <ng-template cxCell="verdict" let-r>@if (r.loading) {<span class="muted">…</span>} @else if (r.data) {<span class="pill" [class.ok]="r.data.verified">{{ r.data.verified ? 'verified' : 'not verified' }}</span>} @else {<span class="pill warn">{{ r.error }}</span>}</ng-template>
          <ng-template cxCell="curators" let-r>@for (c of r.data?.curators ?? []; track c.curator) {<span class="me-3"><a [routerLink]="['/oracle', c.curator]">{{ c.name || fx.shortId(c.curator, 6) }}</a>: {{ c.verified ? 'yes' : 'no' }}@if (c.round) {<span class="muted ms-1">(round {{ c.round }})</span>}</span>}</ng-template>
        </app-chain-table>
      </div>
    }
  </div>`,
})
export class FlushVerificationsPage implements OnInit {
  tabs = ASSET_TABS;
  fx = F;
  curatorsText = '';
  assetsText = '';
  rows: VerificationRow[] = [];
  cols: CxColumn<VerificationRow>[] = [
    { key: 'asset', label: 'Asset', sort: r => r.asset },
    { key: 'verdict', label: 'Verdict', sort: r => r.data ? (r.data.verified ? 2 : 1) : 0 },
    { key: 'curators', label: 'Curators' },
  ];
  verdicts: CxFilter<VerificationRow>[] = [{ label: 'Verdict', options: [
    { label: 'verified', test: r => !!r.data?.verified }, { label: 'not verified', test: r => !!r.data && !r.data.verified }, { label: 'error', test: r => !r.loading && !r.data },
  ] }];
  matches = (r: VerificationRow, q: string) => `${r.asset} ${r.data?.asset ?? ''}`.toLowerCase().includes(q);

  constructor(private api: FlushApiService, private seo: SeoService, private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush verified issuers');
    this.curatorsText = savedCurators().join('\n');
    this.api.market$<Page<{ ticker: string }>>('launches', { sort: 'volume', limit: 10 }).pipe(catchError(() => of(null))).subscribe(p => {
      if (!this.assetsText && p?.items?.length) {
        this.assetsText = p.items.map(i => i.ticker).join(', ');
        this.cd.markForCheck();
      }
    });
  }

  check(): void {
    const curators = this.curatorsText.split(/[\s,]+/).filter(F.isId).slice(0, 20);
    saveCurators(curators);
    const assets = this.assetsText.split(/[\s,]+/).map(s => s.trim()).filter(s => F.isId(s) || F.isTicker(s)).slice(0, 50);
    if (!curators.length) {
      this.rows = assets.map(asset => ({ asset, loading: false, error: 'name a curator first' }));
      return;
    }
    this.rows = assets.map(asset => ({ asset, loading: true }));
    this.rows.forEach((r, i) => this.api.rpc$<any>('getverifications', F.assetArg(r.asset), curators).subscribe({
      next: d => {
        this.rows[i] = { ...r, loading: false, data: d };
        this.rows = [...this.rows];
        this.cd.markForCheck();
      },
      error: () => {
        this.rows[i] = { ...r, loading: false, error: 'unknown asset or curator' };
        this.rows = [...this.rows];
        this.cd.markForCheck();
      },
    }));
  }
}

/** /auctions: Dutch auctions of assets (listauctions) */
@Component({
  selector: 'app-flush-auctions-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Auctions" sub="Dutch auctions: an asset sold at a price falling block by block from its start to its end, to whoever bids first" [tabs]="tabs" active="/auctions"></app-flush-head>
    <div class="filters"><label><input type="checkbox" [checked]="closed" (change)="toggle($any($event.target).checked)"> collected ones too</label></div>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Auctions" [list]="true" [height]="300"></app-flush-state>
      @if (v.data; as d) {
        <div class="box">
          <app-chain-table [rows]="d" [columns]="cols" [filters]="filters" [search]="matches" searchPlaceholder="Auction or ticker" [pageSize]="25" empty="No auction." [trackBy]="trackAuction">
            <ng-template cxCell="auction" let-x><a [routerLink]="['/auction', x.auction]" class="mono">{{ fx.shortId(x.auction, 6) }}</a></ng-template>
            <ng-template cxCell="sells" let-x>{{ fx.amount(x.amount) }} <app-flush-token [ticker]="x.base" [id]="x.base_id"></app-flush-token> for <app-flush-token [ticker]="x.quote" [id]="x.quote_id"></app-flush-token></ng-template>
            <ng-template cxCell="left" let-x>{{ fx.amount(x.remaining) }}</ng-template>
            <ng-template cxCell="unit" let-x>{{ fx.price(x.unit_price) }} {{ x.quote }}</ng-template>
            <ng-template cxCell="range" let-x>{{ fx.amount(x.start_price) }} → {{ fx.amount(x.end_price) }}</ng-template>
            <ng-template cxCell="blocks" let-x>{{ x.start_height | number }} to {{ x.end_height | number }}</ng-template>
            <ng-template cxCell="status" let-x><span class="pill" [class.on]="x.status === 'open'" [class.ok]="x.status === 'sold out'">{{ x.status }}</span></ng-template>
          </app-chain-table>
        </div>
      }
    }
  </div>`,
})
export class FlushAuctionsPage implements OnInit {
  tabs = DEX_TABS;
  fx = F;
  cols: CxColumn<any>[] = [
    { key: 'auction', label: 'Auction' },
    { key: 'sells', label: 'Sells', sort: x => Number(x.amount), nowrap: true },
    { key: 'left', label: 'Left', align: 'right', sort: x => Number(x.remaining) },
    { key: 'unit', label: 'Unit price now', align: 'right', sort: x => Number(x.unit_price), nowrap: true },
    { key: 'range', label: 'Start → end price', align: 'right', nowrap: true, hide: 'lg' },
    { key: 'blocks', label: 'Blocks', sort: x => Number(x.start_height), nowrap: true, hide: 'md' },
    { key: 'bids', label: 'Bids', align: 'right', sort: x => Number(x.bids) },
    { key: 'status', label: 'Status', sort: x => x.status },
  ];
  filters: CxFilter<any>[] = [];
  trackAuction = (x: any) => x.auction;
  matches = (x: any, q: string) => `${x.auction} ${x.base ?? ''} ${x.quote ?? ''}`.toLowerCase().includes(q);
  closed = false;
  private closed$ = new BehaviorSubject(false);
  view$: Observable<FlushLoaded<any[]>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush auctions');
    this.view$ = this.closed$.pipe(switchMap(c => flushLoaded(this.api.rpc$<any[]>('listauctions', c, 200).pipe(tap(rows => this.filters = statusFilter(rows))))));
  }

  toggle(c: boolean): void {
    this.closed = c;
    this.closed$.next(c);
  }
}

/** /auction/:id: one auction (getauction) */
@Component({
  selector: 'app-flush-auction-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Auction" [tabs]="tabs" active="/auctions"></app-flush-head>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Auction" [id]="id" [height]="300"></app-flush-state>
      @if (v.data; as x) {
        <div class="sub"><span class="id">{{ x.auction }}</span> · made by <a [routerLink]="['/tx', x.auction]">its transaction</a></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Sells</div><div class="v">{{ fx.compact(x.amount) }}</div><div class="s"><app-flush-token [ticker]="x.base" [id]="x.base_id"></app-flush-token> for <app-flush-token [ticker]="x.quote" [id]="x.quote_id"></app-flush-token></div></div>
          <div class="kpi"><div class="l">Left</div><div class="v">{{ fx.compact(x.remaining) }}</div><div class="s">{{ x.bids }} bids so far</div></div>
          <div class="kpi"><div class="l">Unit price now</div><div class="v">{{ fx.price(x.unit_price) }}</div><div class="s">{{ x.quote }}, in the next block</div></div>
          <div class="kpi"><div class="l">Status</div><div class="v">{{ x.status }}</div><div class="s">blocks {{ x.start_height | number }} to {{ x.end_height | number }}</div></div>
        </div>
        <div class="card-box"><table class="kv"><tbody>
          <tr><th>Price of all of it</th><td>{{ fx.amount(x.start_price) }} at the start → {{ fx.amount(x.end_price) }} at the end; {{ fx.amount(x.price) }} {{ x.quote }} in the next block</td></tr>
          <tr><th>Cost of what is left</th><td>{{ fx.amount(x.cost_of_remaining) }} {{ x.quote }}</td></tr>
          <tr><th>Proceeds</th><td>{{ fx.amount(x.proceeds) }} {{ x.quote }} not collected yet</td></tr>
          <tr><th>Receipt</th><td>@if (x.receipt; as r) {<a [routerLink]="['/tx', r.txid]" class="mono">{{ fx.shortId(r.txid) }}:{{ r.vout }}</a>@if (r.address) { · collected by <app-flush-addr [address]="r.address"></app-flush-addr>}} @else {collected}</td></tr>
        </tbody></table></div>
      }
    }
  </div>`,
})
export class FlushAuctionPage implements OnInit {
  tabs = DEX_TABS;
  fx = F;
  id = '';
  view$: Observable<FlushLoaded<any>>;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('Flush auction ' + F.shortId(id, 6));
      }),
      switchMap(id => flushLoaded(this.api.rpc$<any>('getauction', id))),
    );
  }
}

/** /oracles: the registered oracles (listoracles): an oracle is its key; curators of verified issuers are oracles */
@Component({
  selector: 'app-flush-oracles-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Oracles" sub="Keys that attest values of events (signed), for oracle contracts and as curators of verified issuers; a name is only a label" [tabs]="tabs" active="/oracles"></app-flush-head>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Oracles" [list]="true" [height]="300"></app-flush-state>
      @if (v.data; as d) {
        <div class="box">
          <app-chain-table [rows]="d" [columns]="cols" [search]="matches" searchPlaceholder="Oracle, name or key" [pageSize]="25" empty="No oracle registered." [trackBy]="trackOracle">
            <ng-template cxCell="oracle" let-o><a [routerLink]="['/oracle', o.oracle]" class="mono">{{ fx.shortId(o.oracle, 8) }}</a></ng-template>
            <ng-template cxCell="pubkey" let-o><span class="mono" [title]="o.pubkey">{{ fx.shortId(o.pubkey, 6) }}</span></ng-template>
            <ng-template cxCell="attestations" let-o>{{ o.attestations | number }}</ng-template>
            <ng-template cxCell="height" let-o><a [routerLink]="['/tx', o.registration]">{{ o.height | number }}</a></ng-template>
          </app-chain-table>
        </div>
        @if (d.length >= 200) {<div class="pager"><button class="btn btn-sm btn-secondary" (click)="more(d[d.length - 1].oracle)">Next →</button></div>}
      }
    }
  </div>`,
})
export class FlushOraclesPage implements OnInit {
  tabs = ASSET_TABS;
  fx = F;
  cols: CxColumn<any>[] = [
    { key: 'oracle', label: 'Oracle' },
    { key: 'name', label: 'Name', sort: o => String(o.name ?? '') },
    { key: 'pubkey', label: 'Key', hide: 'md' },
    { key: 'attestations', label: 'Attestations', align: 'right', sort: o => Number(o.attestations) },
    { key: 'height', label: 'Registered', sort: o => Number(o.height) },
  ];
  trackOracle = (o: any) => o.oracle;
  matches = (o: any, q: string) => `${o.oracle} ${o.name ?? ''} ${o.pubkey ?? ''}`.toLowerCase().includes(q);
  private start$ = new BehaviorSubject<string | undefined>(undefined);
  view$: Observable<FlushLoaded<any[]>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush oracles');
    this.view$ = this.start$.pipe(switchMap(s => flushLoaded(this.api.rpc$<any[]>('listoracles', s ?? '', 200))));
  }

  more(last: string): void {
    this.start$.next(last);
  }
}

/** /oracle/:id: an oracle, and the value it attested for an event (getoraclevalue) or a contract (getoraclecontract) */
@Component({
  selector: 'app-flush-oracle-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Oracle" [tabs]="tabs" active="/oracles"></app-flush-head>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Oracle" [id]="id" [height]="200"></app-flush-state>
      @if (v.data; as o) {
        <div class="card-box"><table class="kv"><tbody>
          <tr><th>Oracle id</th><td class="mono">{{ o.oracle }}</td></tr>
          <tr><th>Name</th><td>{{ o.name }} <span class="muted">(a label: others may share it)</span></td></tr>
          <tr><th>Key</th><td class="mono">{{ o.pubkey }}</td></tr>
          <tr><th>Registered</th><td>block {{ o.height | number }} · <a [routerLink]="['/tx', o.registration]" class="mono">{{ fx.shortId(o.registration) }}</a></td></tr>
          <tr><th>Attestations</th><td>{{ o.attestations | number }}</td></tr>
        </tbody></table></div>
      } @else if (!v.loading && !v.error) {<div class="unavail">No oracle with this id among the registered ones.</div>}
    }
    <h2>A value it attested</h2>
    <div class="filters"><input class="form-control mono" style="max-width: 560px" placeholder="Event id (64 hex)" [value]="event" (change)="lookup($any($event.target).value)" aria-label="Event id"></div>
    @if (value$ | async; as val) {
      <app-flush-state [state]="val" what="Attestation" [height]="80"></app-flush-state>
      @if (val.data; as a) {
        <div class="card-box"><table class="kv"><tbody>
          <tr><th>Attested</th><td>{{ a.attested ? 'yes' : 'not yet' }}</td></tr>
          @if (a.attested) {
            <tr><th>Value</th><td>{{ a.value | number }}</td></tr>
            <tr><th>Signed for</th><td>block {{ a.signed_height | number }}</td></tr>
            <tr><th>In</th><td>block <a [routerLink]="['/block', a.height]">{{ a.height | number }}</a> · <a [routerLink]="['/tx', a.txid]" class="mono">{{ fx.shortId(a.txid) }}</a></td></tr>
          }
        </tbody></table></div>
      }
    }
  </div>`,
})
export class FlushOraclePage implements OnInit {
  tabs = ASSET_TABS;
  fx = F;
  id = '';
  event = '';
  view$: Observable<FlushLoaded<any>>;
  value$: Observable<FlushLoaded<any>> | null = null;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('Flush oracle ' + F.shortId(id, 6));
      }),
      // listoracles from just before it: its own row first (ids in order)
      switchMap(id => flushLoaded(this.api.rpc$<any[]>('listoracles', '', 1000).pipe(map(list => (list ?? []).find(o => o.oracle === id || o.pubkey === id) ?? null)))),
    );
  }

  lookup(event: string): void {
    this.event = event.trim();
    this.value$ = F.isId(this.event) ? flushLoaded(this.api.rpc$<any>('getoraclevalue', this.id, this.event)) : null;
  }
}
