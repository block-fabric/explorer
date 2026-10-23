import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FbLoaded, fbLoaded } from '../freebank-api.service';
import { FB_PAGE_IMPORTS } from '../freebank-kit';
import { FreebankBmmMark, FreebankLiveService } from '../freebank-live.service';
import * as F from '../freebank-format';

/**
 * The block page's FreeBank panel, under upstream's block header (GET /api/v1/freebank/blocks, from the 136-byte
 * header): the eCash block this block was blind merged mined in (its height and the bid when the eCash explorer's BMM
 * events have it) and the withdrawal bundle its header commits to.
 */
@Component({
  selector: 'app-freebank-block-panel',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: ['../../../l2/full/l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (view$ | async; as v) {
    @if (v.data?.mark; as b) {
      <div class="title-row">
        <h2 class="p-title">Blind merged mining</h2>
        <span class="p-sub">{{ profile.name }} blocks have no proof of work: an eCash miner commits to each one (BIP301)</span>
        @if (!b.onChain) {<span class="pill warn">not on the active chain</span>}
      </div>
      <div class="box p-box">
        <table class="table table-borderless table-striped mb-0"><tbody>
          <tr><td class="td-width">Mined in</td><td>
            @if (b.mainblock) {
              <app-fb-ecash kind="block" [id]="b.mainblock" [text]="v.data.mainHeight !== null ? 'eCash block ' + (v.data.mainHeight | number) : b.mainblock" [mono]="v.data.mainHeight === null"></app-fb-ecash>
              @if (v.data.bid !== null) {<span class="muted"> · bid {{ v.data.bid | number }} sats paid to its miner</span>}
            } @else {<span class="muted">no eCash block named in the header</span>}
          </td></tr>
          @if (b.mainblock && v.data.mainHeight !== null) {<tr><td>eCash block hash</td><td class="mono">{{ b.mainblock }}</td></tr>}
          <tr><td>Withdrawal bundle</td><td>@if (b.withdrawalbundle) {<span class="mono">{{ b.withdrawalbundle }}</span> · <a routerLink="/peg">the peg</a>} @else {<span class="muted">none committed</span>}</td></tr>
        </tbody></table>
      </div>
      <br>
    } @else if (v.error && !v.loading) {
      <div class="title-row"><h2 class="p-title">Blind merged mining</h2></div>
      <div class="box p-box"><p class="muted mb-0">The BMM fields of this block are not available ({{ v.error.message }}).</p></div>
      <br>
    }
  }`,
})
export class FreebankBlockPanelComponent implements OnChanges {
  @Input() hash: string;
  @Input() height: number | null = null;
  profile = PROFILE;
  fx = F;
  view$: Observable<FbLoaded<FreebankBmmMark>>;

  constructor(private live: FreebankLiveService) {}

  ngOnChanges(): void {
    if (this.hash) {
      this.view$ = fbLoaded(this.live.bmm$(this.hash));
    }
  }
}
