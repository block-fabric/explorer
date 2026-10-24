import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, chipsBy, featureData$, kindLabel, matchAny } from '@app/chain/l2/features/feature-kit';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

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
          <div class="box">
            <app-chain-table [rows]="d.items" [columns]="assetCols" [filters]="assetFilters" [search]="assetMatches" searchPlaceholder="Name, hash or address…"
                sort="seq" [asc]="true" empty="No assets yet." [trackBy]="assetKey">
              <ng-template cxCell="seq" let-a><span class="muted">{{ a.seq }}</span></ng-template>
              <ng-template cxCell="asset" let-a><app-l2-asset [id]="a.id"></app-l2-asset></ng-template>
              <ng-template cxCell="supply" let-a>{{ a.supply | number }}</ng-template>
              <ng-template cxCell="holders" let-a>{{ a.holders | number }}</ng-template>
              <ng-template cxCell="price" let-a>@if (a.price !== null) {<span>{{ a.price | number:'1.0-4' }}</span><span class="muted ms-1">sats</span>} @else {<span class="muted">–</span>}</ng-template>
              <ng-template cxCell="registered" let-a>@if (a.registered) {<a [routerLink]="['/block', a.registered.height]">{{ a.registered.height | number }}</a>} @else {<span class="muted">–</span>}</ng-template>
              <ng-template cxCell="last" let-a>@if (a.last?.time) {<app-timestamp [unixTime]="a.last!.time!" [hideTimeSince]="true"></app-timestamp>} @else if (a.last) {<a [routerLink]="['/block', a.last.height]">{{ a.last.height | number }}</a>} @else {<span class="muted">–</span>}</ng-template>
              <ng-template cxCell="txs" let-a>{{ a.txs | number }}</ng-template>
            </app-chain-table>
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
  assetCols: CxColumn<AssetItem>[] = [
    { key: 'seq', label: '#', sort: true },
    { key: 'asset', label: 'Asset', sort: a => a.name ?? a.id },
    { key: 'supply', label: 'Supply', align: 'right', sort: true },
    { key: 'holders', label: 'Holders', align: 'right', sort: true },
    { key: 'price', label: 'Price', align: 'right', sort: true, nowrap: true },
    { key: 'registered', label: 'Registered', sort: a => a.registered?.height, hide: 'md' },
    { key: 'last', label: 'Last activity', sort: a => a.last?.height, hide: 'md' },
    { key: 'txs', label: 'Txs', align: 'right', sort: true },
  ];
  assetFilters: CxFilter<AssetItem>[] = [{ options: [{ label: 'priced', test: a => a.price !== null }, { label: 'no pool', test: a => a.price === null }] }];
  assetKey = (a: AssetItem) => a.id;
  assetMatches = matchAny<AssetItem>(a => a.id, a => a.name, a => a.controller);

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
}

/** /assets/:id: one BitAsset: supply, holders, price history, mints and activity */
@Component({
  selector: 'app-bitassets-asset',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.share-cell { display: flex; align-items: center; gap: 8px; min-width: 160px; .bar { flex: 1; } }`],
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
              <tr><th>Name</th><td>@if (a.name) {<b>{{ a.name }}</b><span class="muted ms-1">(hashes to the id)</span>} @else {<span class="muted">not revealed: the chain keeps the name's hash</span>}</td></tr>
              <tr><th>Sequence</th><td>{{ a.seq ?? '–' }}</td></tr>
              <tr><th>AssetId</th><td class="mono">{{ a.assetId }}</td></tr>
              <tr><th>Registered</th><td>@if (a.registered) {block <a [routerLink]="['/block', a.registered.height]">{{ a.registered.height | number }}</a>, tx <a [routerLink]="['/tx', a.registered.txid]" class="mono">{{ shortId(a.registered.txid) }}</a>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Controller</th><td>@if (a.controller) {<a [routerLink]="['/address', a.controller]" class="mono">{{ a.controller }}</a><span class="muted ms-1">(holds the control coin: can mint and update)</span>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Pools</th><td>@for (p of a.pools; track p) {<div><app-l2-asset [id]="p"></app-l2-asset></div>} @empty {<span class="muted">none</span>}</td></tr>
            </tbody></table>
          </div>
          <div class="box"><app-l2-value [value]="a.data"></app-l2-value></div>
        </div>

        @if (a.priceHistory.length) {
          <h2>Price</h2>
          <div class="chart-box"><app-l2-chart [series]="priceSeries(a)" kind="step" unit="sats" [zero]="false"></app-l2-chart></div>
        }

        <h2>Holders</h2>
        <div class="box">
          <app-chain-table [rows]="a.holderList" [columns]="holderCols" [search]="holderMatches" searchPlaceholder="Address…" sort="amount" empty="No holders.">
            <ng-template cxCell="address" let-h><a [routerLink]="['/address', h.address]" class="mono">{{ h.address }}</a></ng-template>
            <ng-template cxCell="amount" let-h>{{ h.amount | number }}</ng-template>
            <ng-template cxCell="share" let-h><div class="share-cell"><div class="bar"><div class="fill" [style.width.%]="(h.share ?? 0) * 100"></div></div><span class="muted small">{{ (h.share ?? 0) * 100 | number:'1.0-2' }}%</span></div></ng-template>
          </app-chain-table>
          @if (a.holders > a.holderList.length) {<div class="muted small mt-2">The top {{ a.holderList.length }} of {{ a.holders | number }}.</div>}
        </div>

        <h2>Activity</h2>
        <div class="box">
          <app-chain-table [rows]="a.activity" [columns]="activityCols" [filters]="chipsBy(a.activity, 'Kind', kindOf, kindLabel)" [search]="activityMatches"
              searchPlaceholder="Address, tx…" sort="height" empty="No activity in the index.">
            <ng-template cxCell="height" let-r><a [routerLink]="['/block', r.height]">{{ r.height | number }}</a></ng-template>
            <ng-template cxCell="time" let-r>@if (r.time) {<app-timestamp [unixTime]="r.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</ng-template>
            <ng-template cxCell="kind" let-r><span class="pill" [class.on]="r.kind !== 'transfer'">{{ kindLabel(r.kind) }}</span></ng-template>
            <ng-template cxCell="amount" let-r>{{ r.amount | number }}</ng-template>
            <ng-template cxCell="against" let-r>@if (r.counterAsset) {@if (r.counterAmount !== null) {<span class="me-1">{{ r.counterAmount | number }}</span>}<app-l2-asset [id]="r.counterAsset"></app-l2-asset>} @else {<span class="muted">–</span>}</ng-template>
            <ng-template cxCell="outputs" let-r><span class="small">@for (o of r.outputs; track $index) {<div><a [routerLink]="['/address', o.address]" class="mono">{{ shortId(o.address, 6) }}</a><span class="muted ms-1">{{ o.amount | number }}</span></div>}</span></ng-template>
            <ng-template cxCell="txid" let-r><a [routerLink]="['/tx', r.txid]" class="mono" [title]="r.txid">{{ shortId(r.txid) }}</a></ng-template>
          </app-chain-table>
          <div class="muted small mt-2">Outputs lists where the asset went, change included: the chain does not mark change.</div>
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
  chipsBy = chipsBy;
  kindOf = (r: AssetActivity) => r.kind;
  holderCols: CxColumn<AssetDetail['holderList'][number]>[] = [
    { key: 'address', label: 'Address' },
    { key: 'amount', label: 'Amount', align: 'right', sort: true },
    { key: 'share', label: 'Share', sort: true, hide: 'md' },
  ];
  holderMatches = matchAny<{ address: string }>(h => h.address);
  activityCols: CxColumn<AssetActivity>[] = [
    { key: 'height', label: 'Block', sort: true },
    { key: 'time', label: 'Time', sort: true, hide: 'md' },
    { key: 'kind', label: 'Kind', sort: true },
    { key: 'amount', label: 'Amount', align: 'right', sort: true },
    { key: 'against', label: 'Against', sort: r => r.counterAmount, hide: 'md' },
    { key: 'outputs', label: 'Outputs', sort: r => r.outputs.length, hide: 'lg' },
    { key: 'txid', label: 'Transaction' },
  ];
  activityMatches = matchAny<AssetActivity>(r => r.txid, r => r.kind, r => r.outputs.map(o => o.address).join(' '));

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
