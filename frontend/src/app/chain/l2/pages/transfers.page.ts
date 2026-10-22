import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2Deposit, L2Withdrawal, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

const PAGE = 25;

/** /deposits and /withdrawals (route data kind), ?before=<height>: the peg's two directions, newest first */
@Component({
  selector: 'app-l2-transfers',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <h1><app-svg-images name="nav-drivechain" width="28" height="28" class="cmark"></app-svg-images> {{ kind === 'deposits' ? 'Deposits' : 'Withdrawals' }}</h1>
    <div class="sub">{{ kind === 'deposits'
      ? 'eCash sent into ' + profile.name + '\\'s escrow, credited on the sidechain when the next block connects'
      : 'Coins leaving ' + profile.name + ' for eCash: gathered in a withdrawal bundle, which eCash miners vote on before it is paid' }}</div>
    <div class="tabs">
      <a class="btn-tab" [class.on]="kind === 'deposits'" [routerLink]="['/deposits']">Deposits</a>
      <a class="btn-tab" [class.on]="kind === 'withdrawals'" [routerLink]="['/withdrawals']">Withdrawals</a>
    </div>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" [what]="kind === 'deposits' ? 'Deposits' : 'Withdrawals'" [height]="400"></app-l2-state>
      @if (v.data; as rows) {
        <div class="box">
          @if (kind === 'deposits') {
            <table class="table table-borderless table-sm">
              <thead><tr><th>Block</th><th>Time</th><th>eCash tx</th><th>Outpoint</th><th>To</th><th class="text-end">Amount</th><th>Spent</th></tr></thead>
              <tbody>
                @for (x of deposits(rows); track $index) {
                  <tr>
                    <td><a [routerLink]="['/block', x.hash]">{{ x.height | number }}</a></td>
                    <td>@if (x.time) {<app-timestamp [unixTime]="x.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                    <td><app-l2-main-link kind="tx" [id]="x.mainTxid" [short]="true"></app-l2-main-link></td>
                    <td><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></td>
                    <td>@if (x.burned) {<span class="pill" title="The deposit's destination could not be read: credited to the burn address">burned</span>} @else {<a [routerLink]="['/address', x.address]" class="mono">{{ x.address }}</a>}</td>
                    <td class="text-end"><app-l2-amount [sats]="x.amount"></app-l2-amount></td>
                    <td><app-l2-spent [spent]="x.spent"></app-l2-spent></td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">No deposits here.</td></tr>
                }
              </tbody>
            </table>
          } @else {
            <table class="table table-borderless table-sm">
              <thead><tr><th>Block</th><th>Time</th><th>Output</th><th>From</th><th>To (eCash)</th><th class="text-end">Amount</th><th class="text-end">eCash fee</th><th>Status</th><th>Bundle</th></tr></thead>
              <tbody>
                @for (w of withdrawals(rows); track $index) {
                  <tr>
                    <td><a [routerLink]="['/block', w.height]">{{ w.height | number }}</a></td>
                    <td>@if (w.time) {<app-timestamp [unixTime]="w.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                    <td><a [routerLink]="['/tx', w.txid]" class="mono" [title]="w.txid + ':' + w.vout">{{ shortId(w.txid) }}:{{ w.vout }}</a></td>
                    <td><a [routerLink]="['/address', w.address]" class="mono" [title]="w.address">{{ shortId(w.address, 6) }}</a></td>
                    <td><app-l2-main-link kind="address" [id]="w.mainAddress" [short]="true"></app-l2-main-link></td>
                    <td class="text-end"><app-l2-amount [sats]="w.amount"></app-l2-amount></td>
                    <td class="text-end"><app-l2-amount [sats]="w.mainFee"></app-l2-amount></td>
                    <td><span class="status" [ngClass]="w.status">{{ w.status }}</span></td>
                    <td>@if (w.m6id) {<span class="mono" [title]="w.m6id">{{ shortId(w.m6id) }}</span>} @else {<span class="muted">–</span>}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="9" class="empty">No withdrawals here.</td></tr>
                }
              </tbody>
            </table>
          }
        </div>
        <div class="pager">
          @if (before !== null) {<a class="btn btn-sm btn-secondary" [routerLink]="['/' + kind]">Newest</a>}
          @if (rows.length === page) {
            <a class="btn btn-sm btn-secondary" [routerLink]="['/' + kind]" [queryParams]="{ before: $any(rows[rows.length - 1]).height }">Older &rarr;</a>
          }
        </div>
      }
    }
  </div>`,
  styles: [`.tabs a.btn-tab { padding: 6px 12px; color: var(--transparent-fg); border-bottom: 2px solid transparent; text-decoration: none; }
    .tabs a.btn-tab.on { color: var(--fg); border-bottom-color: var(--chain-accent, var(--title-fg)); }`],
})
export class L2TransfersPage implements OnInit {
  profile = PROFILE;
  kind: 'deposits' | 'withdrawals' = 'deposits';
  before: number | null = null;
  page = PAGE;
  view$: Observable<Loaded<(L2Deposit | L2Withdrawal)[]>>;
  shortId = shortId;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.kind = this.route.snapshot.data['kind'] === 'withdrawals' ? 'withdrawals' : 'deposits';
    this.seo.setTitle(this.kind === 'deposits' ? 'Deposits' : 'Withdrawals');
    this.view$ = this.route.queryParamMap.pipe(
      map(q => {
        const b = q.get('before');
        this.before = b !== null && /^\d+$/.test(b) ? Number(b) : null;
        return this.before;
      }),
      switchMap(before => loaded<(L2Deposit | L2Withdrawal)[]>(this.kind === 'deposits'
        ? this.api.deposits$(before, PAGE) : this.api.withdrawals$(before, PAGE))),
    );
  }

  deposits(rows: any[]): L2Deposit[] {
    return rows as L2Deposit[];
  }

  withdrawals(rows: any[]): L2Withdrawal[] {
    return rows as L2Withdrawal[];
  }
}
