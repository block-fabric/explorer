import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, map, of, startWith, switchMap, takeWhile, timer } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2Block, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

/**
 * The block page's sidechain panel (CHAIN_UI 'full'), under upstream's block header: the eCash block that carried
 * this block by blind merged mining, the bid paid to its miner, the M8 request and the requests that competed for the
 * slot in that eCash block, the deposits credited when the block connected and the outputs withdrawn by bundles
 * (GET /api/v1/l2/block/:hash).
 */
@Component({
  selector: 'app-l2-block-panel',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['./l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (view$ | async; as v) {
    @if (v.data; as b) {
      <div class="title-row">
        <h2 class="p-title">Blind merged mining</h2>
        <span class="p-sub">the eCash block that carried {{ profile.name }} block {{ b.height | number }}</span>
      </div>
      <div class="box p-box">
        @if (b.bmm; as m) {
          <table class="table table-borderless table-striped mb-0">
            <tbody>
              <tr><td class="td-width">Carried by <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> block</td><td><app-l2-main-link kind="block" [id]="m.mainHash" [text]="(m.mainHeight | number) + ''"></app-l2-main-link><span class="muted">&nbsp;·&nbsp;</span><app-l2-main-link kind="block" [id]="m.mainHash" [short]="true"></app-l2-main-link></td></tr>
              <tr><td>Bid paid to its miner</td><td>@if (m.bid !== null) {<app-l2-amount [sats]="m.bid"></app-l2-amount>} @else {<span class="muted">none found</span>}</td></tr>
              <tr><td>BMM request (M8)</td><td>@if (m.requestTxid) {<app-l2-main-link kind="tx" [id]="m.requestTxid" [short]="true"></app-l2-main-link>} @else {<span class="muted">none found</span>}</td></tr>
              <tr><td>Competition</td><td>@if (m.contested) {<span class="pill warn">contested</span> {{ m.requests }} requests for the slot in that eCash block} @else {<span>{{ m.requests }} request for the slot in that eCash block, none competing</span>}</td></tr>
              @if (b.prevMainHash) {<tr><td>Previous eCash block</td><td><app-l2-main-link kind="block" [id]="b.prevMainHash" [short]="true"></app-l2-main-link>&nbsp;<span class="muted">(as the block header commits to it)</span></td></tr>}
            </tbody>
          </table>
          @if (m.requestList.length > 1) {
            <h5 class="p-h5">BMM requests for the slot in eCash block {{ m.mainHeight | number }}</h5>
            <table class="table table-borderless table-sm p-table mb-0">
              <thead><tr><th>Request (M8)</th><th>{{ profile.name }} block asked for</th><th class="text-end">Bid</th><th>Status</th></tr></thead>
              <tbody>
                @for (r of m.requestList; track r.txid) {
                  <tr>
                    <td><app-l2-main-link kind="tx" [id]="r.txid" [short]="true"></app-l2-main-link></td>
                    <td>@if (r.sideBlock === b.hash) {<span class="mono" [title]="r.sideBlock">this block</span>} @else {<span class="mono" [title]="r.sideBlock">{{ shortId(r.sideBlock) }}</span>}</td>
                    <td class="text-end"><app-l2-amount [sats]="r.bid"></app-l2-amount></td>
                    <td><span class="pill" [class.ok]="r.accepted">{{ r.accepted ? 'accepted' : 'beaten' }}</span></td>
                  </tr>
                }
              </tbody>
            </table>
          }
        } @else if (b.mainBlock; as mb) {
          <p class="muted mb-0">Carried by eCash block <app-l2-main-link kind="block" [id]="mb.hash" [text]="(mb.height | number) + ''"></app-l2-main-link> per the enforcer; the eCash explorer's drivechain index has no BMM accept for it (or this explorer does not read it).</p>
        } @else {
          <p class="muted mb-0">No eCash block has carried this block yet.</p>
        }
      </div>

      @if (b.deposits?.length) {
        <div class="title-row"><h2 class="p-title">Deposits credited</h2><span class="p-sub">{{ b.deposits.length }} from eCash, when this block connected</span></div>
        <div class="box p-box">
          <table class="table table-borderless table-sm p-table mb-0">
            <thead><tr><th>Outpoint</th><th><app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> deposit</th><th>To</th><th class="text-end">Amount</th><th class="d-none d-md-table-cell">Spent</th></tr></thead>
            <tbody>
              @for (x of b.deposits; track $index) {
                <tr>
                  <td><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></td>
                  <td><app-l2-main-link kind="tx" [id]="x.mainTxid" [short]="true"></app-l2-main-link></td>
                  <td class="addr">@if (x.burned) {<span class="pill">burned</span>} @else {<a [routerLink]="['/address' | relativeUrl, x.address]" class="mono">{{ x.address }}</a>}</td>
                  <td class="text-end"><app-l2-amount [sats]="x.amount"></app-l2-amount></td>
                  <td class="d-none d-md-table-cell"><app-l2-spent [spent]="x.spent"></app-l2-spent></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (b.bundleSpends?.length) {
        <div class="title-row"><h2 class="p-title">Withdrawn by bundles</h2><span class="p-sub">{{ b.bundleSpends.length }} outputs paid out on eCash</span></div>
        <div class="box p-box">
          <table class="table table-borderless table-sm p-table mb-0">
            <thead><tr><th>Outpoint</th><th>Bundle (M6 id)</th></tr></thead>
            <tbody>
              @for (x of b.bundleSpends; track $index) {
                <tr><td><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></td><td class="mono" [title]="x.m6id">{{ shortId(x.m6id, 12) }}</td></tr>
              }
            </tbody>
          </table>
        </div>
      }
      <br>
    } @else if (v.error && !v.loading) {
      <div class="title-row"><h2 class="p-title">Blind merged mining</h2></div>
      <div class="box p-box"><p class="muted mb-0">{{ v.error.building ? 'The sidechain index is still being built: the BMM of this block will show once it has caught up.' : 'The sidechain index has nothing on this block (' + v.error.message + ').' }}</p></div>
      <br>
    }
  }`,
})
export class L2BlockPanelComponent implements OnChanges {
  @Input() hash: string;
  @Input() height: number | null = null;

  profile = PROFILE;
  view$: Observable<Loaded<L2Block>>;
  shortId = shortId;

  constructor(private api: L2ApiService) {}

  ngOnChanges(): void {
    if (!this.hash) {
      return;
    }
    // a block can be shown before the index has it: ask again a few times
    let tries = 0;
    this.view$ = timer(0, 5000).pipe(
      switchMap(() => this.api.block$(this.hash).pipe(
        map(data => ({ loading: false, data }) as Loaded<L2Block>),
        catchError(e => of({ loading: false, error: l2Error(e) } as Loaded<L2Block>)),
      )),
      takeWhile(v => !!v.error && (v.error.status === 404 || v.error.building) && tries++ < 12, true),
      startWith({ loading: true } as Loaded<L2Block>),
    );
  }
}
