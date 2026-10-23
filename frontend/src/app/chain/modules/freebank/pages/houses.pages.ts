import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, combineLatest, map, of, shareReplay, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { FreebankApiService, FbLoaded, fbLoaded } from '../freebank-api.service';
import { FreebankLiveService } from '../freebank-live.service';
import { CREDIT_TABS, FB_PAGE_IMPORTS } from '../freebank-kit';
import { House, HouseMember, LoanBook, TokenClaims } from '../freebank.interfaces';
import * as F from '../freebank-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../freebank-page.scss'];
const MEMBERS_PAGE = 100;

/** the next attestation's deadline against the tip, in words */
function deadline(h: House, tip: number | null): { label: string; late: boolean } {
  if (!h.attest_deadline || tip === null) {
    return { label: '', late: false };
  }
  const left = h.attest_deadline - tip;
  return left >= 0 ? { label: `in ${F.num(left)} blocks`, late: false } : { label: `${F.num(-left)} blocks ago`, late: true };
}

/**
 * /houses: the discount houses (listhouses): status (stored and effective at the tip), type, escrow, the reserves they
 * attested and their ratio to the notes out, notes minted and deposits taken (note units), their loan books, when they
 * registered and when the next attestation is due
 */
@Component({
  selector: 'app-freebank-houses-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Discount houses" sub="Houses mint notes against the escrow their partners pledge and the reserves they attest; members-only houses keep their notes between members, and a house that misses its attestations becomes stressed, then insolvent" [tabs]="tabs" active="/houses"></app-fb-head>
    @if (view$ | async; as v) {
      <app-fb-state [state]="v" what="The houses" [height]="300"></app-fb-state>
      @if (v.data; as d) {
        <div class="kpis">
          <div class="kpi"><div class="l">Houses</div><div class="v">{{ d.houses.length }}</div><div class="s">{{ d.open }} open at the tip</div></div>
          <div class="kpi"><div class="l">Escrow</div><div class="v">{{ fx.ecx(d.escrow, 4) }} <span class="muted">ECX</span></div><div class="s">pledged by the partners</div></div>
          <div class="kpi"><div class="l">Notes out</div><div class="v">{{ fx.compact(d.minted) }}</div><div class="s">note units minted</div></div>
          <div class="kpi"><div class="l">Loan books</div><div class="v">{{ fx.sats(d.book) }} <span class="muted">ECX</span></div><div class="s">face of the bills houses hold</div></div>
        </div>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>House</th><th>Type</th><th>Status</th><th class="r">Escrow</th><th class="r">Reserves attested</th><th class="r">Ratio</th>
              <th class="r">Minted</th><th class="r d-none d-md-table-cell">Deposits</th><th class="r d-none d-md-table-cell">Loan book</th>
              <th class="d-none d-lg-table-cell">Registered</th><th class="d-none d-lg-table-cell">Next attestation</th></tr></thead>
            <tbody>
              @for (h of d.houses; track h.id) {
                <tr>
                  <td class="nowrap"><a [routerLink]="['/house', h.id]">#{{ h.id }}</a><span class="muted ms-2">{{ h.classid }}</span></td>
                  <td class="nowrap">{{ fx.houseType(h.type) }}@if (h.type === 'members') {<span class="muted"> · {{ h.member_records ?? 0 }}</span>}</td>
                  <td class="nowrap"><span class="pill" [ngClass]="fx.statusTone(h.effective_status)" title="Effective status at the tip">{{ fx.houseStatus(h.effective_status) }}</span>
                    @if (h.status !== h.effective_status) {<span class="pill ms-1" title="Stored status">{{ fx.houseStatus(h.status) }}</span>}
                    @if (h.closed) {<span class="pill bad ms-1">closed</span>}</td>
                  <td class="r nowrap">{{ fx.ecx(h.activeescrow, 4) }}</td>
                  <td class="r nowrap">{{ fx.ecx(h.lastattestreserves, 4) }}<div class="hint">at <a [routerLink]="['/block', h.lastattestheight]">{{ h.lastattestheight | number }}</a></div></td>
                  <td class="r nowrap" [class.neg]="h.mintedunits > 0 && h.attestedratiobps < 10000">{{ h.mintedunits ? fx.bps(h.attestedratiobps) : '–' }}</td>
                  <td class="r nowrap">{{ fx.num(h.mintedunits) }}</td>
                  <td class="r nowrap d-none d-md-table-cell">{{ fx.num(h.depositunits) }}</td>
                  <td class="r nowrap d-none d-md-table-cell">@if (h.loanbookface) {<a [routerLink]="['/loanbook']" [queryParams]="{ house: h.id }">{{ fx.sats(h.loanbookface) }}</a>} @else {<span class="muted">–</span>}</td>
                  <td class="d-none d-lg-table-cell"><a [routerLink]="['/block', h.registeredheight]">{{ h.registeredheight | number }}</a></td>
                  <td class="d-none d-lg-table-cell nowrap"><a [routerLink]="['/block', h.attest_deadline]">{{ h.attest_deadline | number }}</a>
                    @if (dl(h, d.tip); as t) {@if (t.label) {<div class="hint" [class.neg]="t.late">{{ t.label }}</div>}}</td>
                </tr>
              } @empty {<tr><td colspan="11" class="empty">No discount house on the chain yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p class="note mt-2">Escrow and reserves in ECX; notes, deposits in note units (one unit redeems for one sat at its house); loan books in ECX of face.</p>
      }
    }
  </div>`,
})
export class FreebankHousesPage implements OnInit {
  tabs = CREDIT_TABS;
  fx = F;
  dl = deadline;
  view$: Observable<FbLoaded<{ houses: House[]; tip: number | null; open: number; escrow: number; minted: number; book: number }>>;

  constructor(private api: FreebankApiService, private live: FreebankLiveService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: discount houses`);
    this.view$ = fbLoaded(combineLatest([this.api.rpc$<House[]>('listhouses'), this.live.tip$]).pipe(map(([houses, tip]) => {
      const hs = [...(houses ?? [])].sort((a, b) => a.id - b.id);
      const sum = (k: keyof House) => hs.reduce((s, h) => s + (Number(h[k]) || 0), 0);
      return { houses: hs, tip, open: hs.filter(h => h.effective_status === 'open').length, escrow: sum('activeescrow'), minted: sum('mintedunits'), book: sum('loanbookface') };
    })));
  }
}

/**
 * /house/:id: a discount house (gethouse): its status and its rules (tier, threshold, caps), its partners and their
 * pledges, its members (listhousemembers, paged), the token holders' claims when it has failed (gettokenclaims), its loan
 * book (listloanbook id), the transaction that registered it
 */
@Component({
  selector: 'app-freebank-house-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head [title]="'House #' + id" [tabs]="tabs" active="/houses"></app-fb-head>
    @if (house$ | async; as v) {
      <app-fb-state [state]="v" what="House" [id]="id" [height]="300"></app-fb-state>
      @if (v.data; as h) {
        <div class="title-row mb-2">
          <span class="pill" [ngClass]="fx.statusTone(h.effective_status)">{{ fx.houseStatus(h.effective_status) }}</span>
          @if (h.status !== h.effective_status) {<span class="muted small">stored status: {{ fx.houseStatus(h.status) }}</span>}
          <span class="pill">{{ fx.houseType(h.type) }}</span>
          @if (h.closed) {<span class="pill bad">closed</span>}
          @if (h.pareligible) {<span class="pill ok" title="Eligible to settle at par">par eligible</span>}
          <span class="muted small">{{ h.classid }}</span>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="l">Escrow</div><div class="v">{{ fx.ecx(h.activeescrow, 4) }} <span class="muted">ECX</span></div><div class="s">tier {{ h.tier }} · λ {{ (h.lambdax10 ?? 0) / 10 }}</div></div>
          <div class="kpi"><div class="l">Reserves attested</div><div class="v">{{ fx.ecx(h.lastattestreserves, 4) }} <span class="muted">ECX</span></div><div class="s">ratio {{ h.mintedunits ? fx.bps(h.attestedratiobps) : '–' }} · at block {{ h.lastattestheight | number }}</div></div>
          <div class="kpi"><div class="l">Notes minted</div><div class="v">{{ fx.num(h.mintedunits) }}</div><div class="s">cap {{ fx.num(h.mintcapunits) }} units</div></div>
          <div class="kpi"><div class="l">Deposits</div><div class="v">{{ fx.num(h.depositunits) }}</div><div class="s">note units · match funding {{ h.matchfundingok === false ? 'broken' : 'ok' }}</div></div>
          <div class="kpi"><div class="l">Loan book</div><div class="v">{{ fx.sats(h.loanbookface) }} <span class="muted">ECX</span></div><div class="s">face of the bills it holds</div></div>
        </div>
        <div class="grid2 mt-3">
          <div class="card-box">
            <h3>The house <span class="hint">gethouse</span></h3>
            <table class="kv"><tbody>
              <tr><th>House hash</th><td class="mono">{{ h.househash }}</td></tr>
              <tr><th>Registered</th><td>block <a [routerLink]="['/block', h.registeredheight]">{{ h.registeredheight | number }}</a> by <a [routerLink]="['/tx', h.txidregister]" class="mono">{{ fx.shortId(h.txidregister, 10) }}</a></td></tr>
              <tr><th>Threshold</th><td>{{ h.threshold }} of {{ h.partners?.length ?? 0 }} partners sign</td></tr>
              <tr><th>Caps</th><td>capital {{ fx.num(h.capitalcapunits) }} · reserves {{ fx.num(h.reservecapunits) }} units (the lower binds)</td></tr>
              @if (h.brassagebps !== undefined) {<tr><th>Redemption spread</th><td>{{ fx.bps(h.brassagebps) }}</td></tr>}
              <tr><th>Next attestation</th><td>due by block <a [routerLink]="['/block', h.attest_deadline]">{{ h.attest_deadline | number }}</a>
                @if (dl(h, (tip$ | async) ?? null); as t) {@if (t.label) {<span [class.neg]="t.late"> ({{ t.label }})</span>}}</td></tr>
              <tr><th>Last settlement</th><td>@if (h.lastsettleheight) {block <a [routerLink]="['/block', h.lastsettleheight]">{{ h.lastsettleheight | number }}</a>} @else {<span class="muted">none</span>}</td></tr>
              @if (h.stress_since) {<tr><th>Stressed since</th><td><a [routerLink]="['/block', h.stress_since]">{{ h.stress_since | number }}</a></td></tr>}
              @if (h.defer_invoked_height) {<tr><th>Suspended</th><td>since <a [routerLink]="['/block', h.defer_invoked_height]">{{ h.defer_invoked_height | number }}</a>, insolvent at {{ h.defer_insolvent_height | number }} unless it attests</td></tr>}
              @if (h.insolvent_since) {<tr><th>Insolvent since</th><td><a [routerLink]="['/block', h.insolvent_since]">{{ h.insolvent_since | number }}</a> · claims close at {{ h.claim_window_closes | number }}</td></tr>}
              @if (h.redemptiondestpk) {<tr><th>Custody key</th><td class="mono">{{ h.redemptiondestpk }}</td></tr>}
              @if (h.tokenunits) {<tr><th>Token backing</th><td>{{ fx.num(h.tokenunits) }} units</td></tr>}
            </tbody></table>
          </div>
          <div class="card-box">
            <h3>Partners <span class="hint">{{ h.partners?.length ?? 0 }}</span></h3>
            <table class="table table-borderless table-sm"><thead><tr><th>#</th><th>Key</th><th class="r">Pledge</th><th>Status</th></tr></thead><tbody>
              @for (p of h.partners; track p.index) {
                <tr><td class="muted">{{ p.index }}</td><td class="mono" [title]="p.pubkey">{{ fx.shortId(p.pubkey, 8) }}</td><td class="r nowrap">{{ fx.ecx(p.pledge, 4) }} ECX</td>
                  <td><span class="pill" [class.ok]="p.status === 'active'">{{ p.status }}</span>@if (p.tailunlockheight) {<span class="hint"> until {{ p.tailunlockheight | number }}</span>}</td></tr>
              } @empty {<tr><td colspan="4" class="empty">No partner.</td></tr>}
            </tbody></table>
          </div>
        </div>

        @if (h.type === 'members') {
          <h2>Members <span class="hint">listhousemembers · {{ h.member_records ?? 0 }} records</span></h2>
          <div class="box">
            @if (members$ | async; as m) {
              <app-fb-state [state]="m" what="The members" [height]="120"></app-fb-state>
              @if (m.data; as ms) {
                <table class="table table-borderless table-sm"><thead><tr><th>Address</th><th>Added</th><th>Removal</th><th>Active</th></tr></thead><tbody>
                  @for (x of ms; track x.address) {
                    <tr><td><a [routerLink]="['/address', x.address]" class="mono">{{ x.address }}</a></td>
                      <td><a [routerLink]="['/block', x.added_height]">{{ x.added_height | number }}</a></td>
                      <td>@if (x.removal_height) {<a [routerLink]="['/block', x.removal_height]">{{ x.removal_height | number }}</a>} @else {<span class="muted">–</span>}</td>
                      <td><span class="pill" [class.ok]="x.active">{{ x.active ? 'yes' : 'no' }}</span></td></tr>
                  } @empty {<tr><td colspan="4" class="empty">No member listed.</td></tr>}
                </tbody></table>
                <div class="pager">
                  @if (memberStarts.length > 1) {<button class="btn btn-sm btn-secondary" (click)="membersFirst()">First</button>}
                  @if (ms.length >= membersPage) {<button class="btn btn-sm btn-secondary" (click)="membersNext(ms[ms.length - 1].address)">Next →</button>}
                </div>
              }
            }
          </div>
        }

        @if (fx.failed(h) || h.tokenclaims) {
          <h2>Token holders' claims <span class="hint">gettokenclaims</span></h2>
          <div class="box">
            @if (claims$ | async; as c) {
              <app-fb-state [state]="c" what="The claims" [height]="120"></app-fb-state>
              @if (c.data; as tc) {
                <div class="d-flex flex-wrap gap-4 mb-2">
                  <div><div class="hint">window</div><b>{{ tc.insolventsince ? (tc.insolventsince | number) + ' – ' + (tc.windowend | number) : 'not insolvent' }}</b></div>
                  <div><div class="hint">claimed</div><b>{{ fx.num(tc.claimed) }}</b> <span class="muted">units in {{ tc.claims | number }} claims</span></div>
                  <div><div class="hint">collected</div><b>{{ tc.collected | number }}</b></div>
                  <div><div class="hint">paid</div><b>{{ fx.sats(tc.paid) }}</b> <span class="muted">ECX</span></div>
                  <div><div class="hint">written off</div><b>{{ fx.num(tc.writeoff) }}</b></div>
                </div>
                <table class="table table-borderless table-sm"><thead><tr><th>Y</th><th class="r">Amount</th><th class="r">Fee</th><th>Posted</th><th>Collected</th></tr></thead><tbody>
                  @for (x of tc.list; track x.y) {
                    <tr><td class="mono" [title]="x.y">{{ fx.shortId(x.y, 8) }}</td><td class="r">{{ fx.num(x.amount) }}</td><td class="r">{{ fx.bps(x.feebps) }}</td>
                      <td><a [routerLink]="['/block', x.height]">{{ x.height | number }}</a></td>
                      <td>@if (x.collectheight) {<a [routerLink]="['/block', x.collectheight]">{{ x.collectheight | number }}</a>} @else {<span class="muted">–</span>}</td></tr>
                  } @empty {<tr><td colspan="5" class="empty">No claim posted.</td></tr>}
                </tbody></table>
              }
            }
          </div>
        }

        <h2>Loan book <span class="hint">listloanbook {{ id }}</span></h2>
        <div class="box">
          @if (book$ | async; as b) {
            <app-fb-state [state]="b" what="The loan book" [height]="120"></app-fb-state>
            @if (b.data; as lb) {
              <div class="d-flex flex-wrap gap-4 mb-2">
                <div><div class="hint">bills</div><b>{{ lb.count | number }}</b></div>
                <div><div class="hint">face</div><b>{{ fx.sats(lb.face_total) }}</b> <span class="muted">ECX</span></div>
                @if (lb.wtd_avg_maturity) {<div><div class="hint">average maturity</div><b>block {{ lb.wtd_avg_maturity | number }}</b></div>}
                @if (lb.face_matches === false) {<div><div class="hint">state</div><b class="neg">the house's own count says {{ fx.sats(lb.recorded_face) }} ECX</b></div>}
              </div>
              <app-fb-bills [bills]="lb.bills" [tip]="(tip$ | async) ?? null" empty="This house holds no bill."></app-fb-bills>
            }
          }
        </div>
      }
    }
  </div>`,
})
export class FreebankHousePage implements OnInit {
  tabs = CREDIT_TABS;
  fx = F;
  dl = deadline;
  id = '';
  membersPage = MEMBERS_PAGE;
  /** the start address of each members page seen (the first: none) */
  memberStarts: (string | null)[] = [null];
  private membersStart$ = new BehaviorSubject<string | null>(null);
  house$: Observable<FbLoaded<House>>;
  members$: Observable<FbLoaded<HouseMember[]>>;
  claims$: Observable<FbLoaded<TokenClaims>>;
  book$: Observable<FbLoaded<LoanBook>>;
  tip$: Observable<number | null>;

  constructor(private route: ActivatedRoute, private api: FreebankApiService, private live: FreebankLiveService, private seo: SeoService) {}

  ngOnInit(): void {
    this.tip$ = this.live.tip$;
    const id$ = this.route.paramMap.pipe(map(p => p.get('id') ?? ''), shareReplay(1));
    id$.subscribe(id => {
      this.id = id;
      this.memberStarts = [null];
      this.membersStart$.next(null);
      this.seo.setTitle(`${PROFILE.name}: house ${id}`);
    });
    const num$ = id$.pipe(map(id => /^\d{1,9}$/.test(id) ? Number(id) : null));
    const req = <T>(f: (n: number) => Observable<T>) => num$.pipe(switchMap(n => n === null ? of({ loading: false, error: { status: 400, message: 'Not a valid id' } } as FbLoaded<T>) : fbLoaded(f(n))));
    this.house$ = req(n => this.api.rpc$<House>('gethouse', n)).pipe(shareReplay(1));
    this.members$ = combineLatest([num$, this.membersStart$]).pipe(
      switchMap(([n, start]) => n === null ? of({ loading: false } as FbLoaded<HouseMember[]>)
        : fbLoaded(this.api.rpc$<HouseMember[]>('listhousemembers', n, start ?? '', MEMBERS_PAGE + (start ? 1 : 0)).pipe(
          // "start" is inclusive: the page after drops the address it starts at
          map(ms => start ? (ms ?? []).filter(x => x.address !== start) : (ms ?? []))))),
    );
    this.claims$ = req(n => this.api.rpc$<TokenClaims>('gettokenclaims', n));
    this.book$ = req(n => this.api.rpc$<LoanBook>('listloanbook', n));
  }

  membersNext(last: string): void {
    this.memberStarts.push(last);
    this.membersStart$.next(last);
  }

  membersFirst(): void {
    this.memberStarts = [null];
    this.membersStart$.next(null);
  }
}
