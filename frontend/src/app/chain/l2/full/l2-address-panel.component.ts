import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2Address } from '@app/chain/l2/l2.interfaces';
import { CxColumn } from '@app/chain/components/chain-table/chain-table.component';
import { L2_PAGE_IMPORTS } from '@app/chain/l2/l2-common';
import { L2AddressAssetsComponent, hasAssets } from '@app/chain/l2/features/asset-badge';
import { L2PositionsComponent } from '@app/chain/l2/features/market';

type Utxo = L2Address['utxos'][number];

/**
 * The address page's sidechain panel (CHAIN_UI 'full'): the names and assets the address holds (BitNames,
 * BitAssets: their balances with ticker badges) and its unspent outputs that hold more than sats, from
 * GET /api/v1/l2/address/:address; on a chain with markets (Truthcoin) its positions and Votecoin
 * (GET l2/address/:address/positions). Shows nothing for an address of plain sats elsewhere.
 */
@Component({
  selector: 'app-l2-address-panel',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, L2AddressAssetsComponent, L2PositionsComponent],
  styleUrls: ['./l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (markets$ | async) {
    <br>
    <div class="title-row"><h2 class="p-title">Positions</h2><span class="p-sub">its shares in {{ profile.name }}'s markets, and its Votecoin</span></div>
    <div class="box p-box"><app-l2-positions [address]="address"></app-l2-positions></div>
  }
  @if (view$ | async; as a) {
    <br>
    <div class="title-row"><h2 class="p-title">Names and assets</h2><span class="p-sub">held by this address on {{ profile.name }}</span></div>
    <div class="box p-box">
      @if (assets(a)) {
        <section><app-l2-address-assets [utxos]="a.utxos"></app-l2-address-assets></section>
      }
      @if (special(a).length) {
        <section>
          <h5 class="p-h5 mt-0">Unspent outputs holding more than sats</h5>
          <app-chain-table [rows]="special(a)" [columns]="utxoCols" [search]="utxoMatches" searchPlaceholder="Outpoint, asset, name…" sort="height" [pageSize]="10" empty="None.">
            <ng-template cxCell="outpoint" let-u><app-l2-outpoint [op]="u.outpoint"></app-l2-outpoint></ng-template>
            <ng-template cxCell="height" let-u><a [routerLink]="['/block' | relativeUrl, u.height]">{{ u.height | number }}</a></ng-template>
            <ng-template cxCell="content" let-u><app-l2-content [c]="u.content" [value]="u.value"></app-l2-content></ng-template>
          </app-chain-table>
          @if (a.utxos.length >= limit) {<div class="muted small mt-1">Among its first {{ limit }} unspent outputs.</div>}
        </section>
      }
    </div>
  }`,
})
export class L2AddressPanelComponent implements OnChanges {
  @Input() address: string;

  profile = PROFILE;
  limit = 100;
  utxoCols: CxColumn<Utxo>[] = [
    { key: 'outpoint', label: 'Outpoint' },
    { key: 'height', label: 'Block', sort: true },
    { key: 'content', label: 'Content', sort: u => u.content?.type },
  ];
  utxoMatches = (u: Utxo, q: string) => [u.outpoint.txid, u.outpoint.label, u.content?.assetId, u.content?.name, u.content?.type]
    .some(x => String(x ?? '').toLowerCase().includes(q));
  private specialOf: { utxos: Utxo[]; rows: Utxo[] } | null = null;
  view$: Observable<L2Address | null>;
  markets$: Observable<boolean>;

  constructor(private api: L2ApiService) {
    this.markets$ = this.api.features$.pipe(map(f => f.includes('markets')));
  }

  ngOnChanges(): void {
    if (!this.address) {
      return;
    }
    this.view$ = this.api.address$(this.address, null, this.limit).pipe(
      map(a => (a && (this.assets(a) || this.special(a).length)) ? a : null),
      catchError(() => of(null)),
    );
  }

  assets(a: L2Address): boolean {
    return hasAssets(a.utxos.map(u => u.content));
  }

  /** its outputs holding more than sats (kept: a new array would reset the table) */
  special(a: L2Address): Utxo[] {
    if (this.specialOf?.utxos !== a.utxos) {
      this.specialOf = { utxos: a.utxos, rows: a.utxos.filter(u => u.content && u.content.type !== 'value') };
    }
    return this.specialOf.rows;
  }
}
