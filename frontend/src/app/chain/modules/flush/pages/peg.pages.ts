import { ChangeDetectionStrategy, Component, Injectable, OnInit } from '@angular/core';
import { Observable, map, startWith, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ChainApiService } from '@app/chain/chain-api.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2BmmPage } from '@app/chain/l2/pages/bmm.page';
import { FlushApiService, FlushLoaded, flushLoaded, flushResult } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS, PEG_TABS } from '../flush-kit';
import * as F from '../flush-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];

/** s<slot>_<address>_<checksum>: a deposit's destination on the sidechain */
export function depositAddress(dest: string): string {
  const m = /^s\d+_(.+)_[0-9a-f]{6}$/.exec(dest || '');
  return m ? m[1] : dest;
}

/**
 * /peg: Flush's two-way peg with eCash: the escrow (getpeginfo: the slot's CTIP on eCash), what the chain holds against
 * it (getsidechainstate pegbalance), the withdrawals waiting and the bundle being voted on (listwithdrawals,
 * getwithdrawalbundle), the deposits from eCash (the eCash explorer's drivechain events for the slot)
 */
@Component({
  selector: 'app-flush-peg-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Drivechain" [sub]="'Flush is slot ' + (slot$ | async) + ' of eCash\\'s drivechains (BIP300/301): ECX deposited into its escrow on eCash is credited on Flush, and withdrawals leave in bundles that eCash miners vote on'" [tabs]="tabs" active="/peg"></app-flush-head>
    @if (peg$ | async; as v) {
      <app-flush-state [state]="v" what="The peg" [list]="true" [height]="200"></app-flush-state>
      @if (v.data; as p) {
        <div class="kpis">
          <div class="kpi"><div class="l">Escrow on eCash</div><div class="v">{{ fx.amount(p.escrow?.amount, 4) }} <span class="muted">ECX</span></div>
            <div class="s">@if (p.escrow?.txid) {<app-flush-ecash kind="tx" [id]="p.escrow.txid" [text]="fx.shortId(p.escrow.txid, 6) + ':' + p.escrow.n"></app-flush-ecash>} @else {no escrow output}</div></div>
          <div class="kpi"><div class="l">Slot</div><div class="v">{{ p.sidechain?.slot ?? (slot$ | async) }}</div><div class="s">{{ p.sidechain?.title }} · {{ p.sidechain?.active ? 'active since eCash ' + (p.sidechain?.activationheight | number) : 'not active' }}</div></div>
          <div class="kpi"><div class="l">eCash tip</div><div class="v"><app-flush-ecash kind="block" [id]="p.height" [text]="(p.height | number) + ''" [mark]="false"></app-flush-ecash></div><div class="s">as this node follows it ({{ p.via }})</div></div>
          <div class="kpi"><div class="l">Withdrawal rules</div><div class="v">{{ p.withdrawalminscore | number }}</div><div class="s">votes for a bundle, within {{ p.withdrawalperiod | number }} eCash blocks</div></div>
        </div>
      }
    }
    @if (balance$ | async; as b) {
      @if (b.data; as pb) {
        <h2>What Flush holds against the escrow <span class="hint">getsidechainstate pegbalance, eCash height {{ pb.mainheight | number }}</span></h2>
        <div class="box">
          <div class="d-flex flex-wrap gap-4">
            @for (k of balanceKeys; track k.key) {<div><div class="hint">{{ k.label }}</div><b>{{ fx.amount(pb[k.key], 4) }}</b></div>}
            <div><div class="hint">total</div><b>{{ fx.amount(pb.total, 4) }}</b> <span class="muted">ECX</span></div>
          </div>
        </div>
      }
    }
    <div class="grid2 mt-3">
      <div class="card-box">
        <h3>The bundle <span class="hint">getwithdrawalbundle</span></h3>
        @if (bundle$ | async; as bv) {
          @if (bv.data; as bd) {
            <table class="kv"><tbody>
              <tr><th>Status</th><td><span class="pill" [class.on]="bd.status === 'pending'">{{ bd.status }}</span>@if (bd.waiting) { <span class="muted">· {{ bd.waiting }} withdrawals waiting for the next</span>}</td></tr>
              @if (bd.hash) {<tr><th>M6 id</th><td class="mono">{{ bd.hash }}</td></tr>}
              <tr><th>Withdrawals</th><td>{{ bd.withdrawals | number }} · {{ fx.amount(bd.amount) }} ECX · eCash fees {{ fx.amount(bd.mainchainfee) }} ECX</td></tr>
              @if (bd.height) {<tr><th>Made at</th><td>Flush block <a [routerLink]="['/block', bd.height]">{{ bd.height | number }}</a></td></tr>}
            </tbody></table>
          } @else if (!bv.loading) {<p class="muted mb-0">No bundle.</p>}
        }
        @if (peg$ | async; as v) {
          @if (v.data?.bundles?.length) {
            <h3 class="mt-3">Bundles on eCash <span class="hint">votes</span></h3>
            @for (b of v.data.bundles; track b.hash) {
              <div class="mb-2"><span class="mono">{{ fx.shortId(b.hash, 10) }}</span> @if (b.payable) {<span class="pill ok">payable</span>}
                <div class="bar mt-1"><div class="fill" [style.width.%]="100 * min1(b.score / (v.data.withdrawalminscore || 1))"></div></div>
                <div class="hint">{{ b.score | number }} of {{ v.data.withdrawalminscore | number }} votes · {{ b.blocksleft | number }} eCash blocks left · this node votes {{ b.vote }}</div></div>
            }
          }
        }
      </div>
      <div class="card-box">
        <h3>Withdrawals <span class="hint">listwithdrawals</span></h3>
        @if (withdrawals$ | async; as w) {
          <app-flush-state [state]="w" what="Withdrawals" [height]="100" [list]="true"></app-flush-state>
          @if (w.data; as wd) {
            <table class="table table-borderless table-sm"><thead><tr><th>Transaction</th><th class="r">Amount</th><th class="r">eCash fee</th><th>Status</th><th>Block</th></tr></thead><tbody>
              @for (x of wd; track $index) {
                <tr><td><a [routerLink]="['/tx', x.txid]" class="mono">{{ fx.shortId(x.txid, 6) }}</a></td><td class="r">{{ fx.amount(x.amount) }}</td><td class="r">{{ fx.amount(x.mainchainfee) }}</td>
                  <td><span class="pill" [class.on]="x.status === 'bundled'">{{ x.status }}</span></td><td><a [routerLink]="['/block', x.height]">{{ x.height | number }}</a></td></tr>
              } @empty {<tr><td colspan="5" class="empty">No withdrawal waiting.</td></tr>}
            </tbody></table>
          }
        }
      </div>
    </div>
    <h2>Deposits from eCash <span class="hint">the eCash explorer's drivechain index, slot {{ slot$ | async }}</span></h2>
    <div class="box">
      @if (deposits$ | async; as d) {
        <app-flush-state [state]="d" what="Deposits" [height]="160" [list]="true"></app-flush-state>
        @if (d.data; as dd) {
          <table class="table table-borderless table-sm"><thead><tr><th>eCash block</th><th>Age</th><th>To</th><th class="r">Amount</th><th>eCash tx</th></tr></thead><tbody>
            @for (e of dd; track $index) {
              <tr><td><app-flush-ecash kind="block" [id]="e.blockHash" [text]="(e.height | number) + ''"></app-flush-ecash></td><td><app-time kind="since" [time]="e.time" [fastRender]="true"></app-time></td>
                <td><app-flush-addr [address]="depositAddress(e.destination)"></app-flush-addr></td><td class="r pos">{{ fx.amount(e.amount / 1e8) }} ECX</td>
                <td><app-flush-ecash kind="tx" [id]="e.txid" [text]="fx.shortId(e.txid, 6)" [mark]="false"></app-flush-ecash></td></tr>
            } @empty {<tr><td colspan="5" class="empty">No deposit in the indexed eCash blocks.</td></tr>}
          </tbody></table>
        }
      }
    </div>
    <p class="mt-3"><a routerLink="/bmm">BMM on eCash: the eCash blocks that carried Flush's, bids, coverage, bundles' votes →</a></p>
  </div>`,
})
export class FlushPegPage implements OnInit {
  tabs = PEG_TABS;
  fx = F;
  slot$: Observable<number>;
  depositAddress = depositAddress;
  balanceKeys = [
    { key: 'utxos', label: 'coins' }, { key: 'assets', label: 'held by the DEX' }, { key: 'withdrawals', label: 'withdrawals' },
    { key: 'bonded', label: 'bonded' }, { key: 'unbonding', label: 'unbonding' }, { key: 'pot', label: 'pot' }, { key: 'pool', label: 'validator pool' },
    { key: 'reserve', label: 'reserve' }, { key: 'rewards', label: 'rewards' }, { key: 'payouts', label: 'payouts' },
  ];
  peg$: Observable<FlushLoaded<any>>;
  balance$: Observable<FlushLoaded<any>>;
  bundle$: Observable<FlushLoaded<any>>;
  withdrawals$: Observable<FlushLoaded<any[]>>;
  deposits$: Observable<FlushLoaded<any[]>>;

  constructor(private api: FlushApiService, private seo: SeoService) {
    this.slot$ = this.api.slot$;
  }

  ngOnInit(): void {
    this.seo.setTitle('Flush drivechain: the peg');
    const tick$ = timer(0, 60000);
    this.peg$ = tick$.pipe(switchMap(() => flushResult(this.api.rpc$<any>('getpeginfo'))), startWith({ loading: true } as FlushLoaded<any>));
    this.balance$ = flushLoaded(this.api.rpc$<any>('getsidechainstate').pipe(map(s => s?.pegbalance ?? null)));
    this.bundle$ = flushLoaded(this.api.rpc$<any>('getwithdrawalbundle'));
    this.withdrawals$ = flushLoaded(this.api.rpc$<any[]>('listwithdrawals'));
    this.deposits$ = flushLoaded(this.api.drivechain$<any[]>('events/deposits', { limit: 50 }));
  }

  min1(x: number): number {
    return Math.max(0, Math.min(1, x || 0));
  }
}

/** The L2 BMM page's data for Flush: straight from the eCash explorer's drivechain API for its slot (same site) */
@Injectable()
export class FlushBmmL2Api extends L2ApiService {
  constructor(api: ChainApiService, private flush: FlushApiService) {
    super(api);
  }

  override bmmCockpit$(window: number): Observable<any> {
    return this.flush.drivechain$('cockpit', { window });
  }

  override bmmEvents$(kind: string, before: number | null = null, limit = 40): Observable<any[]> {
    return this.flush.drivechain$<any[]>('events/' + kind, { before, limit });
  }
}

/** /bmm: the sidechain explorers' BMM page (chain/l2/pages/bmm.page), on the eCash explorer's API for Flush's slot */
@Component({
  selector: 'app-flush-bmm-page',
  standalone: true,
  imports: [L2BmmPage],
  providers: [{ provide: L2ApiService, useClass: FlushBmmL2Api }],
  template: `<app-l2-bmm></app-l2-bmm>`,
})
export class FlushBmmPage {}
