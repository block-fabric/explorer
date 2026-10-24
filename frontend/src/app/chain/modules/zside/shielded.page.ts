import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { ChartSeries, FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

// GET /api/v1/l2/feature/shielded (chains/L2-API.md)
export interface ShieldedView {
  txs: number;
  actions: number;
  shieldedIn: number;
  shieldedOut: number;
  valueBalance: number;
  nullifiers: number;
  commitments: number;
  /** sats in the pool: shielded in − out */
  pool: number;
  blocks: number;
  height: number;
  series: { height: number; time: number | null; txs: number; actions: number; shieldedIn: number; shieldedOut: number; pool: number }[];
  recent: { txid: string; height: number; time: number | null; actions: number; valueBalance: number; flags: number;
    transparentIn: number; transparentOut: number; fee: number; kind: 'shield' | 'unshield' | 'shielded' }[];
}

type ShieldedTx = ShieldedView['recent'][number];

/** /shielded: zSide's Orchard pool: its size over time, what went in and out, actions and nullifiers, the latest shielded txs */
@Component({
  selector: 'app-zside-shielded',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="shielded"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no shielded pool: this page belongs to the zSide explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Shielded pool" [height]="400"></app-l2-state>
        @if (v.data; as s) {
          <div class="kpis">
            <div class="kpi"><div class="l">In the pool</div><div class="v"><app-l2-amount [sats]="s.pool"></app-l2-amount></div><div class="s">shielded in − out</div></div>
            <div class="kpi"><div class="l">Shielded in</div><div class="v"><app-l2-amount [sats]="s.shieldedIn"></app-l2-amount></div><div class="s">from transparent outputs</div></div>
            <div class="kpi"><div class="l">Out of the pool</div><div class="v"><app-l2-amount [sats]="s.shieldedOut"></app-l2-amount></div><div class="s">unshielded, fees included</div></div>
            <div class="kpi"><div class="l">Shielded txs</div><div class="v">{{ s.txs | number }}</div><div class="s">in {{ s.blocks | number }} blocks</div></div>
            <div class="kpi"><div class="l">Actions</div><div class="v">{{ s.actions | number }}</div><div class="s">{{ s.nullifiers | number }} nullifiers, {{ s.commitments | number }} note commitments</div></div>
          </div>

          <h2>Pool size</h2>
          <div class="chart-box"><app-l2-chart [series]="poolSeries(s)" kind="step" emptyText="Fewer than two blocks with shielded activity."></app-l2-chart></div>
          <h2>Into and out of the pool, per block</h2>
          <div class="chart-box"><app-l2-chart [series]="flowSeries(s)" kind="bar" [legend]="true" emptyText="No shielded activity yet."></app-l2-chart></div>
          <h2>Actions per block</h2>
          <div class="chart-box"><app-l2-chart [series]="actionSeries(s)" kind="bar" [height]="120" emptyText="No shielded activity yet."></app-l2-chart></div>

          <h2>Latest shielded transactions</h2>
          <div class="box">
            <app-chain-table [rows]="s.recent" [columns]="recentCols" [filters]="kindFilters" [search]="txMatches" searchPlaceholder="Transaction…" sort="height"
                empty="No shielded transactions yet.">
              <ng-template cxCell="height" let-t><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></ng-template>
              <ng-template cxCell="time" let-t>@if (t.time) {<app-timestamp [unixTime]="t.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</ng-template>
              <ng-template cxCell="kind" let-t><span class="pill" [class.on]="t.kind !== 'shielded'">{{ kindName(t.kind) }}</span></ng-template>
              <ng-template cxCell="valueBalance" let-t><app-l2-amount [sats]="t.valueBalance" [signed]="true"></app-l2-amount></ng-template>
              <ng-template cxCell="transparent" let-t>{{ t.transparentIn }} / {{ t.transparentOut }}</ng-template>
              <ng-template cxCell="fee" let-t><app-l2-amount [sats]="t.fee"></app-l2-amount></ng-template>
              <ng-template cxCell="txid" let-t><a [routerLink]="['/tx', t.txid]" class="mono" [title]="t.txid">{{ shortId(t.txid) }}</a></ng-template>
            </app-chain-table>
          </div>
          <p class="note">An Orchard bundle's value balance is what it takes out of the pool (negative: what it puts in). Every action
            reveals a nullifier and adds a note commitment, padding actions included: actions do not count payments. Amounts and
            parties inside the pool are private; these figures come from the public bundles.</p>
        }
      }
    }
  </div>`,
})
export class ZsideShieldedPage implements OnInit {
  view$: Observable<Loaded<ShieldedView> | 'unavailable'>;
  shortId = shortId;
  recentCols: CxColumn<ShieldedTx>[] = [
    { key: 'height', label: 'Block', sort: true },
    { key: 'time', label: 'Time', sort: true, hide: 'md' },
    { key: 'kind', label: 'Kind', sort: true },
    { key: 'valueBalance', label: 'Value balance', align: 'right', sort: true, nowrap: true },
    { key: 'actions', label: 'Actions', align: 'right', sort: true },
    { key: 'transparent', label: 'Transparent in / out', align: 'right', sort: t => t.transparentIn + t.transparentOut, hide: 'md' },
    { key: 'fee', label: 'Fee', align: 'right', sort: true, hide: 'md' },
    { key: 'txid', label: 'Transaction' },
  ];
  kindFilters: CxFilter<ShieldedTx>[] = [{ options: (['shield', 'unshield', 'shielded'] as const).map(k => ({ label: this.kindName(k), test: t => t.kind === k })) }];
  txMatches = (t: ShieldedTx, q: string) => t.txid.toLowerCase().includes(q);

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Shielded pool');
    this.view$ = featureData$(this.api, 'shielded', () => this.api.feature$<ShieldedView>('shielded'));
  }

  kindName(k: ShieldedTx['kind']): string {
    return k === 'shield' ? 'shield' : k === 'unshield' ? 'unshield' : 'fully shielded';
  }

  poolSeries(s: ShieldedView): ChartSeries[] {
    const pts = s.series.map(b => [b.height, b.pool] as [number, number]);
    if (pts.length && s.height > pts[pts.length - 1][0]) {
      pts.push([s.height, pts[pts.length - 1][1]]);
    }
    return [{ name: 'sats in the pool', points: pts }];
  }

  flowSeries(s: ShieldedView): ChartSeries[] {
    return [
      { name: 'shielded in', color: '#3bd16f', points: s.series.map(b => [b.height, b.shieldedIn] as [number, number]) },
      { name: 'out of the pool', color: '#ff6b6b', points: s.series.map(b => [b.height, -b.shieldedOut] as [number, number]) },
    ];
  }

  actionSeries(s: ShieldedView): ChartSeries[] {
    return [{ name: 'actions', points: s.series.map(b => [b.height, b.actions] as [number, number]) }];
  }
}
