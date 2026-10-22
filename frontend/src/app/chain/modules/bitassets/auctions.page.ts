import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';
import { Ref } from './assets.page';

// GET /api/v1/l2/feature/auctions[/:id] (chains/L2-API.md)
export interface AuctionItem {
  id: string;
  /** dutch_auctions' state, null when the node no longer lists it */
  state: any;
  status: 'upcoming' | 'live' | 'ended';
  /** quote units for all the base still offered, at the next block */
  currentPrice: number | null;
  remaining: number;
  startBlock: number;
  endBlock: number;
  baseAsset: string | null;
  quoteAsset: string | null;
  created: Ref | null;
  bids: number;
  collects: number;
}
export interface AuctionDetail extends AuctionItem {
  height: number;
  params: any;
  curve: [number, number][];
  bidList: (Ref & { quantity: number; bidSize: number; bidder: string | null })[];
  collectList: (Ref & { amountOfferedRemaining: number; amountReceived: number })[];
}

/** /auctions: the Dutch auctions with their status, price now and bids */
@Component({
  selector: 'app-bitassets-auctions',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="auctions"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no auctions: this page belongs to the BitAssets explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Auctions" [height]="300"></app-l2-state>
        @if (v.data; as d) {
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Auction</th><th>Offers</th><th>For</th><th>Status</th><th class="text-end">Price now</th><th>Blocks</th><th class="text-end">Bids</th></tr></thead>
              <tbody>
                @for (a of d.items; track a.id) {
                  <tr>
                    <td><a [routerLink]="['/auctions', a.id]" class="mono" [title]="a.id">{{ shortId(a.id) }}</a></td>
                    <td>{{ a.remaining | number }} <app-l2-asset [id]="a.baseAsset"></app-l2-asset></td>
                    <td><app-l2-asset [id]="a.quoteAsset"></app-l2-asset></td>
                    <td><span class="status" [class.ok]="a.status === 'live'" [class.wait]="a.status === 'upcoming'">{{ a.status }}</span></td>
                    <td class="text-end">@if (a.currentPrice !== null) {<span>{{ a.currentPrice | number }}</span>} @else {<span class="muted">–</span>}</td>
                    <td>{{ a.startBlock | number }} – {{ a.endBlock | number }}</td>
                    <td class="text-end">{{ a.bids | number }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">No Dutch auction on this sidechain yet.</td></tr>
                }
              </tbody>
            </table>
          </div>
          <p class="note">A Dutch auction offers an amount of its base asset for a price in its quote asset that falls block by block from
            its initial to its final price; each bid buys part of what is left and resets the fall (node state: dutch_auctions). Block {{ d.height | number }} is the tip.</p>
        }
      }
    }
  </div>`,
})
export class BitAssetsAuctionsPage implements OnInit {
  view$: Observable<Loaded<{ items: AuctionItem[]; height: number }> | 'unavailable'>;
  shortId = shortId;

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Dutch auctions');
    this.view$ = featureData$(this.api, 'assets', () => this.api.feature$('auctions'));
  }
}

/** /auctions/:id: one Dutch auction: parameters, price curve, bids and collects */
@Component({
  selector: 'app-bitassets-auction',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="auctions" [id]="id" title="Dutch auction"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Auction" [id]="id" [height]="400"></app-l2-state>
      @if (v.data; as a) {
        <div class="kpis">
          <div class="kpi"><div class="l">Status</div><div class="v">{{ a.status }}</div><div class="s">blocks {{ a.startBlock | number }} – {{ a.endBlock | number }}</div></div>
          <div class="kpi"><div class="l">Remaining</div><div class="v">{{ a.remaining | number }}</div><div class="s"><app-l2-asset [id]="a.baseAsset"></app-l2-asset></div></div>
          <div class="kpi"><div class="l">Price now</div><div class="v">@if (a.currentPrice !== null) {<span>{{ a.currentPrice | number }}</span>} @else {<span>–</span>}</div><div class="s"><app-l2-asset [id]="a.quoteAsset"></app-l2-asset> for all that remains</div></div>
          <div class="kpi"><div class="l">Bids</div><div class="v">{{ a.bids | number }}</div><div class="s">{{ a.collects | number }} collected</div></div>
        </div>
        <h2>Price curve</h2>
        <div class="box"><app-l2-chart [series]="curve(a)" [unit]="''" emptyText="No price curve."></app-l2-chart></div>
        <div class="grid2">
          <div>
            <h2>Parameters</h2>
            <div class="box"><app-l2-value [value]="a.params"></app-l2-value>
              @if (a.created) {<div class="small muted mt-1">Created in block <a [routerLink]="['/block', a.created.height]">{{ a.created.height | number }}</a>, tx <a [routerLink]="['/tx', a.created.txid]" class="mono">{{ shortId(a.created.txid) }}</a></div>}
            </div>
          </div>
          <div>
            <h2>Node state</h2>
            <div class="box"><app-l2-value [value]="a.state"></app-l2-value></div>
          </div>
        </div>
        <h2>Bids</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Block</th><th>Time</th><th>Bidder</th><th class="text-end">Bid</th><th class="text-end">Quantity</th><th>Transaction</th></tr></thead>
            <tbody>
              @for (b of a.bidList; track b.txid) {
                <tr>
                  <td><a [routerLink]="['/block', b.height]">{{ b.height | number }}</a></td>
                  <td>@if (b.time) {<app-timestamp [unixTime]="b.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td>@if (b.bidder) {<a [routerLink]="['/address', b.bidder]" class="mono">{{ shortId(b.bidder, 6) }}</a>} @else {<span class="muted">–</span>}</td>
                  <td class="text-end">{{ b.bidSize | number }}</td>
                  <td class="text-end">{{ b.quantity | number }}</td>
                  <td><a [routerLink]="['/tx', b.txid]" class="mono">{{ shortId(b.txid) }}</a></td>
                </tr>
              } @empty {<tr><td colspan="6" class="empty">No bids.</td></tr>}
            </tbody>
          </table>
        </div>
        @if (a.collectList.length) {
          <h2>Collected</h2>
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Block</th><th class="text-end">Offered, left</th><th class="text-end">Received</th><th>Transaction</th></tr></thead>
              <tbody>
                @for (c of a.collectList; track c.txid) {
                  <tr>
                    <td><a [routerLink]="['/block', c.height]">{{ c.height | number }}</a></td>
                    <td class="text-end">{{ c.amountOfferedRemaining | number }}</td>
                    <td class="text-end">{{ c.amountReceived | number }}</td>
                    <td><a [routerLink]="['/tx', c.txid]" class="mono">{{ shortId(c.txid) }}</a></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  </div>`,
})
export class BitAssetsAuctionPage implements OnInit {
  id = '';
  view$: Observable<Loaded<AuctionDetail>>;
  shortId = shortId;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('Auction ' + shortId(id));
      }),
      switchMap(id => featureData$(this.api, 'assets', () => this.api.feature$<AuctionDetail>('auctions', id))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }

  curve(a: AuctionDetail): ChartSeries[] {
    return [{ name: 'price for all that remains', points: a.curve }];
  }
}
