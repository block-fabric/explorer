import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, catchError, combineLatest, map, of, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { FlushApiService, FlushLoaded, flushLoaded } from '../flush-api.service';
import { ASSET_TABS, DEX_TABS, FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { FLUSH_CHARTS } from '../flush-charts';
import { Candle, Holder, LaunchDetail, Page, Pool } from '../flush.interfaces';
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
          <table class="table table-borderless table-sm">
            <thead><tr><th>Asset</th><th class="r">Supply</th><th class="r">Decimals</th><th class="r">Pools</th><th class="r">Pool depth</th><th class="r">Volume</th><th class="d-none d-md-table-cell">Registered</th><th class="d-none d-lg-table-cell">Last active</th></tr></thead>
            <tbody>
              @for (a of d.assets; track a.asset) {
                <tr>
                  <td><app-flush-token [ticker]="a.name" [id]="a.asset" [logo]="a.has_logo || a.logo ? 'logo' : null" [name]="a.display_name" [showName]="true"></app-flush-token>
                    @if (a.fixed) {<span class="pill ms-1" title="No more can be minted">fixed</span>} @if (a.retired) {<span class="pill warn ms-1">retired</span>}</td>
                  <td class="r nowrap">{{ fx.compact(a.supply) }}</td>
                  <td class="r">{{ a.decimals }}</td>
                  <td class="r">{{ a.pools ?? 0 }}</td>
                  <td class="r nowrap">{{ a.pool_depth ? fx.compact(a.pool_depth) + ' ECX' : '–' }}</td>
                  <td class="r nowrap">{{ a.volume ? fx.compact(a.volume) + ' ECX' : '–' }}</td>
                  <td class="d-none d-md-table-cell"><a [routerLink]="['/block', a.registered]">{{ a.registered | number }}</a></td>
                  <td class="d-none d-lg-table-cell">@if (a.last_activity) {<a [routerLink]="['/block', a.last_activity]">{{ a.last_activity | number }}</a>}</td>
                </tr>
              } @empty {<tr><td colspan="8" class="empty">No asset matches.</td></tr>}
            </tbody>
          </table>
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
  view$: Observable<FlushLoaded<{ assets: AssetRow[]; next_cursor: string | null; partial: boolean; scanned: number }>>;
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
      return flushLoaded(this.api.rpc$<any>('searchassets', q.q, filters, sort, q.cursor, 50).pipe(
        catchError(e => e?.status === 400 ? this.api.rpc$<any>('searchassets', q.q) : throwError(() => e)),
      ));
    }));
  }

  set(p: Partial<typeof this.q>, paging = false): void {
    this.q = { ...this.q, ...p, ...(paging ? {} : { cursor: '' }) };
    this.q$.next(this.q);
  }
}

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
                <table class="table table-borderless table-sm"><thead><tr><th>Field</th><th>Value</th><th>Block</th></tr></thead><tbody>
                  @for (r of historyRows(hd); track $index) {
                    <tr><td class="muted">{{ r.field }}</td><td class="desc">{{ r.value === null ? '(none)' : r.value }}</td><td><a [routerLink]="['/tx', r.txid]">{{ r.height | number }}</a></td></tr>
                  } @empty {<tr><td colspan="3" class="empty">No change since its registration.</td></tr>}
                </tbody></table>
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
          @if (p.data; as pd) {<div class="box"><app-flush-pools [pools]="pd" [compact]="true" empty="No pool or book of this asset."></app-flush-pools></div>
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
          @if (au.data; as ad) {<div class="box"><ng-container *ngTemplateOutlet="auctionTable; context: { $implicit: ad }"></ng-container></div>}
        }
        <ng-template #auctionTable let-rows>
          <table class="table table-borderless table-sm"><thead><tr><th>Auction</th><th>Sells</th><th class="r">Left</th><th class="r">Unit price now</th><th>Blocks</th><th>Status</th></tr></thead><tbody>
            @for (x of rows; track x.auction) {
              <tr><td><a [routerLink]="['/auction', x.auction]" class="mono">{{ fx.shortId(x.auction, 6) }}</a></td><td>{{ fx.amount(x.amount) }} {{ x.base }} for {{ x.quote }}</td>
                <td class="r">{{ fx.amount(x.remaining) }}</td><td class="r">{{ fx.price(x.unit_price) }} {{ x.quote }}</td><td>{{ x.start_height | number }} to {{ x.end_height | number }}</td><td><span class="pill" [class.on]="x.status === 'open'">{{ x.status }}</span></td></tr>
            } @empty {<tr><td colspan="6" class="empty">No auction of this asset.</td></tr>}
          </tbody></table>
        </ng-template>
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
  id = '';
  interval = '1h';
  private interval$ = new BehaviorSubject('1h');
  view$: Observable<FlushLoaded<any>>;
  history$: Observable<FlushLoaded<any>>;
  launch$: Observable<FlushLoaded<LaunchDetail>>;
  pools$: Observable<FlushLoaded<Pool[]>>;
  candles$: Observable<FlushLoaded<Candle[]>>;
  holders$: Observable<FlushLoaded<Page<Holder>>>;
  auctions$: Observable<FlushLoaded<any[]>>;
  verified$: Observable<FlushLoaded<any>>;

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
    this.history$ = ok(id => this.api.rpc$<any>('getassethistory', F.assetArg(id)));
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
    this.auctions$ = ok((id, a) => this.api.rpc$<any[]>('listauctions', true, 50, 0, a.name));
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

  dataRows(a: AssetRow): [string, string][] {
    return Object.entries(a.data ?? {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => [k, String(v)]);
  }

  historyRows(h: Record<string, { value: string | null; txid: string; height: number }[]>): { field: string; value: string | null; txid: string; height: number }[] {
    return Object.entries(h ?? {}).flatMap(([field, rows]) => (Array.isArray(rows) ? rows : []).filter(r => r.value !== null || rows.length > 1)
      .map(r => ({ field, value: r.value === null ? null : String(r.value), txid: r.txid, height: r.height })))
      .sort((x, y) => y.height - x.height);
  }

  curatorNames(v: any): string {
    return (v?.curators ?? []).map((c: any) => `${c.name || F.shortId(c.curator, 6)}: ${c.verified ? 'yes' : 'no'}`).join(', ');
  }
}

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
        <table class="table table-borderless table-sm"><thead><tr><th>Asset</th><th>Verdict</th><th>Curators</th></tr></thead><tbody>
          @for (r of rows; track $index) {
            <tr>
              <td>@if (r.data) {<app-flush-asset [id]="r.data.asset"></app-flush-asset>} @else {<span>{{ r.asset }}</span>}</td>
              <td>@if (r.loading) {<span class="muted">…</span>} @else if (r.data) {<span class="pill" [class.ok]="r.data.verified">{{ r.data.verified ? 'verified' : 'not verified' }}</span>} @else {<span class="pill warn">{{ r.error }}</span>}</td>
              <td>@for (c of r.data?.curators ?? []; track c.curator) {<span class="me-3"><a [routerLink]="['/oracle', c.curator]">{{ c.name || fx.shortId(c.curator, 6) }}</a>: {{ c.verified ? 'yes' : 'no' }}@if (c.round) { <span class="muted">(round {{ c.round }})</span>}</span>}</td>
            </tr>
          }
        </tbody></table>
      </div>
    }
  </div>`,
})
export class FlushVerificationsPage implements OnInit {
  tabs = ASSET_TABS;
  fx = F;
  curatorsText = '';
  assetsText = '';
  rows: { asset: string; loading: boolean; data?: any; error?: string }[] = [];

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
          <table class="table table-borderless table-sm"><thead><tr><th>Auction</th><th>Sells</th><th class="r">Left</th><th class="r">Unit price now</th><th class="r">Start → end price</th><th>Blocks</th><th class="r">Bids</th><th>Status</th></tr></thead><tbody>
            @for (x of d; track x.auction) {
              <tr><td><a [routerLink]="['/auction', x.auction]" class="mono">{{ fx.shortId(x.auction, 6) }}</a></td>
                <td class="nowrap">{{ fx.amount(x.amount) }} <app-flush-token [ticker]="x.base" [id]="x.base_id"></app-flush-token> for <app-flush-token [ticker]="x.quote" [id]="x.quote_id"></app-flush-token></td>
                <td class="r">{{ fx.amount(x.remaining) }}</td><td class="r nowrap">{{ fx.price(x.unit_price) }} {{ x.quote }}</td>
                <td class="r nowrap">{{ fx.amount(x.start_price) }} → {{ fx.amount(x.end_price) }}</td><td class="nowrap">{{ x.start_height | number }} to {{ x.end_height | number }}</td>
                <td class="r">{{ x.bids }}</td><td><span class="pill" [class.on]="x.status === 'open'" [class.ok]="x.status === 'sold out'">{{ x.status }}</span></td></tr>
            } @empty {<tr><td colspan="8" class="empty">No auction.</td></tr>}
          </tbody></table>
        </div>
      }
    }
  </div>`,
})
export class FlushAuctionsPage implements OnInit {
  tabs = DEX_TABS;
  fx = F;
  closed = false;
  private closed$ = new BehaviorSubject(false);
  view$: Observable<FlushLoaded<any[]>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush auctions');
    this.view$ = this.closed$.pipe(switchMap(c => flushLoaded(this.api.rpc$<any[]>('listauctions', c, 200))));
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
          <table class="table table-borderless table-sm"><thead><tr><th>Oracle</th><th>Name</th><th>Key</th><th class="r">Attestations</th><th>Registered</th></tr></thead><tbody>
            @for (o of d; track o.oracle) {
              <tr><td><a [routerLink]="['/oracle', o.oracle]" class="mono">{{ fx.shortId(o.oracle, 8) }}</a></td><td>{{ o.name }}</td><td class="mono" [title]="o.pubkey">{{ fx.shortId(o.pubkey, 6) }}</td>
                <td class="r">{{ o.attestations | number }}</td><td><a [routerLink]="['/tx', o.registration]">{{ o.height | number }}</a></td></tr>
            } @empty {<tr><td colspan="5" class="empty">No oracle registered.</td></tr>}
          </tbody></table>
        </div>
        @if (d.length >= 200) {<button class="btn btn-sm btn-secondary mt-2" (click)="more(d[d.length - 1].oracle)">Next →</button>}
      }
    }
  </div>`,
})
export class FlushOraclesPage implements OnInit {
  tabs = ASSET_TABS;
  fx = F;
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
