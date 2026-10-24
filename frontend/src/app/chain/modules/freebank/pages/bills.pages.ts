import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, combineLatest, map, of, shareReplay, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { FreebankApiService, FbLoaded, fbLoaded } from '../freebank-api.service';
import { FreebankLiveService } from '../freebank-live.service';
import { CREDIT_TABS, FB_PAGE_IMPORTS } from '../freebank-kit';
import { FbActivityComponent } from './activity.pages';
import { Bill, BillEndorsement, House, LoanBook } from '../freebank.interfaces';
import * as F from '../freebank-format';
import { CxColumn } from '@app/chain/components/chain-table/chain-table.component';

type Endorsement = BillEndorsement & { n: number };

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../freebank-page.scss'];

/** /bills: the bills of exchange (listbills), newest first, by status in the table's chips */
@Component({
  selector: 'app-freebank-bills-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Bills of exchange" sub="A drawer issues a bill that its acceptor (the drawee) signs and backs with an escrow; holders endorse it on, a house may discount it into its loan book, and at maturity the acceptor retires it or the holder claims the escrow" [tabs]="tabs" active="/bills"></app-fb-head>
    @if (view$ | async; as v) {
      <app-fb-state [state]="v" what="The bills" [height]="300"></app-fb-state>
      @if (v.data; as d) {
        <div class="kpis">
          <div class="kpi"><div class="l">Bills</div><div class="v">{{ d.bills.length | number }}</div><div class="s">{{ fx.ecx(d.face, 4) }} ECX of face in all · tip {{ d.tip | number }}</div></div>
          <div class="kpi"><div class="l">Active</div><div class="v">{{ d.counts['a'] ?? 0 | number }}</div><div class="s">{{ fx.ecx(d.faces['a'] ?? 0, 4) }} ECX of face</div></div>
          <div class="kpi"><div class="l">Retired</div><div class="v">{{ d.counts['r'] ?? 0 | number }}</div><div class="s">{{ fx.ecx(d.faces['r'] ?? 0, 4) }} ECX paid at maturity</div></div>
          <div class="kpi"><div class="l">Defaulted</div><div class="v" [class.neg]="!!d.counts['d']">{{ d.counts['d'] ?? 0 | number }}</div><div class="s">{{ d.counts['x'] ?? 0 | number }} disputed</div></div>
        </div>
        <div class="box">
          <app-fb-bills [bills]="d.bills" [tip]="d.tip" [statusFilter]="true" empty="No bill on the chain yet."></app-fb-bills>
        </div>
        <p class="note mt-2">Status on chain (freebank bill.h): active (issued or endorsed), retired (paid), defaulted, disputed (reserved for the dispute module).</p>
      }
    }
  </div>`,
})
export class FreebankBillsPage implements OnInit {
  tabs = CREDIT_TABS;
  fx = F;
  view$: Observable<FbLoaded<{ bills: Bill[]; counts: Record<string, number>; faces: Record<string, number>; face: number; tip: number | null }>>;

  constructor(private api: FreebankApiService, private live: FreebankLiveService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: bills of exchange`);
    this.view$ = fbLoaded(combineLatest([this.api.rpc$<Bill[]>('listbills'), this.live.tip$]).pipe(map(([bills, tip]) => {
      const all = [...(bills ?? [])].sort((a, b) => b.id - a.id);
      const counts: Record<string, number> = {};
      const faces: Record<string, number> = {};
      all.forEach(b => {
        counts[b.status] = (counts[b.status] ?? 0) + 1;
        faces[b.status] = (faces[b.status] ?? 0) + (Number(b.amount) || 0);
      });
      return { bills: all, counts, faces, face: all.reduce((s, b) => s + (Number(b.amount) || 0), 0), tip };
    })));
  }
}

/** /bill/:id: a bill (getbill): its terms, parties, holder, the house that holds it, its endorsements, its outpoints */
@Component({
  selector: 'app-freebank-bill-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS, FbActivityComponent],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head [title]="'Bill #' + id" [tabs]="tabs" active="/bills"></app-fb-head>
    @if (bill$ | async; as v) {
      <app-fb-state [state]="v" what="Bill" [id]="id" [height]="300"></app-fb-state>
      @if (v.data; as b) {
        <div class="title-row mb-2">
          <span class="pill" [ngClass]="fx.billTone(b.status)">{{ fx.billStatus(b.status) }}</span>
          @if (fx.billTerm(b, (tip$ | async) ?? null); as t) {@if (t.label) {<span class="pill" [ngClass]="t.tone">{{ t.label }}</span>}}
          @if (b.owner_house_id) {<span>in the loan book of <a [routerLink]="['/house', b.owner_house_id]">house {{ b.owner_house_id }}</a></span>}
        </div>
        <div class="kpis">
          <div class="kpi"><div class="l">Face</div><div class="v">{{ fx.ecx(b.amount) }} <span class="muted">ECX</span></div><div class="s">what the acceptor pays at maturity</div></div>
          <div class="kpi"><div class="l">Escrow</div><div class="v">{{ fx.ecx(b.escrow) }} <span class="muted">ECX</span></div><div class="s">the acceptor's bond</div></div>
          <div class="kpi"><div class="l">Issued</div><div class="v"><a [routerLink]="['/block', b.issued_height]">{{ b.issued_height | number }}</a></div><div class="s">block</div></div>
          <div class="kpi"><div class="l">Matures</div><div class="v"><a [routerLink]="['/block', b.maturity_height]">{{ b.maturity_height | number }}</a></div><div class="s">then {{ b.grace_blocks | number }} blocks of grace</div></div>
        </div>
        <div class="grid2 mt-3">
          <div class="card-box">
            <h3>The bill <span class="hint">getbill</span></h3>
            <table class="kv"><tbody>
              <tr><th>Bill id</th><td class="mono">{{ b.bill_id }}</td></tr>
              <tr><th>Issued by</th><td><a [routerLink]="['/tx', b.issue_txid]" class="mono">{{ b.issue_txid }}</a></td></tr>
              <tr><th>Escrow outpoint</th><td>@if (fx.outpoint(b.escrow_outpoint); as o) {<a [routerLink]="['/tx', o[0]]" [fragment]="'vout=' + o[1]" class="mono">{{ b.escrow_outpoint }}</a>} @else {<span class="mono muted">{{ b.escrow_outpoint }}</span>}</td></tr>
              <tr><th>Title outpoint</th><td>@if (fx.outpoint(b.title_outpoint); as o) {<a [routerLink]="['/tx', o[0]]" [fragment]="'vout=' + o[1]" class="mono">{{ b.title_outpoint }}</a>} @else {<span class="mono muted">{{ b.title_outpoint }}</span>}</td></tr>
              @if (b.encrypted_body) {<tr><th>Body</th><td class="muted">{{ b.encrypted_body.length / 2 | number }} bytes, encrypted to the parties</td></tr>}
            </tbody></table>
          </div>
          <div class="card-box">
            <h3>Parties</h3>
            <table class="kv"><tbody>
              <tr><th>Drawer</th><td class="mono">{{ b.drawer_pubkey }}</td></tr>
              <tr><th>Acceptor (drawee)</th><td class="mono">{{ b.acceptor_pubkey }}</td></tr>
              <tr><th>Holder</th><td class="mono">{{ b.holder_pubkey }}</td></tr>
              <tr><th>Held by a house</th><td>@if (b.owner_house_id) {<a [routerLink]="['/house', b.owner_house_id]">house {{ b.owner_house_id }}</a>} @else {<span class="muted">no</span>}</td></tr>
            </tbody></table>
          </div>
        </div>
        <h2>Endorsements <span class="hint">{{ b.endorsements?.length ?? 0 }}, oldest first</span></h2>
        <div class="box">
          <app-chain-table [rows]="endorsements(b)" [columns]="endorseCols" [search]="endorseMatches" searchPlaceholder="Key…" sort="n" [asc]="true"
            empty="Not endorsed: the holder is the one it was issued to.">
            <ng-template cxCell="n" let-e><span class="muted">{{ e.n }}</span></ng-template>
            <ng-template cxCell="from" let-e><span class="mono" [title]="e.from">{{ fx.shortId(e.from, 8) }}</span></ng-template>
            <ng-template cxCell="arrow" let-e><span class="muted">→</span></ng-template>
            <ng-template cxCell="to" let-e><span class="mono" [title]="e.to">{{ fx.shortId(e.to, 8) }}</span></ng-template>
            <ng-template cxCell="at" let-e><a [routerLink]="['/block', e.at_height]">{{ e.at_height | number }}</a></ng-template>
          </app-chain-table>
        </div>
        <h2>History <span class="hint">what happened to it after its issue, newest first</span></h2>
        <app-fb-activity [bill]="b.id" [limit]="25" empty="Nothing since its issue."></app-fb-activity>
      }
    }
  </div>`,
})
export class FreebankBillPage implements OnInit {
  tabs = CREDIT_TABS;
  fx = F;
  endorseCols: CxColumn<Endorsement>[] = [
    { key: 'n', label: '#', sort: e => e.n }, { key: 'from', label: 'From' }, { key: 'arrow', label: '' }, { key: 'to', label: 'To' },
    { key: 'at', label: 'At block', sort: e => e.at_height },
  ];
  endorseMatches = (e: Endorsement, q: string) => e.from.toLowerCase().includes(q) || e.to.toLowerCase().includes(q);
  private numbered = new WeakMap<Bill, Endorsement[]>();
  id = '';
  bill$: Observable<FbLoaded<Bill>>;
  tip$: Observable<number | null>;

  constructor(private route: ActivatedRoute, private api: FreebankApiService, private live: FreebankLiveService, private seo: SeoService) {}

  ngOnInit(): void {
    this.tip$ = this.live.tip$;
    this.bill$ = this.route.paramMap.pipe(map(p => p.get('id') ?? ''), switchMap(id => {
      this.id = id;
      this.seo.setTitle(`${PROFILE.name}: bill ${id}`);
      return /^\d{1,9}$/.test(id) ? fbLoaded(this.api.rpc$<Bill>('getbill', Number(id)))
        : of({ loading: false, error: { status: 400, message: 'Not a valid id' } } as FbLoaded<Bill>);
    }));
  }

  /** its endorsements, numbered in order (once per bill, so the table keeps its rows) */
  endorsements(b: Bill): Endorsement[] {
    let list = this.numbered.get(b);
    if (!list) {
      list = (b.endorsements ?? []).map((e, i) => ({ ...e, n: i + 1 }));
      this.numbered.set(b, list);
    }
    return list;
  }
}

/** /loanbook: the bills the houses hold (listloanbook), the whole chain's or one house's (?house=) */
@Component({
  selector: 'app-freebank-loanbook-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Loan book" sub="The bills the discount houses have bought (discounted), paying in their notes: what each house is owed, and when" [tabs]="tabs" active="/loanbook"></app-fb-head>
    @if (view$ | async; as v) {
      <app-fb-state [state]="v" what="The loan book" [height]="300"></app-fb-state>
      @if (v.data; as d) {
        <div class="filters">
          <div class="chips">
            <button class="chip" [class.on]="!d.house" (click)="setHouse(null)">All houses</button>
            @for (h of d.houses; track h.id) {<button class="chip" [class.on]="d.house === h.id" (click)="setHouse(h.id)">#{{ h.id }}<b>{{ fx.sats(h.loanbookface) }}</b></button>}
          </div>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="l">Bills held</div><div class="v">{{ d.book.count | number }}</div><div class="s">{{ d.house ? 'by house ' + d.house : 'by all houses' }}</div></div>
          <div class="kpi"><div class="l">Face</div><div class="v">{{ fx.sats(d.book.face_total) }} <span class="muted">ECX</span></div><div class="s">owed to {{ d.house ? 'it' : 'the houses' }} at maturity</div></div>
          @if (d.book.wtd_avg_maturity) {<div class="kpi"><div class="l">Average maturity</div><div class="v">{{ d.book.wtd_avg_maturity | number }}</div><div class="s">block, weighted by face</div></div>}
          @if (d.book.face_matches === false) {<div class="kpi"><div class="l">House's count</div><div class="v neg">{{ fx.sats(d.book.recorded_face) }}</div><div class="s">does not match the bills</div></div>}
        </div>
        <div class="box"><app-fb-bills [bills]="d.book.bills" [tip]="d.tip" sort="maturity" [asc]="true" empty="No bill held by a house."></app-fb-bills></div>
      }
    }
  </div>`,
})
export class FreebankLoanbookPage implements OnInit {
  tabs = CREDIT_TABS;
  fx = F;
  view$: Observable<FbLoaded<{ book: LoanBook; house: number | null; houses: House[]; tip: number | null }>>;

  constructor(private route: ActivatedRoute, private router: Router, private api: FreebankApiService, private live: FreebankLiveService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: loan book`);
    const houses$ = this.api.rpc$<House[]>('listhouses').pipe(map(hs => (hs ?? []).filter(h => h.loanbookface > 0).sort((a, b) => a.id - b.id)), shareReplay(1));
    this.view$ = this.route.queryParamMap.pipe(
      map(q => /^\d{1,9}$/.test(q.get('house') ?? '') ? Number(q.get('house')) : null),
      switchMap(house => fbLoaded(combineLatest([
        house ? this.api.rpc$<LoanBook>('listloanbook', house) : this.api.rpc$<LoanBook>('listloanbook'), houses$, this.live.tip$,
      ]).pipe(map(([book, houses, tip]) => ({
        book: { ...book, bills: [...(book?.bills ?? [])].sort((a, b) => a.maturity_height - b.maturity_height) }, house, houses, tip,
      }))))),
    );
  }

  setHouse(id: number | null): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { house: id } });
  }
}
