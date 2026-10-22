import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2Block, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

/** /block/:id (hash or height): the header, its eCash carrier block, coinbase, transactions, deposits and bundle spends */
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
        <div class="sub"><span class="id">{{ b.hash }}</span> <app-clipboard [text]="b.hash"></app-clipboard></div>
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
              <tr><th>eCash block (BMM)</th><td>@if (b.mainBlock; as m) {<app-l2-main-link kind="block" [id]="m.hash" [text]="(m.height | number) + ''"></app-l2-main-link> <app-l2-main-link kind="block" [id]="m.hash" [short]="true"></app-l2-main-link>} @else {<span class="muted">not known yet</span>}</td></tr>
              <tr><th>Previous eCash block</th><td>@if (b.prevMainHash) {<app-l2-main-link kind="block" [id]="b.prevMainHash"></app-l2-main-link>}</td></tr>
              <tr><th>Transactions</th><td>{{ b.txCount | number }} · {{ b.inputs | number }} inputs · {{ b.outputs | number }} outputs</td></tr>
              <tr><th>Volume</th><td><app-l2-amount [sats]="b.volume"></app-l2-amount></td></tr>
              <tr><th>Fees</th><td><app-l2-amount [sats]="b.fees"></app-l2-amount></td></tr>
              <tr><th>Deposits</th><td>{{ (b.deposits?.length ?? 0) | number }}</td></tr>
            </tbody></table>
          </div>
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
                @if (tx.data) {<span class="pill on">{{ tx.data.type }}</span> }
                @if (tx.shielded) {<span class="pill on">shielded</span> }
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
            <table class="table table-borderless table-sm">
              <thead><tr><th>Outpoint</th><th>eCash tx</th><th>To</th><th class="text-end">Amount</th><th>Spent</th></tr></thead>
              <tbody>
                @for (x of b.deposits; track $index) {
                  <tr>
                    <td><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></td>
                    <td><app-l2-main-link kind="tx" [id]="x.mainTxid" [short]="true"></app-l2-main-link></td>
                    <td>@if (x.burned) {<span class="pill">burned</span>} @else {<a [routerLink]="['/address', x.address]" class="mono">{{ x.address }}</a>}</td>
                    <td class="text-end"><app-l2-amount [sats]="x.amount"></app-l2-amount></td>
                    <td><app-l2-spent [spent]="x.spent"></app-l2-spent></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (b.bundleSpends?.length) {
          <h2>Withdrawn by bundles ({{ b.bundleSpends.length }})</h2>
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Outpoint</th><th>Bundle (M6 id)</th></tr></thead>
              <tbody>
                @for (x of b.bundleSpends; track $index) {
                  <tr><td><app-l2-outpoint [op]="x.outpoint"></app-l2-outpoint></td><td class="mono">{{ x.m6id }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  </div>`,
})
export class L2BlockPage implements OnInit {
  id: string | null = null;
  view$: Observable<Loaded<L2Block>>;
  shortId = shortId;

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
