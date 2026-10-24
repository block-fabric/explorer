import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Observable, map } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';
import { CxColumn } from '@app/chain/components/chain-table/chain-table.component';

// GET /api/v1/l2/feature/richlist (chains/L2-API.md)
export interface RichlistView {
  items: { address: string; balance: number; share: number | null; utxos: number; txs: number; funded: { count: number; sum: number };
    spent: { count: number; sum: number }; first: number | null; last: number | null }[];
  addresses: number;
  funded: number;
  total: number;
  top10Share: number | null;
  payments: { count: number; volume: number; fees: number; averageFee: number | null };
  series: { from: number; to: number; time: number | null; txs: number; volume: number; fees: number }[];
  bucket: number;
  largest: { txid: string; height: number; time: number | null; amount: number; fee: number; inputs: number; outputs: number }[];
  height: number;
}

type Holder = RichlistView['items'][number] & { rank?: number };

/** /richlist: the addresses holding the most sats, and the payments over the chain's blocks */
@Component({
  selector: 'app-thunder-richlist',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.share-cell { display: flex; align-items: center; gap: 8px; min-width: 140px; .bar { flex: 1; } }`],
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="richlist"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This explorer has no top-addresses page.</div>
      } @else {
        <app-l2-state [state]="v" what="Top addresses" [height]="400"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Sats on the chain</div><div class="v"><app-l2-amount [sats]="d.total"></app-l2-amount></div><div class="s">in {{ d.funded | number }} of {{ d.addresses | number }} addresses</div></div>
            <div class="kpi"><div class="l">Top 10</div><div class="v">{{ (d.top10Share ?? 0) * 100 | number:'1.0-1' }}%</div><div class="s">of all sats</div></div>
            <div class="kpi"><div class="l">Payments</div><div class="v">{{ d.payments.count | number }}</div><div class="s">transactions</div></div>
            <div class="kpi"><div class="l">Paid</div><div class="v"><app-l2-amount [sats]="d.payments.volume"></app-l2-amount></div><div class="s">to others than the spenders</div></div>
            <div class="kpi"><div class="l">Fees</div><div class="v"><app-l2-amount [sats]="d.payments.fees"></app-l2-amount></div><div class="s">average <app-l2-amount [sats]="round(d.payments.averageFee)"></app-l2-amount></div></div>
          </div>

          <h2>Payments per {{ d.bucket | number }} blocks</h2>
          <div class="chart-box"><app-l2-chart [series]="txSeries(d)" kind="bar" [height]="140"></app-l2-chart></div>
          <div class="chart-box mt-2"><app-l2-chart [series]="volumeSeries(d)" kind="bar" [height]="140" unit="sats"></app-l2-chart></div>

          <h2>Top addresses</h2>
          <div class="box">
            <app-chain-table [rows]="d.items" [columns]="addressCols" [search]="addressMatches" searchPlaceholder="Address…" sort="balance"
                empty="No funded addresses." [trackBy]="addressKey">
              <ng-template cxCell="rank" let-a><span class="muted">{{ a.rank }}</span></ng-template>
              <ng-template cxCell="address" let-a><a [routerLink]="['/address', a.address]" class="mono">{{ a.address }}</a></ng-template>
              <ng-template cxCell="balance" let-a><app-l2-amount [sats]="a.balance"></app-l2-amount></ng-template>
              <ng-template cxCell="share" let-a><div class="share-cell"><div class="bar"><div class="fill" [style.width.%]="(a.share ?? 0) * 100"></div></div><span class="muted small">{{ (a.share ?? 0) * 100 | number:'1.0-2' }}%</span></div></ng-template>
              <ng-template cxCell="utxos" let-a>{{ a.utxos | number }}</ng-template>
              <ng-template cxCell="txs" let-a>{{ a.txs | number }}</ng-template>
              <ng-template cxCell="active" let-a><span class="small">@if (a.first !== null) {<a [routerLink]="['/block', a.first]">{{ a.first | number }}</a><span class="mx-1">–</span><a [routerLink]="['/block', a.last]">{{ a.last | number }}</a>}</span></ng-template>
            </app-chain-table>
          </div>

          <h2>Largest payments</h2>
          <div class="box">
            <app-chain-table [rows]="d.largest" [columns]="paymentCols" [search]="txMatches" searchPlaceholder="Transaction…" sort="amount" empty="No payments yet.">
              <ng-template cxCell="height" let-t><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></ng-template>
              <ng-template cxCell="time" let-t>@if (t.time) {<app-timestamp [unixTime]="t.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</ng-template>
              <ng-template cxCell="amount" let-t><app-l2-amount [sats]="t.amount"></app-l2-amount></ng-template>
              <ng-template cxCell="fee" let-t><app-l2-amount [sats]="t.fee"></app-l2-amount></ng-template>
              <ng-template cxCell="io" let-t>{{ t.inputs }} / {{ t.outputs }}</ng-template>
              <ng-template cxCell="txid" let-t><a [routerLink]="['/tx', t.txid]" class="mono" [title]="t.txid">{{ shortId(t.txid) }}</a></ng-template>
            </app-chain-table>
          </div>
          <p class="note">From the explorer's index at block {{ d.height | number }}. A payment's amount is what went to addresses other than
            the spenders' own; change sent to a new address counts as paid, as the chain cannot tell it apart.</p>
        }
      }
    }
  </div>`,
})
export class ThunderRichlistPage implements OnInit {
  view$: Observable<Loaded<RichlistView> | 'unavailable'>;
  shortId = shortId;
  addressCols: CxColumn<Holder>[] = [
    { key: 'rank', label: '#', sort: a => a.rank },
    { key: 'address', label: 'Address' },
    { key: 'balance', label: 'Balance', align: 'right', sort: true, nowrap: true },
    { key: 'share', label: 'Share', sort: true, hide: 'md' },
    { key: 'utxos', label: 'Unspent', align: 'right', sort: true, hide: 'md' },
    { key: 'txs', label: 'Txs', align: 'right', sort: true },
    { key: 'active', label: 'Active', sort: a => a.last, hide: 'lg', nowrap: true },
  ];
  addressMatches = (a: Holder, q: string) => a.address.toLowerCase().includes(q);
  addressKey = (a: Holder) => a.address;
  paymentCols: CxColumn<RichlistView['largest'][number]>[] = [
    { key: 'height', label: 'Block', sort: true },
    { key: 'time', label: 'Time', sort: true, hide: 'md' },
    { key: 'amount', label: 'Paid', align: 'right', sort: true, nowrap: true },
    { key: 'fee', label: 'Fee', align: 'right', sort: true },
    { key: 'io', label: 'Inputs / outputs', align: 'right', sort: t => t.inputs + t.outputs, hide: 'md' },
    { key: 'txid', label: 'Transaction' },
  ];
  txMatches = (t: { txid: string }, q: string) => t.txid.toLowerCase().includes(q);

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Top addresses');
    // each holder keeps its rank by balance, whatever the table's order
    this.view$ = featureData$(this.api, 'richlist', () => this.api.feature$<RichlistView>('richlist').pipe(
      map(d => ({ ...d, items: d.items.map((a, i) => ({ ...a, rank: i + 1 })) })),
    ));
  }

  round(n: number | null): number | null {
    return n === null ? null : Math.round(n);
  }

  txSeries(d: RichlistView): ChartSeries[] {
    return [{ name: 'payments', points: d.series.map(b => [b.from, b.txs] as [number, number]) }];
  }

  volumeSeries(d: RichlistView): ChartSeries[] {
    return [{ name: 'sats paid', color: '#5aa6ff', points: d.series.map(b => [b.from, b.volume] as [number, number]) }];
  }
}
