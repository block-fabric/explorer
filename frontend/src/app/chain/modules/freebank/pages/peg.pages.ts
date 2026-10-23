import { ChangeDetectionStrategy, Component, Injectable, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, Subject, catchError, map, of, startWith, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ChainApiService } from '@app/chain/chain-api.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2BmmPage } from '@app/chain/l2/pages/bmm.page';
import { PROFILE } from '@app/chain/profiles';
import { hash } from '@app/shared/sha256';
import { FreebankApiService, FbLoaded, fbLoaded, fbResult } from '../freebank-api.service';
import { FB_PAGE_IMPORTS, PEG_TABS } from '../freebank-kit';
import * as F from '../freebank-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../freebank-page.scss'];

/** s<slot>_<address>_<checksum>: a deposit's destination on the sidechain */
export function depositAddress(dest: string): string {
  const m = /^s\d+_(.+)_[0-9a-f]{6}$/.exec(dest || '');
  return m ? m[1] : dest;
}

/** the eCash txid of a raw transaction (hex): sha256d of its bytes, reversed; null for a segwit one or bad hex */
export function rawTxid(hex: string): string | null {
  if (!/^([0-9a-f]{2})+$/i.test(hex) || hex.length < 20) {
    return null;
  }
  const bytes = new Uint8Array(hex.match(/../g)!.map(b => parseInt(b, 16)));
  if (bytes[4] === 0 && bytes[5] === 1) {
    return null; // segwit: the txid leaves the witness out
  }
  return Array.from(hash(hash(bytes))).reverse().map(b => b.toString(16).padStart(2, '0')).join('');
}

interface Bundle { hex: string; bytes: number; txid: string | null }

/**
 * /peg: FreeBank's two-way peg with eCash (slot 130): how the node follows eCash (getmainchaininfo,
 * getmainchainblockcount), the latest withdrawal bundle (getwithdrawalbundle: its raw eCash transaction; none: no
 * bundle yet), a withdrawal by id (getwithdrawal), and from the eCash explorer's drivechain index for the slot: deposits,
 * paid withdrawals and the bundles' votes
 */
@Component({
  selector: 'app-freebank-peg-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS, FormsModule],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Drivechain" [sub]="profile.name + ' is slot ' + slot + ' of eCash\\'s drivechains (BIP300/301): ECX deposited into its escrow on eCash is credited on ' + profile.name + ', its blocks are blind merged mined by eCash miners, and withdrawals leave in bundles that eCash miners vote on'" [tabs]="tabs" active="/peg"></app-fb-head>
    @if (node$ | async; as v) {
      @if (v.data; as n) {
        <div class="kpis">
          <div class="kpi"><div class="l">Slot</div><div class="v">{{ slot }}</div><div class="s">{{ n.slot?.name || profile.name }} on eCash</div></div>
          <div class="kpi"><div class="l">eCash chain</div><div class="v">@if (n.count) {<app-fb-ecash kind="block" [id]="n.count" [text]="(n.count | number) + ''" [mark]="false"></app-fb-ecash>} @else {–}</div><div class="s">blocks, as this node follows it</div></div>
          <div class="kpi"><div class="l">Transport</div><div class="v">{{ n.info?.transport || '–' }}</div><div class="s">{{ n.info?.warnings || 'how the node reaches eCash' }}</div></div>
          <div class="kpi"><div class="l">BMM coverage</div><div class="v">{{ n.slot ? (n.slot.coverage * 100 | number:'1.0-1') + '%' : '–' }}</div><div class="s">of the last 144 eCash blocks carry a {{ profile.name }} block</div></div>
          <div class="kpi"><div class="l">Deposits</div><div class="v">{{ n.slot ? fx.sats(n.slot.depositAmount) : '–' }}</div><div class="s">ECX in {{ n.slot?.deposits ?? 0 }}, last 144 eCash blocks</div></div>
        </div>
      }
    }
    <div class="grid2 mt-3">
      <div class="card-box">
        <h3>The withdrawal bundle <span class="hint">getwithdrawalbundle</span></h3>
        @if (bundle$ | async; as bv) {
          @if (bv.loading) {<div class="skeleton-loader"></div>}
          @else if (bv.data; as bd) {
            <table class="kv"><tbody>
              <tr><th>Latest</th><td>the node's latest bundle (created, spent or failed): {{ bd.bytes | number }} bytes</td></tr>
              @if (bd.txid) {<tr><th>eCash transaction</th><td><app-fb-ecash kind="tx" [id]="bd.txid" [mono]="true"></app-fb-ecash></td></tr>}
              <tr><th>Raw</th><td class="mono">{{ fx.shortId(bd.hex, 32) }}</td></tr>
            </tbody></table>
          } @else {<p class="muted mb-0">No bundle pending: the node has not made a withdrawal bundle yet.</p>}
        }
        <h3 class="mt-3">A withdrawal <span class="hint">getwithdrawal</span></h3>
        <form class="d-flex gap-2" (submit)="lookup(wid); $event.preventDefault()">
          <input class="form-control form-control-sm" name="wid" [(ngModel)]="wid" placeholder="Withdrawal id (64 hex)" autocomplete="off" spellcheck="false">
          <button class="btn btn-sm btn-secondary" type="submit">Look up</button>
        </form>
        @if (withdrawal$ | async; as w) {
          <div class="mt-2">
            <app-fb-state [state]="w" what="Withdrawal" [height]="80"></app-fb-state>
            @if (w.data; as x) {
              <table class="kv"><tbody>
                <tr><th>Status</th><td><span class="pill" [class.ok]="x.status === 'Spent'" [class.on]="x.status !== 'Spent'">{{ x.status }}</span></td></tr>
                <tr><th>To (on eCash)</th><td>@if (x.destination) {<app-fb-ecash kind="address" [id]="x.destination" [mark]="false" [mono]="true"></app-fb-ecash>}</td></tr>
                <tr><th>Amount</th><td>{{ fx.sats(x.amount) }} ECX <span class="muted">(eCash fee {{ fx.sats(x.amountmainchainfee) }})</span></td></tr>
                @if (x.refunddestination) {<tr><th>Refund to</th><td><a [routerLink]="['/address', x.refunddestination]" class="mono">{{ x.refunddestination }}</a></td></tr>}
              </tbody></table>
            }
          </div>
        }
      </div>
      <div class="card-box">
        <h3>Withdrawals paid on eCash <span class="hint">the eCash explorer's drivechain index</span></h3>
        @if (paid$ | async; as p) {
          <app-fb-state [state]="p" what="Withdrawals" [height]="100"></app-fb-state>
          @if (p.data; as pd) {
            <table class="table table-borderless table-sm"><thead><tr><th>eCash block</th><th>Age</th><th class="r">Amount</th><th>Bundle</th></tr></thead><tbody>
              @for (e of pd; track $index) {
                <tr><td><app-fb-ecash kind="block" [id]="e.blockHash" [text]="(e.height | number) + ''"></app-fb-ecash></td><td><app-time kind="since" [time]="e.time" [fastRender]="true"></app-time></td>
                  <td class="r neg">{{ fx.sats(e.amount) }} ECX</td><td><app-fb-ecash kind="tx" [id]="e.txid" [text]="fx.shortId(e.bundle || e.txid, 6)" [mark]="false" [mono]="true"></app-fb-ecash></td></tr>
              } @empty {<tr><td colspan="4" class="empty">No withdrawal paid in the indexed eCash blocks.</td></tr>}
            </tbody></table>
          }
        }
        <h3 class="mt-3">Bundles on eCash <span class="hint">proposed, paid, failed</span></h3>
        @if (bundles$ | async; as bb) {
          @if (bb.data; as bl) {
            <table class="table table-borderless table-sm"><thead><tr><th>eCash block</th><th>Event</th><th>Bundle</th></tr></thead><tbody>
              @for (e of bl; track $index) {
                <tr><td><app-fb-ecash kind="block" [id]="e.blockHash" [text]="(e.height | number) + ''"></app-fb-ecash></td>
                  <td><span class="pill" [class.ok]="e.type === 'paid'" [class.bad]="e.type === 'failed'">{{ e.type }}</span></td><td class="mono">{{ fx.shortId(e.hash, 8) }}</td></tr>
              } @empty {<tr><td colspan="3" class="empty">No bundle in the indexed eCash blocks.</td></tr>}
            </tbody></table>
          }
        }
      </div>
    </div>
    <h2>Deposits from eCash <span class="hint">the eCash explorer's drivechain index, slot {{ slot }}</span></h2>
    <div class="box">
      @if (deposits$ | async; as d) {
        <app-fb-state [state]="d" what="Deposits" [height]="160"></app-fb-state>
        @if (d.data; as dd) {
          <table class="table table-borderless table-sm"><thead><tr><th>eCash block</th><th>Age</th><th>To</th><th class="r">Amount</th><th>eCash tx</th></tr></thead><tbody>
            @for (e of dd; track $index) {
              <tr><td><app-fb-ecash kind="block" [id]="e.blockHash" [text]="(e.height | number) + ''"></app-fb-ecash></td><td><app-time kind="since" [time]="e.time" [fastRender]="true"></app-time></td>
                <td><a [routerLink]="['/address', depositAddress(e.destination)]" class="mono">{{ fx.shortId(depositAddress(e.destination), 10) }}</a></td><td class="r pos">{{ fx.sats(e.amount) }} ECX</td>
                <td><app-fb-ecash kind="tx" [id]="e.txid" [text]="fx.shortId(e.txid, 6)" [mark]="false" [mono]="true"></app-fb-ecash></td></tr>
            } @empty {<tr><td colspan="5" class="empty">No deposit in the indexed eCash blocks.</td></tr>}
          </tbody></table>
        }
      }
    </div>
    <p class="mt-3"><a routerLink="/bmm">BMM on eCash: the eCash blocks that carried {{ profile.name }}'s, bids, coverage →</a></p>
  </div>`,
})
export class FreebankPegPage implements OnInit {
  tabs = PEG_TABS;
  fx = F;
  profile = PROFILE;
  slot = PROFILE.slot;
  depositAddress = depositAddress;
  wid = '';
  private lookup$ = new Subject<string>();
  node$: Observable<FbLoaded<any>>;
  bundle$: Observable<FbLoaded<Bundle | null>>;
  withdrawal$: Observable<FbLoaded<any> | null>;
  paid$: Observable<FbLoaded<any[]>>;
  bundles$: Observable<FbLoaded<any[]>>;
  deposits$: Observable<FbLoaded<any[]>>;

  constructor(private api: FreebankApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name} drivechain: the peg`);
    const safe = <T>(o: Observable<T>) => o.pipe(catchError(() => of(null)));
    this.node$ = timer(0, 60000).pipe(switchMap(() => fbResult(this.api.rpc$<number>('getmainchainblockcount').pipe(
      catchError(() => of(null)),
      switchMap(count => safe(this.api.rpc$<any>('getmainchaininfo')).pipe(map(info => ({ count, info })))),
      switchMap(n => safe(this.api.drivechain$<any>('cockpit', { window: 144 })).pipe(map(c => ({ ...n, slot: c?.slots?.find((s: any) => s.slot === PROFILE.slot) ?? null })))),
    ))), startWith({ loading: true } as FbLoaded<any>));
    // the node answers an error when no bundle was ever made: that is "no bundle", not a failure
    this.bundle$ = this.api.rpc$<string>('getwithdrawalbundle').pipe(
      map(hex => typeof hex === 'string' && hex ? { hex, bytes: hex.length / 2, txid: rawTxid(hex) } : null),
      catchError(() => of(null)),
      map(data => ({ loading: false, data })),
      startWith({ loading: true }),
    );
    this.withdrawal$ = this.lookup$.pipe(
      switchMap(id => /^[0-9a-f]{64}$/i.test(id) ? fbLoaded(this.api.rpc$<any>('getwithdrawal', id.toLowerCase()))
        : of({ loading: false, error: { status: 400, message: 'Not a valid id' } } as FbLoaded<any>)),
      startWith(null),
    );
    this.paid$ = fbLoaded(this.api.drivechain$<any[]>('events/withdrawals', { limit: 25 }));
    this.bundles$ = fbLoaded(this.api.drivechain$<any[]>('events/bundles', { limit: 15 }));
    this.deposits$ = fbLoaded(this.api.drivechain$<any[]>('events/deposits', { limit: 50 }));
  }

  lookup(id: string): void {
    this.lookup$.next(String(id ?? '').trim());
  }
}

/** The L2 BMM page's data for FreeBank: straight from the eCash explorer's drivechain API for its slot (same site) */
@Injectable()
export class FreebankBmmL2Api extends L2ApiService {
  constructor(api: ChainApiService, private fb: FreebankApiService) {
    super(api);
  }

  override bmmCockpit$(window: number): Observable<any> {
    return this.fb.drivechain$('cockpit', { window });
  }

  override bmmEvents$(kind: string, before: number | null = null, limit = 40): Observable<any[]> {
    return this.fb.drivechain$<any[]>('events/' + kind, { before, limit });
  }
}

/** /bmm: the sidechain explorers' BMM page (chain/l2/pages/bmm.page), on the eCash explorer's API for FreeBank's slot */
@Component({
  selector: 'app-freebank-bmm-page',
  standalone: true,
  imports: [L2BmmPage],
  providers: [{ provide: L2ApiService, useClass: FreebankBmmL2Api }],
  template: `<app-l2-bmm></app-l2-bmm>`,
})
export class FreebankBmmPage {}
