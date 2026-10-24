import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { FEATURE_PAGE_IMPORTS, chipsBy, featureData$, matchAny } from '@app/chain/l2/features/feature-kit';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

// GET /api/v1/l2/feature/swaps[/:id] (chains/L2-API.md): the node's list_swaps / get_swap_status, ids as hex
export interface SwapItem {
  id: string;
  direction: string;
  parent_chain: string;
  /** the L1 payment's txid as this node has seen it, null for none */
  l1_txid: string | null;
  required_confirmations: number;
  state: any;
  l2_recipient: string | null;
  l2_amount: number;
  l1_recipient_address: string | null;
  l1_amount: number;
  l1_claimer_address: string | null;
  l2_claimer_address: string | null;
  created_at_height: number;
  expires_at_height: number | null;
  l1_txid_validated_at_height: number | null;
  l2_creator_address: string | null;
  txs: { kind: 'create' | 'accept' | 'claim'; txid: string; height: number; time: number | null }[];
  locked: { amount: number; outputs: number } | null;
}

/** A swap's state: "Pending", or {"WaitingConfirmations": [n, m]} and the like */
export function swapState(s: any): string {
  if (typeof s === 'string') {
    return s;
  }
  if (s && typeof s === 'object') {
    const k = Object.keys(s)[0];
    const v = s[k];
    return Array.isArray(v) ? `${k} ${v.join(' / ')}` : v !== null && typeof v !== 'object' ? `${k} ${v}` : k;
  }
  return '–';
}

/** /swaps: the swaps this node knows */
@Component({
  selector: 'app-coinshift-swaps',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="swaps"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no swaps: this page belongs to the Coinshift explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Swaps" [height]="300"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Swaps</div><div class="v">{{ d.items.length | number }}</div><div class="s">known to this node</div></div>
            <div class="kpi"><div class="l">L2 amount</div><div class="v"><app-l2-amount [sats]="sum(d.items, 'l2_amount')"></app-l2-amount></div><div class="s">offered on Coinshift</div></div>
            <div class="kpi"><div class="l">Held for swaps</div><div class="v"><app-l2-amount [sats]="locked(d.items)"></app-l2-amount></div><div class="s">in SwapPending outputs</div></div>
          </div>
          <div class="box">
            <app-chain-table [rows]="d.items" [columns]="swapCols" [filters]="swapFilters(d.items)" [search]="swapMatches" searchPlaceholder="Swap, address, txid…"
                sort="created" empty="No swaps." [trackBy]="swapKey">
              <ng-template cxCell="id" let-s><a [routerLink]="['/swaps', s.id]" class="mono" [title]="s.id">{{ shortId(s.id) }}</a></ng-template>
              <ng-template cxCell="direction" let-s><span>{{ s.direction }}</span><span class="muted small ms-1">{{ s.parent_chain }}</span></ng-template>
              <ng-template cxCell="state" let-s><span class="status" [class.ok]="swapState(s.state) === 'Completed'" [class.wait]="swapState(s.state) === 'Pending'">{{ swapState(s.state) }}</span></ng-template>
              <ng-template cxCell="l2" let-s><app-l2-amount [sats]="s.l2_amount"></app-l2-amount></ng-template>
              <ng-template cxCell="l1" let-s><span>{{ s.l1_amount | number }}</span><span class="muted small ms-1">{{ s.parent_chain }} sats</span></ng-template>
              <ng-template cxCell="l1r" let-s><span class="mono small">{{ s.l1_recipient_address ?? '–' }}</span></ng-template>
              <ng-template cxCell="created" let-s><a [routerLink]="['/block', s.created_at_height]">{{ s.created_at_height | number }}</a></ng-template>
              <ng-template cxCell="expires" let-s>{{ s.expires_at_height !== null ? (s.expires_at_height | number) : '–' }}</ng-template>
            </app-chain-table>
          </div>
        }
      }
    }
  </div>`,
})
export class CoinshiftSwapsPage implements OnInit {
  view$: Observable<Loaded<{ items: SwapItem[]; note: string }> | 'unavailable'>;
  shortId = shortId;
  swapState = swapState;
  swapCols: CxColumn<SwapItem>[] = [
    { key: 'id', label: 'Swap' },
    { key: 'direction', label: 'Direction', sort: true },
    { key: 'state', label: 'State', sort: s => swapState(s.state) },
    { key: 'l2', label: 'L2 amount', align: 'right', sort: s => s.l2_amount, nowrap: true },
    { key: 'l1', label: 'L1 amount', align: 'right', sort: s => s.l1_amount, nowrap: true },
    { key: 'l1r', label: 'L1 recipient', hide: 'lg' },
    { key: 'created', label: 'Created', sort: s => s.created_at_height },
    { key: 'expires', label: 'Expires', sort: s => s.expires_at_height, hide: 'md' },
  ];
  swapKey = (s: SwapItem) => s.id;
  swapMatches = matchAny<SwapItem>(s => s.id, s => s.l1_recipient_address, s => s.l2_recipient, s => s.l2_creator_address, s => s.l1_txid);

  private filtersOf: { items: SwapItem[]; filters: CxFilter<SwapItem>[] } | null = null;

  /** chips by state and by parent chain (kept per list: a new array would reset the table) */
  swapFilters(items: SwapItem[]): CxFilter<SwapItem>[] {
    if (this.filtersOf?.items !== items) {
      this.filtersOf = { items, filters: [...chipsBy(items, 'State', s => swapState(s.state).split(' ')[0]), ...chipsBy(items, 'Chain', s => s.parent_chain)] };
    }
    return this.filtersOf.filters;
  }

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Swaps');
    this.view$ = featureData$(this.api, 'swaps', () => this.api.feature$('swaps'));
  }

  sum(items: SwapItem[], k: 'l2_amount' | 'l1_amount'): number {
    return items.reduce((s, x) => s + Number(x[k] || 0), 0);
  }

  locked(items: SwapItem[]): number {
    return items.reduce((s, x) => s + (x.locked?.amount ?? 0), 0);
  }
}

/** /swaps/:id: one swap: both sides, its state as this node sees it, its transactions on Coinshift */
@Component({
  selector: 'app-coinshift-swap',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="swaps" [id]="id" title="Swap"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Swap" [id]="id" [height]="300"></app-l2-state>
      @if (v.data; as s) {
        @if (!s.known) {<div class="alert alert-warning">This node does not know the swap's state; only its transactions in the index show.</div>}
        <div class="kpis">
          <div class="kpi"><div class="l">State</div><div class="v">{{ swapState(s.state) }}</div><div class="s">as this node sees it</div></div>
          <div class="kpi"><div class="l">L2 amount</div><div class="v"><app-l2-amount [sats]="s.l2_amount"></app-l2-amount></div><div class="s">on Coinshift</div></div>
          <div class="kpi"><div class="l">L1 amount</div><div class="v">{{ s.l1_amount | number }}</div><div class="s">{{ s.parent_chain }} sats</div></div>
          <div class="kpi"><div class="l">Confirmations</div><div class="v">{{ s.required_confirmations ?? '–' }}</div><div class="s">required on {{ s.parent_chain }}</div></div>
        </div>
        <div class="grid2">
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Direction</th><td>{{ s.direction }}</td></tr>
              <tr><th>Created</th><td>@if (s.created_at_height !== undefined) {block <a [routerLink]="['/block', s.created_at_height]">{{ s.created_at_height | number }}</a>}</td></tr>
              <tr><th>Expires</th><td>{{ s.expires_at_height !== null && s.expires_at_height !== undefined ? 'block ' + (s.expires_at_height | number) : '–' }}</td></tr>
              <tr><th>L2 creator</th><td>@if (s.l2_creator_address) {<a [routerLink]="['/address', s.l2_creator_address]" class="mono">{{ s.l2_creator_address }}</a>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>L2 recipient</th><td>@if (s.l2_recipient) {<a [routerLink]="['/address', s.l2_recipient]" class="mono">{{ s.l2_recipient }}</a>} @else {<span class="muted">open to anyone</span>}</td></tr>
              <tr><th>L2 claimer</th><td>@if (s.l2_claimer_address) {<a [routerLink]="['/address', s.l2_claimer_address]" class="mono">{{ s.l2_claimer_address }}</a>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Held</th><td>@if (s.locked) {<app-l2-amount [sats]="s.locked.amount"></app-l2-amount> in {{ s.locked.outputs }} SwapPending output(s)} @else {<span class="muted">nothing held</span>}</td></tr>
            </tbody></table>
          </div>
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Parent chain</th><td>{{ s.parent_chain }}</td></tr>
              <tr><th>L1 recipient</th><td class="mono">{{ s.l1_recipient_address ?? '–' }}</td></tr>
              <tr><th>L1 payment</th><td class="mono">{{ s.l1_txid ?? 'none seen by this node' }}</td></tr>
              <tr><th>Validated at</th><td>{{ s.l1_txid_validated_at_height ?? '–' }}</td></tr>
              <tr><th>L1 claimer</th><td class="mono">{{ s.l1_claimer_address ?? '–' }}</td></tr>
            </tbody></table>
          </div>
        </div>
        <h2>Transactions on Coinshift</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Block</th><th>Time</th><th>Step</th><th>Transaction</th></tr></thead>
            <tbody>
              @for (t of s.txs; track t.txid) {
                <tr>
                  <td><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></td>
                  <td>@if (t.time) {<app-timestamp [unixTime]="t.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td><span class="pill on">{{ t.kind }}</span></td>
                  <td><a [routerLink]="['/tx', t.txid]" class="mono">{{ t.txid }}</a></td>
                </tr>
              } @empty {<tr><td colspan="4" class="empty">No swap transactions in the index.</td></tr>}
            </tbody>
          </table>
        </div>
      }
    }
  </div>`,
})
export class CoinshiftSwapPage implements OnInit {
  id = '';
  view$: Observable<Loaded<SwapItem & { known: boolean; note: string }>>;
  swapState = swapState;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('Swap ' + shortId(id));
      }),
      switchMap(id => featureData$(this.api, 'swaps', () => this.api.feature$<SwapItem & { known: boolean; note: string }>('swaps', id))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }
}
