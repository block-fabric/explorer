import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2Address, L2Content } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS } from '@app/chain/l2/l2-common';
import { L2AddressAssetsComponent, hasAssets } from '@app/chain/l2/features/asset-badge';

/**
 * The address page's sidechain panel (CHAIN_UI 'full'): the names and assets the address holds (BitNames,
 * BitAssets: their balances with ticker badges) and its unspent outputs that hold more than sats, from
 * GET /api/v1/l2/address/:address. Shows nothing for an address of plain sats.
 */
@Component({
  selector: 'app-l2-address-panel',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, L2AddressAssetsComponent],
  styleUrls: ['./l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
          <table class="table table-borderless table-sm p-table mb-0">
            <thead><tr><th>Outpoint</th><th>Block</th><th>Content</th></tr></thead>
            <tbody>
              @for (u of special(a); track $index) {
                <tr>
                  <td><app-l2-outpoint [op]="u.outpoint"></app-l2-outpoint></td>
                  <td><a [routerLink]="['/block' | relativeUrl, u.height]">{{ u.height | number }}</a></td>
                  <td><app-l2-content [c]="u.content" [value]="u.value"></app-l2-content></td>
                </tr>
              }
            </tbody>
          </table>
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
  view$: Observable<L2Address | null>;

  constructor(private api: L2ApiService) {}

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

  special(a: L2Address): { outpoint: any; content: L2Content; value: number; height: number }[] {
    return a.utxos.filter(u => u.content && u.content.type !== 'value');
  }
}
