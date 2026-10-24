import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2Block, L2BmmRequest, L2Deposit, L2OutPoint, Loaded } from '@app/chain/l2/l2.interfaces';
import { CxColumn } from '@app/chain/components/chain-table/chain-table.component';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

/** /block/:id (hash or height): the header, its eCash carrier block and BMM (bid, M8 request, competing requests), coinbase, transactions, deposits and bundle spends */
@Component({
  selector: 'app-l2-block',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    @if (view$ | async; as v) {
      <div class="head">
        <h1><app-svg-images name="nav-cubes" width="28" height="28" class="cmark"></app-svg-images> Block {{ v.data ? (v.data.height | number) : '' }}</h1>
        @if (v.data; as b) {
          <div class="nav-btns">
            @if (b.prevHash) {<a class="btn btn-sm btn-secondary" [routerLink]="['/block', b.prevHash]" title="Previous block">&larr; {{ b.height - 1 | number }}</a>}
            @if (b.nextHash) {<a class="btn btn-sm btn-secondary" [routerLink]="['/block', b.nextHash]" title="Next block">{{ b.height + 1 | number }} &rarr;</a>}
          </div>
        }
      </div>
      <app-l2-state [state]="v" what="Block" [id]="id" [height]="400"></app-l2-state>
      @if (v.data; as b) {
        <div class="sub"><span class="id">{{ b.hash }}</span><app-clipboard class="ms-1" [text]="b.hash"></app-clipboard></div>
        <div class="grid2">
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Height</th><td>{{ b.height | number }}</td></tr>
              <tr><th>Time</th><td>@if (b.time) {<app-timestamp [unixTime]="b.time"></app-timestamp>} @else {<span class="muted">unknown (no BMM block yet)</span>}</td></tr>
              <tr><th>Previous block</th><td>@if (b.prevHash) {<a [routerLink]="['/block', b.prevHash]" class="mono">{{ b.prevHash }}</a>} @else {<span class="muted">none (genesis)</span>}</td></tr>
              <tr><th>Next block</th><td>@if (b.nextHash) {<a [routerLink]="['/block', b.nextHash]" class="mono">{{ b.nextHash }}</a>} @else {<span class="muted">none yet</span>}</td></tr>
              <tr><th>Merkle root</th><td class="mono">{{ b.merkleRoot }}</td></tr>
            </tbody></table>
          </div>
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>eCash block (BMM)</th><td>@if (b.mainBlock; as m) {<app-l2-main-link kind="block" [id]="m.hash" [text]="(m.height | number) + ''"></app-l2-main-link><app-l2-main-link class="ms-2" kind="block" [id]="m.hash" [short]="true"></app-l2-main-link>} @else {<span class="muted">not known yet</span>}</td></tr>
              <tr><th>Previous eCash block</th><td>@if (b.prevMainHash) {<app-l2-main-link kind="block" [id]="b.prevMainHash"></app-l2-main-link>}</td></tr>
              <tr><th>Transactions</th><td>{{ b.txCount | number }} · {{ b.inputs | number }} inputs · {{ b.outputs | number }} outputs</td></tr>
              <tr><th>Volume</th><td><app-l2-amount [sats]="b.volume"></app-l2-amount></td></tr>
              <tr><th>Fees</th><td><app-l2-amount [sats]="b.fees"></app-l2-amount></td></tr>
              <tr><th>Deposits</th><td>{{ (b.deposits?.length ?? 0) | number }}</td></tr>
            </tbody></table>
          </div>
        </div>

        <h2>Blind merged mining</h2>
        <div class="box">
          @if (b.bmm; as m) {
            <table class="kv"><tbody>
              <tr><th>Carried by eCash block</th><td><app-l2-main-link kind="block" [id]="m.mainHash" [text]="(m.mainHeight | number) + ''"></app-l2-main-link><span class="muted">&nbsp;·&nbsp;</span><app-l2-main-link kind="block" [id]="m.mainHash" [short]="true"></app-l2-main-link></td></tr>
              <tr><th>Bid paid to its miner</th><td>@if (m.bid !== null) {<app-l2-amount [sats]="m.bid"></app-l2-amount>} @else {<span class="muted">none found</span>}</td></tr>
              <tr><th>BMM request (M8)</th><td>@if (m.requestTxid) {<app-l2-main-link kind="tx" [id]="m.requestTxid"></app-l2-main-link>} @else {<span class="muted">none found</span>}</td></tr>
              <tr><th>Competition</th><td>@if (m.contested) {<span class="pill on">contested</span> {{ m.requests }} requests for the slot in that eCash block} @else { {{ m.requests }} request for the slot in that eCash block, none competing}</td></tr>
            </tbody></table>
            @if (m.requestList.length > 1) {
              <div class="mt-2">
                <app-chain-table [rows]="m.requestList" [columns]="requestCols" sort="bid" [pageSize]="10" empty="No requests.">
                  <ng-template cxCell="txid" let-r><app-l2-main-link kind="tx" [id]="r.txid" [short]="true"></app-l2-main-link></ng-template>
                  <ng-template cxCell="sideBlock" let-r>@if (r.sideBlock === b.hash) {<span class="mono" [title]="r.sideBlock">this block</span>} @else {<span class="mono" [title]="r.sideBlock">{{ shortId(r.sideBlock) }}</span>}</ng-template>
                  <ng-template cxCell="bid" let-r><app-l2-amount [sats]="r.bid"></app-l2-amount></ng-template>
                  <ng-template cxCell="accepted" let-r><span class="status" [class.ok]="r.accepted">{{ r.accepted ? 'accepted' : 'beaten' }}</span></ng-template>
                </app-chain-table>
              </div>
            }
          } @else if (b.mainBlock) {
            <div class="empty">The eCash explorer's drivechain index has no BMM accept for this block (or this explorer does not read it): carried by eCash block {{ b.mainBlock.height | number }} per the enforcer.</div>
          } @else {
            <div class="empty">No eCash block has carried this block yet.</div>
          }
        </div>

        @if (b.coinbase; as cb) {
          <h2>Coinbase</h2>
          <div class="tx-card">
            <div class="tx-head"><span class="mono muted" [title]="cb.txid">{{ cb.txid }}</span><span class="muted">{{ cb.outputs.length }} outputs</span></div>
            <app-l2-tx-io [tx]="{ inputs: [], outputs: cb.outputs }" emptyInputs="new coins and the block's fees"></app-l2-tx-io>
          </div>
        }

        <h2>Transactions ({{ b.txs.length | number }})</h2>
        @for (tx of b.txs; track tx.txid) {
          <div class="tx-card">
            <div class="tx-head">
              <a [routerLink]="['/tx', tx.txid]" class="mono">{{ tx.txid }}</a>
              <span>
                @if (tx.data) {<span class="pill on me-1">{{ tx.data.type }}</span>}
                @if (tx.shielded) {<span class="pill on me-1">shielded</span>}
                <span class="muted">fee </span><app-l2-amount [sats]="tx.fee"></app-l2-amount>
              </span>
            </div>
            <app-l2-tx-io [tx]="tx"></app-l2-tx-io>
          </div>
        } @empty {
          <div class="empty">No transactions besides the coinbase.</div>
        }

        @if (b.deposits?.length) {
          <h2>Deposits credited ({{ b.deposits.length }})</h2>
          <div class="box">
            <app-chain-table [rows]="b.deposits" [columns]="depositCols" [search]="depositMatches" searchPlaceholder="Address, eCash tx…"
                sort="amount" empty="No deposits.">
              <ng-template cxCell="outpoint" let-x><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></ng-template>
              <ng-template cxCell="mainTxid" let-x><app-l2-main-link kind="tx" [id]="x.mainTxid" [short]="true"></app-l2-main-link></ng-template>
              <ng-template cxCell="address" let-x>@if (x.burned) {<span class="pill">burned</span>} @else {<a [routerLink]="['/address', x.address]" class="mono">{{ x.address }}</a>}</ng-template>
              <ng-template cxCell="amount" let-x><app-l2-amount [sats]="x.amount"></app-l2-amount></ng-template>
              <ng-template cxCell="spent" let-x><app-l2-spent [spent]="x.spent"></app-l2-spent></ng-template>
            </app-chain-table>
          </div>
        }

        @if (b.bundleSpends?.length) {
          <h2>Withdrawn by bundles ({{ b.bundleSpends.length }})</h2>
          <div class="box">
            <app-chain-table [rows]="b.bundleSpends" [columns]="spendCols" [search]="spendMatches" searchPlaceholder="Outpoint, M6 id…" empty="None.">
              <ng-template cxCell="outpoint" let-x><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></ng-template>
              <ng-template cxCell="m6id" let-x><span class="mono">{{ x.m6id }}</span></ng-template>
            </app-chain-table>
          </div>
        }
      }
    }
  </div>`,
})
export class L2BlockPage implements OnInit {
  profile = PROFILE;
  id: string | null = null;
  view$: Observable<Loaded<L2Block>>;
  shortId = shortId;
  requestCols: CxColumn<L2BmmRequest>[] = [
    { key: 'txid', label: 'Request (M8)' },
    { key: 'sideBlock', label: PROFILE.name + ' block asked for' },
    { key: 'bid', label: 'Bid', align: 'right', sort: true },
    { key: 'accepted', label: 'Status', sort: r => r.accepted ? 1 : 0 },
  ];
  depositCols: CxColumn<L2Deposit>[] = [
    { key: 'outpoint', label: 'Outpoint' },
    { key: 'mainTxid', label: 'eCash tx' },
    { key: 'address', label: 'To', sort: true },
    { key: 'amount', label: 'Amount', align: 'right', sort: true },
    { key: 'spent', label: 'Spent', hide: 'md', sort: r => r.spent ? r.spent.height : null },
  ];
  depositMatches = (x: L2Deposit, q: string) => x.address.toLowerCase().includes(q) || x.mainTxid.toLowerCase().includes(q) || (x.outpoint.txid ?? '').toLowerCase().includes(q);
  spendCols: CxColumn<{ outpoint: L2OutPoint; m6id: string }>[] = [
    { key: 'outpoint', label: 'Outpoint' },
    { key: 'm6id', label: 'Bundle (M6 id)', sort: true },
  ];
  spendMatches = (x: { outpoint: L2OutPoint; m6id: string }, q: string) => x.m6id.toLowerCase().includes(q) || (x.outpoint.txid ?? '').toLowerCase().includes(q);

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle('Block ' + (/^\d+$/.test(id) ? id : shortId(id)));
      }),
      switchMap(id => loaded(this.api.block$(id))),
    );
  }
}
