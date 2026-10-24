import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, combineLatest, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2Address, L2Tx, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, humanize, shortId } from '@app/chain/l2/l2-common';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { L2AddressAssetsComponent, hasAssets } from '@app/chain/l2/features/asset-badge';
import { L2PositionsComponent } from '@app/chain/l2/features/market';

const PAGE = 25;

type Utxo = L2Address['utxos'][number];

/** /address/:address?before=<height>: balance, funded and spent, unconfirmed txs, market positions (Truthcoin), history with deltas, UTXOs */
@Component({
  selector: 'app-l2-address',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, L2AddressAssetsComponent, L2PositionsComponent],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <h1>Address</h1>
    <div class="sub"><span class="id">{{ address }}</span><app-clipboard class="ms-1" [text]="address"></app-clipboard></div>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Address" [id]="address" [height]="300"></app-l2-state>
      @if (v.data; as a) {
        <div class="kpis">
          <div class="kpi"><div class="l">Balance</div><div class="v"><app-l2-amount [sats]="a.balance"></app-l2-amount></div><div class="s">{{ a.utxos.length | number }} unspent outputs{{ a.utxos.length >= page ? ' (or more)' : '' }}</div></div>
          <div class="kpi"><div class="l">Received</div><div class="v"><app-l2-amount [sats]="a.funded.sum"></app-l2-amount></div><div class="s">{{ a.funded.count | number }} outputs</div></div>
          <div class="kpi"><div class="l">Sent</div><div class="v"><app-l2-amount [sats]="a.spent.sum"></app-l2-amount></div><div class="s">{{ a.spent.count | number }} outputs spent</div></div>
          @if (a.mempool?.txs?.length) {
            <div class="kpi"><div class="l">Unconfirmed</div><div class="v"><app-l2-amount [sats]="a.mempool.delta" [signed]="true"></app-l2-amount></div><div class="s">{{ a.mempool.txs.length | number }} txs in the mempool</div></div>
          }
        </div>

        @if (a.mempool?.txs?.length) {
          <h2>Unconfirmed</h2>
          <div class="box">
            <app-chain-table [rows]="a.mempool.txs" [columns]="mempoolCols" [search]="txMatches" searchPlaceholder="Transaction…" sort="delta" [pageSize]="10" empty="None.">
              <ng-template cxCell="txid" let-t><a [routerLink]="['/tx', t.txid]" class="mono" [title]="t.txid">{{ shortId(t.txid, 12) }}</a></ng-template>
              <ng-template cxCell="data" let-t>@if (t.data) {<span class="pill on">{{ t.data.type }}</span>} @else {<span class="muted">–</span>}</ng-template>
              <ng-template cxCell="fee" let-t><app-l2-amount [sats]="t.fee"></app-l2-amount></ng-template>
              <ng-template cxCell="delta" let-t><app-l2-amount [sats]="t.delta" [signed]="true"></app-l2-amount></ng-template>
            </app-chain-table>
            @if (hasMarketTx(a)) {<div class="note">A market tx counts its inputs only: what the market pays back shows once a block applies it.</div>}
          </div>
        }

        @if (markets$ | async) {
          <h2>Positions</h2>
          <div class="box"><app-l2-positions [address]="address"></app-l2-positions></div>
        }

        @if (hasAssets(a)) {
          <h2>Assets</h2>
          <div class="box"><app-l2-address-assets [utxos]="a.utxos"></app-l2-address-assets></div>
        }

        <h2>History</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Transaction</th><th>Block</th><th>Time</th><th class="text-end">Change</th></tr></thead>
            <tbody>
              @for (t of a.txs; track $index) {
                <tr>
                  <td><a [routerLink]="['/tx', t.txid]" class="mono" [title]="t.txid">{{ shortId(t.txid, 12) }}</a></td>
                  <td><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></td>
                  <td>@if (t.time) {<app-timestamp [unixTime]="t.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td class="text-end"><app-l2-amount [sats]="t.delta" [signed]="true"></app-l2-amount></td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="empty">No transactions{{ before !== null ? ' before this height' : '' }}.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          @if (before !== null) {<a class="btn btn-sm btn-secondary" [routerLink]="['/address', address]">Newest</a>}
          @if (a.txs.length === page) {
            <a class="btn btn-sm btn-secondary" [routerLink]="['/address', address]" [queryParams]="{ before: a.txs[a.txs.length - 1].height }">Older &rarr;</a>
          }
        </div>

        <h2>Unspent outputs</h2>
        <div class="box">
          <app-chain-table [rows]="a.utxos" [columns]="utxoCols" [filters]="utxoFilters(a)" [search]="utxoMatches" searchPlaceholder="Outpoint, asset…"
              sort="height" empty="No unspent outputs.">
            <ng-template cxCell="outpoint" let-u><app-l2-outpoint [op]="u.outpoint"></app-l2-outpoint></ng-template>
            <ng-template cxCell="height" let-u><a [routerLink]="['/block', u.height]">{{ u.height | number }}</a></ng-template>
            <ng-template cxCell="content" let-u><app-l2-content [c]="u.content" [value]="u.value"></app-l2-content></ng-template>
          </app-chain-table>
        </div>
      }
    }
  </div>`,
})
export class L2AddressPage implements OnInit {
  address = '';
  before: number | null = null;
  page = PAGE;
  view$: Observable<Loaded<L2Address>>;
  /** the chain has markets (Truthcoin): an address has positions */
  markets$: Observable<boolean>;
  shortId = shortId;
  mempoolCols: CxColumn<L2Tx & { delta: number }>[] = [
    { key: 'txid', label: 'Transaction' },
    { key: 'data', label: 'Data', sort: t => t.data?.type },
    { key: 'fee', label: 'Fee', align: 'right', sort: true },
    { key: 'delta', label: 'Change', align: 'right', sort: true },
  ];
  txMatches = (t: { txid: string }, q: string) => t.txid.toLowerCase().includes(q);
  utxoCols: CxColumn<Utxo>[] = [
    { key: 'outpoint', label: 'Outpoint' },
    { key: 'height', label: 'Block', sort: true },
    { key: 'content', label: 'Content', sort: u => u.value || u.content?.amount },
  ];
  utxoMatches = (u: Utxo, q: string) => [u.outpoint.txid, u.outpoint.label, u.content?.assetId, u.content?.name, u.content?.type]
    .some(x => String(x ?? '').toLowerCase().includes(q));
  private utxoFilterCache: { utxos: Utxo[]; filters: CxFilter<Utxo>[] } | null = null;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {
    this.markets$ = this.api.features$.pipe(map(f => f.includes('markets')));
  }

  hasMarketTx(a: L2Address): boolean {
    return !!a.mempool?.txs.some(t => !!t.market);
  }

  /** the address holds assets or names (BitAssets, BitNames): their balances show */
  hasAssets(a: L2Address): boolean {
    return hasAssets(a.utxos.map(u => u.content));
  }

  /** chips by what the outputs hold, when they hold more than one kind (cached: a new array would reset the table) */
  utxoFilters(a: L2Address): CxFilter<Utxo>[] {
    if (this.utxoFilterCache?.utxos !== a.utxos) {
      const types = [...new Set(a.utxos.map(u => u.content?.type ?? 'value'))];
      this.utxoFilterCache = { utxos: a.utxos, filters: types.length > 1 ? [{ options: types.map(t => ({ label: humanize(t), test: (u: Utxo) => (u.content?.type ?? 'value') === t })) }] : [] };
    }
    return this.utxoFilterCache.filters;
  }

  ngOnInit(): void {
    this.view$ = combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      map(([p, q]) => {
        const b = q.get('before');
        return { address: String(p.get('address') ?? ''), before: b !== null && /^\d+$/.test(b) ? Number(b) : null };
      }),
      tap(({ address, before }) => {
        this.address = address;
        this.before = before;
        this.seo.setTitle('Address ' + shortId(address));
      }),
      switchMap(({ address, before }) => loaded(this.api.address$(address, before, PAGE))),
    );
  }
}
