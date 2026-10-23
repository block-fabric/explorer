import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, startWith, switchMap, takeWhile, timer } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FlushApiService, FlushLoaded, flushResult } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { FlushBlockMark } from '../flush-live.service';
import * as F from '../flush-format';

/**
 * The block page's Flush panel, under upstream's block header (GET /api/v1/flush/block/:hash): a block of stake (its
 * slot and the validator that signed it) or a BMM block (the eCash block that committed to it), its finality (soft,
 * anchored, final: the anchors that cover it), the anchor a block of stake acknowledges (the ticket and the eCash block
 * of its commitment), and the evidence of double signing it carries.
 */
@Component({
  selector: 'app-flush-block-panel',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: ['../../../l2/full/l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (view$ | async; as v) {
    @if (v.data; as b) {
      <div class="title-row">
        <h2 class="p-title">{{ b.kind === 'pos' ? 'Block of stake' : b.kind === 'bmm' ? 'BMM block' : profile.name }}</h2>
        <span class="p-sub">{{ b.kind === 'pos' ? 'signed by the leader of its slot' : 'merged mined on eCash, an anchor of the chain' }}</span>
        @if (b.finality; as f) {<span class="pill" [class.ok]="f.status === 'final'" [class.accent]="f.status === 'anchored'">{{ f.status }}</span>}
      </div>
      <div class="box p-box">
        <table class="table table-borderless table-striped mb-0"><tbody>
          @if (b.kind === 'pos') {
            <tr><td class="td-width">Slot</td><td>{{ b.slot | number }}</td></tr>
            <tr><td>Proposer</td><td>@if (b.proposer) {<a [routerLink]="['/validator', b.proposer]" class="mono">{{ b.proposer }}</a>} @else {<span class="muted">not known</span>}</td></tr>
          }
          @if (b.mainheight !== null && b.mainheight !== undefined && b.kind === 'bmm') {
            <tr><td class="td-width">Committed to by</td><td><app-flush-ecash kind="block" [id]="b.mainheight" [text]="'eCash block ' + (b.mainheight | number)"></app-flush-ecash></td></tr>
          }
          <tr><td class="td-width">Finality</td><td>
            @if (b.finality; as f) {
              @switch (f.status) {
                @case ('final') {<span>final: {{ f.anchors }} anchor{{ f.anchors === 1 ? '' : 's' }} cover it, undoing it would take eCash's miners that many anchors</span>}
                @case ('anchored') {<span>anchored: {{ f.anchors }} anchor{{ f.anchors === 1 ? '' : 's' }} cover it (undoing it takes eCash's merged miners, not stake)</span>}
                @default {<span>soft: no anchor covers it yet, only blocks of stake are on it</span>}
              }
            } @else {<span class="muted">not on the active chain</span>}
          </td></tr>
          @if (b.ack; as a) {
            <tr><td>Acknowledges</td><td>the anchor of block <a [routerLink]="['/block', a.anchored]" class="mono">{{ fx.shortId(a.anchored) }}</a>, committed to at
              <app-flush-ecash kind="block" [id]="a.mainheight" [text]="'eCash block ' + (a.mainheight | number)"></app-flush-ecash></td></tr>
            <tr><td>Ticket (h*)</td><td class="mono">{{ a.ticket }}</td></tr>
            <tr><td>Pot paid to</td><td class="mono">{{ a.payee }}</td></tr>
          }
        </tbody></table>
        @if (b.evidence?.length) {
          <h5 class="p-h5">Evidence: leaders that signed two blocks for a slot</h5>
          <table class="table table-borderless table-sm p-table mb-0"><thead><tr><th>Slot</th><th>The two blocks</th></tr></thead><tbody>
            @for (e of b.evidence; track $index) {<tr><td>{{ e.slot | number }}</td><td>@for (h of e.hashes; track h) {<a [routerLink]="['/block', h]" class="mono me-2">{{ fx.shortId(h) }}</a>}</td></tr>}
          </tbody></table>
        }
      </div>
      <br>
    } @else if (v.error && !v.loading) {
      <div class="title-row"><h2 class="p-title">{{ profile.name }}</h2></div>
      <div class="box p-box"><p class="muted mb-0">The stake fields of this block are not available ({{ v.error.message }}).</p></div>
      <br>
    }
  }`,
})
export class FlushBlockPanelComponent implements OnChanges {
  @Input() hash: string;
  @Input() height: number | null = null;
  profile = PROFILE;
  fx = F;
  view$: Observable<FlushLoaded<FlushBlockMark>>;

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    if (!this.hash) {
      return;
    }
    // a block just made is soft: its finality is asked again until it is final (every 30 s, for 15 minutes)
    let n = 0;
    this.view$ = timer(0, 30000).pipe(
      switchMap(() => flushResult(this.api.block$<FlushBlockMark>(this.hash))),
      takeWhile(v => v.loading || (!!v.data && v.data.finality?.status !== 'final' && n++ < 60), true),
      startWith({ loading: true } as FlushLoaded<FlushBlockMark>),
    );
  }
}
