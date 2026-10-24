import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { PROFILE, PROFILES } from '@app/chain/profiles';
import { L2BlockSummary, L2Deposit, L2Summary, L2Withdrawal } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';
import { L2LiveService } from '@app/chain/l2/full/l2-live.service';

type Kind = 'chain' | 'treasury' | 'bmm' | 'bundles' | 'peg' | 'deposits' | 'withdrawals' | 'mining';

interface PegEvent {
  kind: 'deposit' | 'withdrawal';
  amount: number;
  height: number;
  time: number | null;
  /** the sidechain address credited, or the eCash address paid */
  address: string;
  mainTxid: string | null;
  txid: string | null;
}

/**
 * The dashboard widgets of a sidechain explorer on upstream's UI (CHAIN_UI 'full'), where the eCash explorer has its
 * drivechain and mining widgets (chain/components/drivechain-widget), from GET /api/v1/l2/* via L2LiveService:
 *   chain        the tip, the eCash block that carried it, counts
 *   treasury     the escrow on eCash against the sats held on the sidechain
 *   bmm          BMM coverage over the newest eCash blocks, the newest blocks and their carriers
 *   bundles      the pending withdrawal bundle
 *   peg          the latest deposits and withdrawals; deposits, withdrawals: each alone
 */
@Component({
  selector: 'app-l2-widget',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/drivechain-widget/drivechain-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .cell.on { background: var(--ec); }
    .cell.contested { background: #ff6b6b; }
    .kv { width: 100%; font-size: 0.85rem; margin: 0; td { padding: 3px 4px; vertical-align: middle; } td:first-child { color: var(--transparent-fg); } }
    .bar { margin: 4px 0 10px; }
    .g-cells { flex-wrap: nowrap; }
    .cell { max-width: none; }
    .big-row { flex-wrap: wrap; }
    @media (max-width: 480px) { .big-value { font-size: 1.1rem; } }
  `],
  template: `
  <div class="card dc-card" [style.--ec]="ecashColor">
    <div class="card-body">
      @if (kind === 'peg' || kind === 'deposits' || kind === 'withdrawals') {
        @if (peg$ | async; as items) {
          @if (!items.length) {<p class="empty">No {{ kind === 'peg' ? 'deposit or withdrawal' : kind === 'deposits' ? 'deposit' : 'withdrawal' }} in the indexed blocks.</p>}
          @else {
            <table class="table table-borderless table-sm peg">
              <tbody>
                @for (e of items; track $index) {
                  <tr>
                    <td class="dir" [class.pos]="e.kind === 'deposit'" [class.neg]="e.kind === 'withdrawal'">{{ e.kind === 'deposit' ? '↓ in' : '↑ out' }}</td>
                    <td class="mono" [title]="e.address">
                      @if (e.kind === 'deposit') {<a [routerLink]="['/address' | relativeUrl, e.address]">{{ shortId(e.address, 6) }}</a>}
                      @else {<app-l2-main-link kind="address" [id]="e.address" [text]="shortId(e.address, 6)"></app-l2-main-link>}
                    </td>
                    <td class="text-end"><app-l2-amount [sats]="e.amount" [compact]="true"></app-l2-amount></td>
                    <td class="text-end when">
                      @if (e.txid) {<a [routerLink]="['/tx' | relativeUrl, e.txid]">@if (e.time) {<app-time kind="since" [time]="e.time" [fastRender]="true"></app-time>} @else {block {{ e.height | number }}}</a>}
                      @else {<a [routerLink]="['/block' | relativeUrl, e.height]">@if (e.time) {<app-time kind="since" [time]="e.time" [fastRender]="true"></app-time>} @else {block {{ e.height | number }}}</a>}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
          <a class="more" [routerLink]="[(kind === 'withdrawals' ? '/withdrawals' : '/deposits') | relativeUrl]">{{ kind === 'peg' ? 'Deposits and withdrawals' : kind === 'deposits' ? 'All deposits' : 'All withdrawals' }} →</a>
        } @else {<ng-container *ngTemplateOutlet="loading"></ng-container>}
      } @else {
        @if (data$ | async; as d) {
          @if (!d.s) {
            <p class="empty">The sidechain index cannot be reached right now.</p>
          } @else {
            @switch (kind) {
              @case ('chain') {
                <div class="big-row">
                  <div class="big"><div class="big-value">@if (d.s.tip; as t) {<a [routerLink]="['/block' | relativeUrl, t.hash]">{{ t.height | number }}</a>} @else {–}</div><div class="big-label">tip</div></div>
                  <div class="big"><div class="big-value">{{ d.s.txs | number }}</div><div class="big-label">transactions</div></div>
                  <div class="big"><div class="big-value">{{ d.s.addresses | number }}</div><div class="big-label">addresses</div></div>
                </div>
                <table class="kv"><tbody>
                  <tr><td>Tip carried by</td><td>@if (d.blocks[0]?.mainBlock; as mb) {<app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> block <app-l2-main-link kind="block" [id]="mb.hash" [text]="(mb.height | number) + ''"></app-l2-main-link>@if (d.blocks[0]?.bmm?.bid !== null && d.blocks[0]?.bmm?.bid !== undefined) {<span class="muted"> · bid {{ d.blocks[0].bmm.bid | number }} sats</span>}} @else {<span class="muted">not carried yet</span>}</td></tr>
                  <tr><td>Tip time</td><td>@if (d.s.tip?.time; as tt) {<app-time kind="since" [time]="tt" [fastRender]="true"></app-time>} @else {<span class="muted">unknown</span>}</td></tr>
                  <tr><td>Mempool</td><td>@if (d.s.mempool; as mp) {<span>{{ mp.count | number }} transactions</span>} @else {<span class="muted">not listed by the node</span>}</td></tr>
                  <tr><td>Index</td><td>@if (d.s.ready) {caught up, {{ d.s.blocks | number }} blocks} @else {indexing: {{ d.s.indexed | number }} of {{ (d.s.tip?.height ?? 0) | number }}}</td></tr>
                </tbody></table>
                <a class="more" [routerLink]="['/blocks' | relativeUrl]">Blocks →</a>
              }
              @case ('treasury') {
                <div class="big-row">
                  <div class="big"><div class="big-value">@if (d.s.escrow; as e) {<app-l2-amount [sats]="e.amount" [compact]="true"></app-l2-amount>} @else {–}</div><div class="big-label">escrow on eCash</div></div>
                  <div class="big"><div class="big-value"><app-l2-amount [sats]="d.s.wealth" [compact]="true"></app-l2-amount></div><div class="big-label">held on {{ profile.name }}</div></div>
                  <div class="big"><div class="big-value">{{ pct(share(d.s), 2) }}</div><div class="big-label">of the escrow</div></div>
                </div>
                @if (d.s.escrow) {<div class="bar" [title]="pct(share(d.s), 2) + ' of the escrow is held on the sidechain'"><div class="fill" [style.width.%]="share(d.s) * 100"></div></div>}
                <table class="kv"><tbody>
                  @if (d.s.escrow; as e) {
                    <tr><td>Escrow output</td><td><app-l2-main-link kind="tx" [id]="e.txid" [short]="true"></app-l2-main-link><span class="muted ms-1">· sequence {{ e.sequence | number }}</span></td></tr>
                    <tr><td>Escrow − wealth</td><td><app-l2-amount [sats]="e.amount - d.s.wealth" [signed]="true"></app-l2-amount></td></tr>
                  }
                  <tr><td>Deposited</td><td><app-l2-amount [sats]="d.s.deposits.amount" [compact]="true"></app-l2-amount><span class="muted ms-1">· {{ d.s.deposits.count | number }} deposits</span></td></tr>
                  <tr><td>Withdrawn</td><td><app-l2-amount [sats]="d.s.withdrawals.amount" [compact]="true"></app-l2-amount><span class="muted ms-1">· {{ d.s.withdrawals.count | number }} withdrawals</span></td></tr>
                </tbody></table>
                <a class="more" [routerLink]="['/deposits' | relativeUrl]">Deposits and withdrawals →</a>
              }
              @case ('bmm') {
                @if (d.s.bmm; as bmm) {
                  <div class="big-row">
                    <div class="big"><div class="big-value">{{ pct(bmm.coverage, 1) }}</div><div class="big-label">of the last {{ bmm.window | number }} eCash blocks</div></div>
                    <div class="big"><div class="big-value">{{ bmm.accepts | number }}</div><div class="big-label">blocks carried</div></div>
                    <div class="big"><div class="big-value">{{ bmm.bidMedian | number }}</div><div class="big-label">sats median bid</div></div>
                  </div>
                } @else {
                  <p class="empty mb-2">This explorer does not read the eCash explorer's drivechain index: carriers per the enforcer only.</p>
                }
                <div class="grid">
                  <div class="g-row">
                    <span class="g-name" [style.color]="profile.color"><app-sidechain-label [chain]="profile.id" [name]="profile.name"></app-sidechain-label></span>
                    <span class="g-cells">
                      @for (b of newest(d.blocks); track b.hash) {
                        @if (b.mainBlock) {
                          <a class="cell on" [class.contested]="b.bmm?.contested" [routerLink]="['/block' | relativeUrl, b.hash]" [title]="cellTitle(b)"></a>
                        } @else {
                          <a class="cell" [routerLink]="['/block' | relativeUrl, b.hash]" [title]="cellTitle(b)"></a>
                        }
                      }
                    </span>
                  </div>
                </div>
                <div class="foot"><span>← {{ newest(d.blocks).length }} blocks, each carried by an eCash block</span>@if (d.s.bmm?.lastMainHeight; as lm) {<span>last at eCash {{ lm | number }}</span>}</div>
                <a class="more" [routerLink]="['/bmm' | relativeUrl]">BMM on eCash →</a>
              }
              @case ('bundles') {
                @if (d.s.pendingBundle; as b) {
                  <div class="big-row">
                    <div class="big"><div class="big-value"><app-l2-amount [sats]="b.total" [compact]="true"></app-l2-amount></div><div class="big-label">to pay out</div></div>
                    <div class="big"><div class="big-value">{{ b.payouts.length | number }}</div><div class="big-label">payout{{ b.payouts.length === 1 ? '' : 's' }}</div></div>
                  </div>
                  <table class="kv"><tbody>
                    <tr><td>M6 id</td><td>@if (b.m6id) {<span class="mono" [title]="b.m6id">{{ shortId(b.m6id, 10) }}</span>} @else {<span class="muted">not yet proposed</span>}</td></tr>
                    @for (p of b.payouts.slice(0, 4); track $index) {
                      <tr><td><app-l2-main-link kind="address" [id]="p.address" [text]="shortId(p.address, 6)"></app-l2-main-link></td><td class="text-end"><app-l2-amount [sats]="p.amount"></app-l2-amount><span class="muted ms-1">· fee {{ p.fee | number }}</span></td></tr>
                    }
                  </tbody></table>
                  @if (b.payouts.length > 4) {<div class="muted small">and {{ b.payouts.length - 4 }} more</div>}
                } @else {
                  <p class="empty">No withdrawal bundle is pending.</p>
                }
                <a class="more" [routerLink]="['/withdrawals' | relativeUrl]">Withdrawals →</a>
              }
            }
          }
        } @else {<ng-container *ngTemplateOutlet="loading"></ng-container>}
      }
      <ng-template #loading><div class="skeleton-loader"></div><div class="skeleton-loader mt-2"></div><div class="skeleton-loader mt-2"></div></ng-template>
    </div>
  </div>`,
})
export class L2WidgetComponent implements OnChanges {
  @Input() kind: Kind = 'chain';

  profile = PROFILE;
  ecashColor = PROFILES['ecash']?.color ?? '#E6A849';
  data$: Observable<{ s: L2Summary | null; blocks: L2BlockSummary[] }>;
  peg$: Observable<PegEvent[]>;
  shortId = shortId;

  constructor(private live: L2LiveService) {}

  ngOnChanges(): void {
    if (this.kind === 'peg' || this.kind === 'deposits' || this.kind === 'withdrawals') {
      const dep = (xs: L2Deposit[]): PegEvent[] => xs.map(x => ({ kind: 'deposit', amount: x.amount, height: x.height, time: x.time,
        address: x.address, mainTxid: x.mainTxid, txid: null }));
      const wd = (xs: L2Withdrawal[]): PegEvent[] => xs.map(x => ({ kind: 'withdrawal', amount: x.amount, height: x.height, time: x.time,
        address: x.mainAddress, mainTxid: null, txid: x.txid }));
      this.peg$ = this.kind === 'deposits' ? this.live.deposits$.pipe(map(dep))
        : this.kind === 'withdrawals' ? this.live.withdrawals$.pipe(map(wd))
        : combineLatest([this.live.deposits$, this.live.withdrawals$]).pipe(
          map(([d, w]) => [...dep(d), ...wd(w)].sort((a, b) => b.height - a.height).slice(0, 8)),
        );
    } else {
      this.data$ = combineLatest([this.live.summary$, this.live.blocks$]).pipe(map(([s, blocks]) => ({ s, blocks })));
    }
  }

  /** the sidechain's wealth as a share of the eCash escrow */
  share(s: L2Summary): number {
    return s.escrow?.amount ? Math.min(1, s.wealth / s.escrow.amount) : 0;
  }

  pct(x: number, d = 1): string {
    return ((x || 0) * 100).toFixed(d) + '%';
  }

  /** the newest blocks, oldest first (the grid reads left to right) */
  newest(blocks: L2BlockSummary[]): L2BlockSummary[] {
    return blocks.slice(0, 40).reverse();
  }

  cellTitle(b: L2BlockSummary): string {
    if (!b.mainBlock) {
      return `Block ${b.height}: not carried by an eCash block yet`;
    }
    const bid = b.bmm?.bid;
    return `Block ${b.height}: carried by eCash block ${b.mainBlock.height}` + (bid !== null && bid !== undefined ? ` · bid ${bid} sats` : '')
      + (b.bmm?.contested ? ` · contested (${b.bmm.requests} requests)` : '');
  }
}
