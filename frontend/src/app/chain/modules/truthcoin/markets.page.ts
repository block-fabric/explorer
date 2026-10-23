import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';

// GET /api/v1/l2/feature/markets[/:id] (chains/L2-API.md): the node's market_list / market_get with the index's trades
export interface Ref { height: number; time: number | null; txid: string }
export interface MarketItem {
  market_id: string;
  title: string;
  description: string;
  outcome_count: number;
  state: string;
  volume_sats: number;
  created_at_height: number;
  trades: number;
  lastTrade: Ref | null;
  created: Ref | null;
}
export interface MarketTrade extends Ref {
  outcome: number;
  shares: number;
  trader: string | null;
  limitSats: number;
  input: number;
  /** sats into the market (negative: a sell's proceeds); null: not known */
  cost: number | null;
  /** false: skipped by its block */
  applied: boolean;
  fee: number;
}
export interface MarketDetail extends MarketItem {
  tags: string[];
  creator_address: string;
  expires_at_height: number | null;
  dimensions: { dimension_index: number; decision_id: string; name: string; kind: any }[];
  outcomes: { outcome_index: number; label: string; price: number; volume_sats: number }[];
  beta: number;
  liquidity_base_sats: number;
  treasury_sats: number;
  total_volume_sats: number;
  trading_fee_rate: number;
  resolution: { winning_outcomes: { outcome_index: number; label: string; price: number }[]; summary: string } | null;
  priceHistory: { height: number; timestamp: number; prices: number[] }[];
  tradeList: MarketTrade[];
}

/** /markets: Truthcoin's prediction markets */
@Component({
  selector: 'app-truthcoin-markets',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.t { font-weight: 600; } .d { font-size: 0.78rem; color: var(--transparent-fg); max-width: 640px; }`],
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="markets"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no markets: this page belongs to the Truthcoin explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Markets" [height]="400"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Markets</div><div class="v">{{ d.items.length | number }}</div><div class="s">{{ count(d.items, 'trading') | number }} trading, {{ count(d.items, 'settled') | number }} settled</div></div>
            <div class="kpi"><div class="l">Volume</div><div class="v"><app-l2-amount [sats]="volume(d.items)"></app-l2-amount></div><div class="s">all markets</div></div>
            <div class="kpi"><div class="l">Trades</div><div class="v">{{ trades(d.items) | number }}</div><div class="s">Trade transactions in the index</div></div>
          </div>
          <div class="tabs">
            @for (s of states(d.items); track s) {<button [class.on]="state === s" (click)="state = s">{{ s }}</button>}
          </div>
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Market</th><th>State</th><th class="text-end">Outcomes</th><th class="text-end">Volume</th><th class="text-end">Trades</th><th>Created</th></tr></thead>
              <tbody>
                @for (m of shown(d.items); track m.market_id) {
                  <tr>
                    <td><a [routerLink]="['/markets', m.market_id]" class="t">{{ m.title }}</a><div class="d">{{ m.description }}</div></td>
                    <td><span class="status" [class.ok]="m.state === 'trading'">{{ m.state }}</span></td>
                    <td class="text-end">{{ m.outcome_count }}</td>
                    <td class="text-end"><app-l2-amount [sats]="m.volume_sats"></app-l2-amount></td>
                    <td class="text-end">{{ m.trades | number }}</td>
                    <td><a [routerLink]="['/block', m.created_at_height]">{{ m.created_at_height | number }}</a></td>
                  </tr>
                } @empty {<tr><td colspan="6" class="empty">No markets.</td></tr>}
              </tbody>
            </table>
          </div>
        }
      }
    }
  </div>`,
})
export class TruthcoinMarketsPage implements OnInit {
  view$: Observable<Loaded<{ items: MarketItem[] }> | 'unavailable'>;
  state = 'all';

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Markets');
    this.view$ = featureData$(this.api, 'markets', () => this.api.feature$('markets'));
  }

  states(items: MarketItem[]): string[] {
    return ['all', ...new Set(items.map(m => m.state))];
  }

  shown(items: MarketItem[]): MarketItem[] {
    const list = this.state === 'all' ? items : items.filter(m => m.state === this.state);
    return [...list].sort((a, b) => b.volume_sats - a.volume_sats || b.created_at_height - a.created_at_height);
  }

  count(items: MarketItem[], state: string): number {
    return items.filter(m => m.state === state).length;
  }

  volume(items: MarketItem[]): number {
    return items.reduce((s, m) => s + Number(m.volume_sats || 0), 0);
  }

  trades(items: MarketItem[]): number {
    return items.reduce((s, m) => s + m.trades, 0);
  }
}

/** /markets/:id: one market: outcomes and prices, price history, decisions, resolution, trades */
@Component({
  selector: 'app-truthcoin-market',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="markets" [id]="id" [title]="title"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Market" [id]="id" [height]="400"></app-l2-state>
      @if (v.data; as m) {
        <p>{{ m.description }}</p>
        <div class="kpis">
          <div class="kpi"><div class="l">State</div><div class="v">{{ m.state }}</div><div class="s">created in block {{ m.created_at_height | number }}</div></div>
          <div class="kpi"><div class="l">Volume</div><div class="v"><app-l2-amount [sats]="m.total_volume_sats"></app-l2-amount></div><div class="s">{{ m.trades | number }} trades in the index</div></div>
          <div class="kpi"><div class="l">Liquidity</div><div class="v"><app-l2-amount [sats]="m.liquidity_base_sats"></app-l2-amount></div><div class="s">treasury <app-l2-amount [sats]="m.treasury_sats"></app-l2-amount></div></div>
          <div class="kpi"><div class="l">Trading fee</div><div class="v">{{ m.trading_fee_rate * 100 | number:'1.0-3' }}%</div><div class="s">LMSR β {{ m.beta | number:'1.0-0' }}</div></div>
        </div>

        <h2>Outcomes</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Outcome</th><th>Price</th><th class="text-end">Volume</th>@if (m.resolution) {<th class="text-end">Paid</th>}</tr></thead>
            <tbody>
              @for (o of m.outcomes; track o.outcome_index) {
                <tr>
                  <td>{{ o.label }}</td>
                  <td style="min-width: 180px"><div class="bar"><div class="fill" [style.width.%]="o.price * 100"></div></div> <span class="small">{{ o.price * 100 | number:'1.1-1' }}%</span></td>
                  <td class="text-end"><app-l2-amount [sats]="o.volume_sats"></app-l2-amount></td>
                  @if (m.resolution) {<td class="text-end">{{ resolved(m, o.outcome_index) }}</td>}
                </tr>
              }
            </tbody>
          </table>
          @if (m.resolution?.summary) {<div class="muted small">{{ m.resolution!.summary }}</div>}
        </div>

        @if (m.priceHistory.length > 1) {
          <h2>Prices over time</h2>
          <div class="box"><app-l2-chart [series]="priceSeries(m)" [percent]="true" kind="step" [legend]="true"></app-l2-chart></div>
        }

        <div class="grid2">
          <div>
            <h2>Decisions</h2>
            <div class="box">
              <table class="table table-borderless table-sm">
                <tbody>
                  @for (d of m.dimensions; track d.dimension_index) {
                    <tr><td><a [routerLink]="['/decisions', d.decision_id]" class="mono">{{ d.decision_id }}</a></td><td>{{ d.name }}</td><td class="muted small">{{ d.kind?.type }}</td></tr>
                  } @empty {<tr><td class="empty">None.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h2>Details</h2>
            <div class="box">
              <table class="kv"><tbody>
                <tr><th>Market id</th><td class="mono">{{ m.market_id }}</td></tr>
                <tr><th>Creator</th><td><a [routerLink]="['/address', m.creator_address]" class="mono">{{ m.creator_address }}</a></td></tr>
                @if (m.created) {<tr><th>Created by</th><td><a [routerLink]="['/tx', m.created.txid]" class="mono">{{ shortId(m.created.txid) }}</a></td></tr>}
                <tr><th>Expires</th><td>{{ m.expires_at_height !== null ? (m.expires_at_height | number) : 'no expiry height' }}</td></tr>
                @if (m.tags.length) {<tr><th>Tags</th><td>@for (t of m.tags; track t) {<span class="pill me-1">{{ t }}</span>}</td></tr>}
              </tbody></table>
            </div>
          </div>
        </div>

        <h2>Trades</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Block</th><th>Time</th><th>Outcome</th><th class="text-end">Shares</th><th class="text-end">Limit</th><th class="text-end">Market</th><th>Trader</th><th>Transaction</th></tr></thead>
            <tbody>
              @for (t of m.tradeList; track t.txid) {
                <tr>
                  <td><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></td>
                  <td>@if (t.time) {<app-timestamp [unixTime]="t.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td class="small">{{ outcomeLabel(m, t.outcome) }}</td>
                  <td class="text-end" [class.pos]="t.shares > 0" [class.neg]="t.shares < 0">{{ t.shares > 0 ? 'buy ' : 'sell ' }}{{ abs(t.shares) | number }}</td>
                  <td class="text-end"><app-l2-amount [sats]="t.limitSats"></app-l2-amount></td>
                  <td class="text-end">@if (t.applied === false) {<span class="muted">skipped</span>} @else {<app-l2-amount [sats]="t.cost === null ? null : -t.cost" [signed]="true"></app-l2-amount>}</td>
                  <td>@if (t.trader) {<a [routerLink]="['/address', t.trader]" class="mono">{{ shortId(t.trader, 6) }}</a>}</td>
                  <td><a [routerLink]="['/tx', t.txid]" class="mono">{{ shortId(t.txid) }}</a></td>
                </tr>
              } @empty {<tr><td colspan="8" class="empty">No trades in the index.</td></tr>}
            </tbody>
          </table>
          <div class="muted small">Limit: the most a buy pays (with the 1,000 sat miner fee), the least a sell takes. Market: sats the trader paid into the market (−) or received from it (+); the rest of a trade's inputs comes back as change, less the miner fee.</div>
        </div>
      }
    }
  </div>`,
})
export class TruthcoinMarketPage implements OnInit {
  id = '';
  title: string | null = 'Market';
  view$: Observable<Loaded<MarketDetail>>;
  shortId = shortId;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.title = 'Market';
        this.seo.setTitle('Market ' + id);
      }),
      switchMap(id => featureData$(this.api, 'markets', () => this.api.feature$<MarketDetail>('markets', id).pipe(tap(m => {
        this.title = m.title;
        this.seo.setTitle(m.title);
      })))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }

  abs(n: number): number {
    return Math.abs(n);
  }

  outcomeLabel(m: MarketDetail, i: number): string {
    return m.outcomes.find(o => o.outcome_index === i)?.label ?? `#${i}`;
  }

  resolved(m: MarketDetail, i: number): string {
    const w = m.resolution?.winning_outcomes.find(o => o.outcome_index === i);
    return w ? (w.price * 100).toFixed(1) + '%' : '0%';
  }

  priceSeries(m: MarketDetail): ChartSeries[] {
    return m.outcomes.map((o, k) => ({
      name: o.label.length > 60 ? o.label.slice(0, 57) + '…' : o.label,
      points: m.priceHistory.filter(p => Number.isFinite(p.prices?.[k])).map(p => [p.height, p.prices[k]] as [number, number]),
    }));
  }
}
