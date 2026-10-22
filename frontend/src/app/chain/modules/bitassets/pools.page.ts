import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$, kindLabel } from '@app/chain/l2/features/feature-kit';
import { Ref } from './assets.page';

// GET /api/v1/l2/feature/pools[/:id] (chains/L2-API.md)
export interface PoolItem {
  id: string;
  asset0: string;
  asset1: string;
  /** get_amm_pool_state: reserve0, reserve1, outstanding_lp_tokens, creation_txid; null when the node has none */
  state: { reserve0: number; reserve1: number; outstanding_lp_tokens: number; creation_txid: string } | null;
  /** reserve0 / reserve1: units of asset0 per unit of asset1 */
  price: number | null;
  created: Ref | null;
  swaps: number;
  volume0: number;
  volume1: number;
  events: number;
  last: Ref | null;
  replayed: { reserve0: number; reserve1: number; outstanding: number } | null;
}
export interface PoolEvent extends Ref {
  kind: 'mint' | 'burn' | 'swap';
  amount0: number;
  amount1: number;
  lp: number;
  reserve0: number;
  reserve1: number;
  outstanding: number;
  price: number | null;
}
export interface PoolDetail extends PoolItem {
  history: PoolEvent[];
  series: { height: number; time: number | null; price: number; reserve0: number; reserve1: number }[];
}

const EVENT: Record<string, string> = { mint: 'add liquidity', burn: 'remove liquidity', swap: 'swap' };

/** /pools: the AMM pools with their reserves, price, LP tokens, swaps and volume */
@Component({
  selector: 'app-bitassets-pools',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="pools"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no AMM pools: this page belongs to the BitAssets explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Pools" [height]="300"></app-l2-state>
        @if (v.data; as d) {
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Pool</th><th class="text-end">Reserve 0</th><th class="text-end">Reserve 1</th><th class="text-end">Price</th><th class="text-end">LP tokens</th><th class="text-end">Swaps</th><th>Created</th></tr></thead>
              <tbody>
                @for (p of d.items; track p.id) {
                  <tr>
                    <td><a [routerLink]="['/pools', p.id]"><app-l2-asset [id]="p.asset0"></app-l2-asset> / <app-l2-asset [id]="p.asset1"></app-l2-asset></a></td>
                    <td class="text-end">{{ reserve(p, 0) | number }}</td>
                    <td class="text-end">{{ reserve(p, 1) | number }}</td>
                    <td class="text-end">@if (p.price !== null) {<span>{{ p.price | number:'1.0-6' }}</span>} @else {<span class="muted">–</span>}</td>
                    <td class="text-end">{{ (p.state?.outstanding_lp_tokens ?? p.replayed?.outstanding ?? 0) | number }}</td>
                    <td class="text-end">{{ p.swaps | number }}</td>
                    <td>@if (p.created) {<a [routerLink]="['/block', p.created.height]">{{ p.created.height | number }}</a>} @else {<span class="muted">–</span>}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">No AMM pool has been created on this sidechain yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <p class="note">Reserves and LP tokens are the node's pool state (get_amm_pool_state); the price is reserve 0 per unit of
            reserve 1, before the 0.3% swap fee. Swaps and history come from the index's AmmMint, AmmBurn and AmmSwap transactions.</p>
        }
      }
    }
  </div>`,
})
export class BitAssetsPoolsPage implements OnInit {
  view$: Observable<Loaded<{ items: PoolItem[] }> | 'unavailable'>;

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('AMM pools');
    this.view$ = featureData$(this.api, 'assets', () => this.api.feature$('pools'));
  }

  reserve(p: PoolItem, k: 0 | 1): number {
    return Number(p.state ? (k ? p.state.reserve1 : p.state.reserve0) : (k ? p.replayed?.reserve1 : p.replayed?.reserve0) ?? 0);
  }
}

/** /pools/:id (asset0-asset1): one pool's state, price over time and its liquidity and swap events */
@Component({
  selector: 'app-bitassets-pool',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="pools" [id]="id" title="AMM pool"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Pool" [id]="id" [height]="400"></app-l2-state>
      @if (v.data; as p) {
        <div class="kpis">
          <div class="kpi"><div class="l">Reserve 0</div><div class="v">{{ (p.state?.reserve0 ?? 0) | number }}</div><div class="s"><app-l2-asset [id]="p.asset0"></app-l2-asset></div></div>
          <div class="kpi"><div class="l">Reserve 1</div><div class="v">{{ (p.state?.reserve1 ?? 0) | number }}</div><div class="s"><app-l2-asset [id]="p.asset1"></app-l2-asset></div></div>
          <div class="kpi"><div class="l">Price</div><div class="v">@if (p.price !== null) {<span>{{ p.price | number:'1.0-6' }}</span>} @else {<span>–</span>}</div><div class="s">asset 0 per unit of asset 1</div></div>
          <div class="kpi"><div class="l">LP tokens</div><div class="v">{{ (p.state?.outstanding_lp_tokens ?? 0) | number }}</div><div class="s">outstanding</div></div>
          <div class="kpi"><div class="l">Swaps</div><div class="v">{{ p.swaps | number }}</div><div class="s">volume {{ p.volume0 | number }} / {{ p.volume1 | number }}</div></div>
        </div>
        @if (mismatch(p)) {
          <p class="note">The reserves replayed from the index ({{ p.replayed?.reserve0 | number }} / {{ p.replayed?.reserve1 | number }}) differ from the node's state: the history below may miss a transaction.</p>
        }
        @if (p.series.length > 1) {
          <h2>Price</h2>
          <div class="box"><app-l2-chart [series]="priceSeries(p)" kind="step" [zero]="false"></app-l2-chart></div>
          <h2>Reserves</h2>
          <div class="box"><app-l2-chart [series]="reserveSeries(p)" kind="step" [legend]="true"></app-l2-chart></div>
        }
        <h2>History</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Block</th><th>Time</th><th>Event</th><th class="text-end">Reserve 0 change</th><th class="text-end">Reserve 1 change</th><th class="text-end">LP tokens</th><th class="text-end">Price after</th><th>Transaction</th></tr></thead>
            <tbody>
              @for (e of p.history; track e.txid) {
                <tr>
                  <td><a [routerLink]="['/block', e.height]">{{ e.height | number }}</a></td>
                  <td>@if (e.time) {<app-timestamp [unixTime]="e.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td><span class="pill on">{{ event(e.kind) }}</span></td>
                  <td class="text-end" [class.pos]="e.amount0 > 0" [class.neg]="e.amount0 < 0">{{ e.amount0 | number }}</td>
                  <td class="text-end" [class.pos]="e.amount1 > 0" [class.neg]="e.amount1 < 0">{{ e.amount1 | number }}</td>
                  <td class="text-end">{{ e.lp ? (e.lp | number) : '' }}</td>
                  <td class="text-end">@if (e.price !== null) {<span>{{ e.price | number:'1.0-6' }}</span>} @else {<span class="muted">–</span>}</td>
                  <td><a [routerLink]="['/tx', e.txid]" class="mono" [title]="e.txid">{{ shortId(e.txid) }}</a></td>
                </tr>
              } @empty {<tr><td colspan="8" class="empty">No pool transactions in the index.</td></tr>}
            </tbody>
          </table>
        </div>
      }
    }
  </div>`,
})
export class BitAssetsPoolPage implements OnInit {
  id = '';
  view$: Observable<Loaded<PoolDetail>>;
  shortId = shortId;
  kindLabel = kindLabel;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('AMM pool');
      }),
      switchMap(id => featureData$(this.api, 'assets', () => this.api.feature$<PoolDetail>('pools', id))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }

  event(k: string): string {
    return EVENT[k] ?? k;
  }

  mismatch(p: PoolDetail): boolean {
    return !!p.state && !!p.replayed && (Number(p.state.reserve0) !== p.replayed.reserve0 || Number(p.state.reserve1) !== p.replayed.reserve1);
  }

  priceSeries(p: PoolDetail): ChartSeries[] {
    return [{ name: 'price', points: p.series.map(s => [s.height, s.price] as [number, number]) }];
  }

  reserveSeries(p: PoolDetail): ChartSeries[] {
    return [
      { name: 'reserve 0', points: p.series.map(s => [s.height, s.reserve0] as [number, number]) },
      { name: 'reserve 1', points: p.series.map(s => [s.height, s.reserve1] as [number, number]) },
    ];
  }
}
