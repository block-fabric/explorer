import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2BlockSummary, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

const PAGE = 25;

/** /blocks?before=<height>: the sidechain's blocks, newest first, 25 a page */
@Component({
  selector: 'app-l2-blocks',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <h1><app-svg-images name="nav-cubes" width="28" height="28" class="cmark"></app-svg-images> Blocks</h1>
    <div class="sub">{{ profile.name }}'s blocks, newest first, with the eCash block whose miner committed each (BMM)</div>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Blocks" [height]="400"></app-l2-state>
      @if (v.data; as blocks) {
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Height</th><th>Hash</th><th>Time</th><th>eCash block (BMM)</th><th class="text-end">Txs</th><th class="text-end">Inputs</th><th class="text-end">Outputs</th><th class="text-end">Deposits</th><th class="text-end">Volume</th><th class="text-end">Fees</th></tr></thead>
            <tbody>
              @for (b of blocks; track b.hash) {
                <tr>
                  <td><a [routerLink]="['/block', b.hash]">{{ b.height | number }}</a></td>
                  <td><a [routerLink]="['/block', b.hash]" class="mono" [title]="b.hash">{{ shortId(b.hash) }}</a></td>
                  <td>@if (b.time) {<app-timestamp [unixTime]="b.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td>@if (b.mainBlock; as m) {<app-l2-main-link kind="block" [id]="m.hash" [text]="'' + m.height"></app-l2-main-link>} @else {<span class="muted">–</span>}</td>
                  <td class="text-end">{{ b.txCount }}</td>
                  <td class="text-end">{{ b.inputs }}</td>
                  <td class="text-end">{{ b.outputs }}</td>
                  <td class="text-end">{{ b.deposits }}</td>
                  <td class="text-end"><app-l2-amount [sats]="b.volume"></app-l2-amount></td>
                  <td class="text-end"><app-l2-amount [sats]="b.fees"></app-l2-amount></td>
                </tr>
              } @empty {
                <tr><td colspan="10" class="empty">No blocks here.</td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pager">
          @if (before !== null) {<a class="btn btn-sm btn-secondary" [routerLink]="['/blocks']">Newest</a>}
          @if (blocks.length === page && blocks[blocks.length - 1].height > 0) {
            <a class="btn btn-sm btn-secondary" [routerLink]="['/blocks']" [queryParams]="{ before: blocks[blocks.length - 1].height }">Older &rarr;</a>
          }
        </div>
      }
    }
  </div>`,
})
export class L2BlocksPage implements OnInit {
  profile = PROFILE;
  page = PAGE;
  before: number | null = null;
  view$: Observable<Loaded<L2BlockSummary[]>>;
  shortId = shortId;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Blocks');
    this.view$ = this.route.queryParamMap.pipe(
      map(q => {
        const b = q.get('before');
        this.before = b !== null && /^\d+$/.test(b) ? Number(b) : null;
        return this.before;
      }),
      switchMap(before => loaded(this.api.blocks$(before, PAGE))),
    );
  }
}
