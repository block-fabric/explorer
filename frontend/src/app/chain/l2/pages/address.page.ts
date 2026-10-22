import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, combineLatest, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2Address, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

const PAGE = 25;

/** /address/:address?before=<height>: balance, funded and spent, history with deltas, UTXOs */
@Component({
  selector: 'app-l2-address',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <h1>Address</h1>
    <div class="sub"><span class="id">{{ address }}</span> <app-clipboard [text]="address"></app-clipboard></div>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Address" [id]="address" [height]="300"></app-l2-state>
      @if (v.data; as a) {
        <div class="kpis">
          <div class="kpi"><div class="l">Balance</div><div class="v"><app-l2-amount [sats]="a.balance"></app-l2-amount></div><div class="s">{{ a.utxos.length | number }} unspent outputs{{ a.utxos.length >= page ? ' (or more)' : '' }}</div></div>
          <div class="kpi"><div class="l">Received</div><div class="v"><app-l2-amount [sats]="a.funded.sum"></app-l2-amount></div><div class="s">{{ a.funded.count | number }} outputs</div></div>
          <div class="kpi"><div class="l">Sent</div><div class="v"><app-l2-amount [sats]="a.spent.sum"></app-l2-amount></div><div class="s">{{ a.spent.count | number }} outputs spent</div></div>
        </div>

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
          <table class="table table-borderless table-sm">
            <thead><tr><th>Outpoint</th><th>Block</th><th>Content</th></tr></thead>
            <tbody>
              @for (u of a.utxos; track $index) {
                <tr>
                  <td><app-l2-outpoint [op]="u.outpoint"></app-l2-outpoint></td>
                  <td><a [routerLink]="['/block', u.height]">{{ u.height | number }}</a></td>
                  <td><app-l2-content [c]="u.content" [value]="u.value"></app-l2-content></td>
                </tr>
              } @empty {
                <tr><td colspan="3" class="empty">No unspent outputs.</td></tr>
              }
            </tbody>
          </table>
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
  shortId = shortId;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

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
