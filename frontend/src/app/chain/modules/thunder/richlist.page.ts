import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';

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

/** /richlist: the addresses holding the most sats, and the payments over the chain's blocks */
@Component({
  selector: 'app-thunder-richlist',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
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
          <div class="box"><app-l2-chart [series]="txSeries(d)" kind="bar" [height]="140"></app-l2-chart></div>
          <div class="box"><app-l2-chart [series]="volumeSeries(d)" kind="bar" [height]="140" unit="sats"></app-l2-chart></div>

          <h2>Top addresses</h2>
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>#</th><th>Address</th><th class="text-end">Balance</th><th>Share</th><th class="text-end">Unspent</th><th class="text-end">Txs</th><th>Active</th></tr></thead>
              <tbody>
                @for (a of d.items; track a.address; let i = $index) {
                  <tr>
                    <td class="muted">{{ i + 1 }}</td>
                    <td><a [routerLink]="['/address', a.address]" class="mono">{{ a.address }}</a></td>
                    <td class="text-end"><app-l2-amount [sats]="a.balance"></app-l2-amount></td>
                    <td style="min-width: 140px"><div class="bar"><div class="fill" [style.width.%]="(a.share ?? 0) * 100"></div></div> <span class="muted small">{{ (a.share ?? 0) * 100 | number:'1.0-2' }}%</span></td>
                    <td class="text-end">{{ a.utxos | number }}</td>
                    <td class="text-end">{{ a.txs | number }}</td>
                    <td class="small">@if (a.first !== null) {<a [routerLink]="['/block', a.first]">{{ a.first | number }}</a> – <a [routerLink]="['/block', a.last]">{{ a.last | number }}</a>}</td>
                  </tr>
                } @empty {<tr><td colspan="7" class="empty">No funded addresses.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2>Largest payments</h2>
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Block</th><th>Time</th><th class="text-end">Paid</th><th class="text-end">Fee</th><th class="text-end">Inputs / outputs</th><th>Transaction</th></tr></thead>
              <tbody>
                @for (t of d.largest; track t.txid) {
                  <tr>
                    <td><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></td>
                    <td>@if (t.time) {<app-timestamp [unixTime]="t.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                    <td class="text-end"><app-l2-amount [sats]="t.amount"></app-l2-amount></td>
                    <td class="text-end"><app-l2-amount [sats]="t.fee"></app-l2-amount></td>
                    <td class="text-end">{{ t.inputs }} / {{ t.outputs }}</td>
                    <td><a [routerLink]="['/tx', t.txid]" class="mono" [title]="t.txid">{{ shortId(t.txid) }}</a></td>
                  </tr>
                } @empty {<tr><td colspan="6" class="empty">No payments yet.</td></tr>}
              </tbody>
            </table>
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

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Top addresses');
    this.view$ = featureData$(this.api, 'richlist', () => this.api.feature$<RichlistView>('richlist'));
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
