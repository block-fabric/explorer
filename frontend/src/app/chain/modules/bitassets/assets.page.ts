import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$, kindLabel } from '@app/chain/l2/features/feature-kit';

// GET /api/v1/l2/feature/assets[/:id] (chains/L2-API.md)
export interface Ref { height: number; time: number | null; txid: string }
export interface AssetItem {
  id: string;
  assetId: string;
  seq: number | null;
  name: string | null;
  data: any;
  supply: number;
  holders: number;
  controller: string | null;
  registered: Ref | null;
  initialSupply: number | null;
  minted: number;
  txs: number;
  last: Ref | null;
  /** sats per unit, from the asset's pool with sats */
  price: number | null;
  pools: string[];
}
export interface AssetActivity extends Ref {
  kind: string;
  amount: number;
  counterAsset: string | null;
  counterAmount: number | null;
  outputs: { address: string; amount: number }[];
}
export interface AssetDetail extends AssetItem {
  holderList: { address: string; amount: number; share: number | null }[];
  mints: (Ref & { amount: number })[];
  activity: AssetActivity[];
  priceHistory: { height: number; time: number | null; price: number }[];
}

/** /assets: every BitAsset with its supply, holders, price and last activity */
@Component({
  selector: 'app-bitassets-assets',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="assets"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no assets: this page belongs to the BitAssets explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Assets" [height]="400"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Assets</div><div class="v">{{ d.items.length | number }}</div><div class="s">registered</div></div>
            <div class="kpi"><div class="l">Holders</div><div class="v">{{ holders(d.items) | number }}</div><div class="s">address and asset pairs</div></div>
            <div class="kpi"><div class="l">Reservations</div><div class="v">{{ d.reservations.total | number }}</div><div class="s">{{ d.reservations.open | number }} not yet registered</div></div>
            <div class="kpi"><div class="l">Priced</div><div class="v">{{ priced(d.items) | number }}</div><div class="s">with an AMM pool against sats</div></div>
          </div>
          <input type="search" class="form-control form-control-sm search" placeholder="Filter by name, hash or address" [value]="filter" (input)="filter = $any($event.target).value">
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>#</th><th>Asset</th><th class="text-end">Supply</th><th class="text-end">Holders</th><th class="text-end">Price</th><th>Registered</th><th>Last activity</th><th class="text-end">Txs</th></tr></thead>
              <tbody>
                @for (a of filtered(d.items); track a.id) {
                  <tr>
                    <td class="muted">{{ a.seq }}</td>
                    <td><app-l2-asset [id]="a.id"></app-l2-asset></td>
                    <td class="text-end">{{ a.supply | number }}</td>
                    <td class="text-end">{{ a.holders | number }}</td>
                    <td class="text-end">@if (a.price !== null) {<span>{{ a.price | number:'1.0-4' }} <span class="muted">sats</span></span>} @else {<span class="muted">–</span>}</td>
                    <td>@if (a.registered) {<a [routerLink]="['/block', a.registered.height]">{{ a.registered.height | number }}</a>} @else {<span class="muted">–</span>}</td>
                    <td>@if (a.last?.time) {<app-timestamp [unixTime]="a.last!.time!" [hideTimeSince]="true"></app-timestamp>} @else if (a.last) {<a [routerLink]="['/block', a.last.height]">{{ a.last.height | number }}</a>} @else {<span class="muted">–</span>}</td>
                    <td class="text-end">{{ a.txs | number }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="8" class="empty">{{ filter ? 'Nothing matches the filter.' : 'No assets yet.' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <p class="note">An asset's name shows when it hashes to the registered name hash (the chain keeps only the hash); else its short hash.
            Supply and holders are the unspent outputs in the explorer's index.</p>
        }
      }
    }
  </div>`,
})
export class BitAssetsAssetsPage implements OnInit {
  view$: Observable<Loaded<{ items: AssetItem[]; reservations: { total: number; open: number } }> | 'unavailable'>;
  filter = '';

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Assets');
    this.view$ = featureData$(this.api, 'assets', () => this.api.feature$('assets'));
  }

  holders(items: AssetItem[]): number {
    return items.reduce((s, a) => s + a.holders, 0);
  }

  priced(items: AssetItem[]): number {
    return items.filter(a => a.price !== null).length;
  }

  filtered(items: AssetItem[]): AssetItem[] {
    const q = this.filter.trim().toLowerCase();
    return q ? items.filter(a => [a.id, a.name, a.controller].some(x => String(x ?? '').toLowerCase().includes(q))) : items;
  }
}

/** /assets/:id: one BitAsset: supply, holders, price history, mints and activity */
@Component({
  selector: 'app-bitassets-asset',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="assets" [id]="id" [title]="title"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Asset" [id]="id" [height]="400"></app-l2-state>
      @if (v.data; as a) {
        <div class="kpis">
          <div class="kpi"><div class="l">Supply</div><div class="v">{{ a.supply | number }}</div><div class="s">initial {{ a.initialSupply ?? 0 | number }}, minted {{ a.minted | number }}</div></div>
          <div class="kpi"><div class="l">Holders</div><div class="v">{{ a.holders | number }}</div><div class="s">addresses with a balance</div></div>
          <div class="kpi"><div class="l">Price</div><div class="v">@if (a.price !== null) {<span>{{ a.price | number:'1.0-4' }}</span>} @else {<span>–</span>}</div><div class="s">sats per unit (AMM)</div></div>
          <div class="kpi"><div class="l">Transactions</div><div class="v">{{ a.txs | number }}</div><div class="s">@if (a.last) {<span>last in block {{ a.last.height | number }}</span>}</div></div>
        </div>
        <div class="grid2">
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Name</th><td>@if (a.name) {<b>{{ a.name }}</b> <span class="muted">(hashes to the id)</span>} @else {<span class="muted">not revealed: the chain keeps the name's hash</span>}</td></tr>
              <tr><th>Sequence</th><td>{{ a.seq ?? '–' }}</td></tr>
              <tr><th>AssetId</th><td class="mono">{{ a.assetId }}</td></tr>
              <tr><th>Registered</th><td>@if (a.registered) {block <a [routerLink]="['/block', a.registered.height]">{{ a.registered.height | number }}</a>, tx <a [routerLink]="['/tx', a.registered.txid]" class="mono">{{ shortId(a.registered.txid) }}</a>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Controller</th><td>@if (a.controller) {<a [routerLink]="['/address', a.controller]" class="mono">{{ a.controller }}</a> <span class="muted">(holds the control coin: can mint and update)</span>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Pools</th><td>@for (p of a.pools; track p) {<div><app-l2-asset [id]="p"></app-l2-asset></div>} @empty {<span class="muted">none</span>}</td></tr>
            </tbody></table>
          </div>
          <div class="box"><app-l2-value [value]="a.data"></app-l2-value></div>
        </div>

        @if (a.priceHistory.length) {
          <h2>Price</h2>
          <div class="box"><app-l2-chart [series]="priceSeries(a)" kind="step" unit="sats" [zero]="false"></app-l2-chart></div>
        }

        <h2>Holders</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Address</th><th class="text-end">Amount</th><th>Share</th></tr></thead>
            <tbody>
              @for (h of a.holderList; track h.address) {
                <tr>
                  <td><a [routerLink]="['/address', h.address]" class="mono">{{ h.address }}</a></td>
                  <td class="text-end">{{ h.amount | number }}</td>
                  <td style="min-width: 160px"><div class="bar"><div class="fill" [style.width.%]="(h.share ?? 0) * 100"></div></div> <span class="muted small">{{ (h.share ?? 0) * 100 | number:'1.0-2' }}%</span></td>
                </tr>
              } @empty {<tr><td colspan="3" class="empty">No holders.</td></tr>}
            </tbody>
          </table>
          @if (a.holders > a.holderList.length) {<div class="muted small">The top {{ a.holderList.length }} of {{ a.holders | number }}.</div>}
        </div>

        <h2>Activity</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Block</th><th>Time</th><th>Kind</th><th class="text-end">Amount</th><th>Against</th><th>Outputs</th><th>Transaction</th></tr></thead>
            <tbody>
              @for (r of a.activity; track r.txid + r.kind) {
                <tr>
                  <td><a [routerLink]="['/block', r.height]">{{ r.height | number }}</a></td>
                  <td>@if (r.time) {<app-timestamp [unixTime]="r.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td><span class="pill" [class.on]="r.kind !== 'transfer'">{{ kindLabel(r.kind) }}</span></td>
                  <td class="text-end">{{ r.amount | number }}</td>
                  <td>@if (r.counterAsset) {@if (r.counterAmount !== null) {<span>{{ r.counterAmount | number }} </span>}<app-l2-asset [id]="r.counterAsset"></app-l2-asset>} @else {<span class="muted">–</span>}</td>
                  <td class="small">@for (o of r.outputs; track $index) {<div><a [routerLink]="['/address', o.address]" class="mono">{{ shortId(o.address, 6) }}</a> <span class="muted">{{ o.amount | number }}</span></div>}</td>
                  <td><a [routerLink]="['/tx', r.txid]" class="mono" [title]="r.txid">{{ shortId(r.txid) }}</a></td>
                </tr>
              } @empty {<tr><td colspan="7" class="empty">No activity in the index.</td></tr>}
            </tbody>
          </table>
          <div class="muted small">Outputs lists where the asset went, change included: the chain does not mark change.</div>
        </div>
      }
    }
  </div>`,
})
export class BitAssetsAssetPage implements OnInit {
  id = '';
  title: string | null = null;
  view$: Observable<Loaded<AssetDetail>>;
  shortId = shortId;
  kindLabel = kindLabel;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.title = 'BitAsset';
        this.seo.setTitle('Asset ' + shortId(id));
      }),
      switchMap(id => featureData$(this.api, 'assets', () => this.api.feature$<AssetDetail>('assets', id).pipe(tap(a => {
        this.title = a.name ?? 'BitAsset';
        if (a.name) {
          this.seo.setTitle('Asset ' + a.name);
        }
      })))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }

  priceSeries(a: AssetDetail): ChartSeries[] {
    return [{ name: 'sats per unit', points: a.priceHistory.map(p => [p.height, p.price] as [number, number]) }];
  }
}
