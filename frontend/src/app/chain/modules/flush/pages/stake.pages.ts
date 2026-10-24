import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, shareReplay, startWith, switchMap, tap, timer } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { SeoService } from '@app/services/seo.service';
import { FlushApiService, FlushLoaded, flushLoaded, flushResult } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS, STAKE_TABS } from '../flush-kit';
import * as F from '../flush-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];
const SCHEDULE_SHOWN = 120;

/** a validator's colour in the leader strip */
export function keyColor(k: string): string {
  let h = 0;
  for (const c of String(k).slice(0, 10)) {
    h = (h * 31 + c.charCodeAt(0)) % 360;
  }
  return `hsl(${h}, 55%, 62%)`;
}

/** /stake: Flush's proof of stake (getposinfo, getvalidators, getleaderschedule, getanchorinfo, listevidence) */
@Component({
  selector: 'app-flush-stake-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .strip { display: flex; gap: 2px; flex-wrap: wrap; }
    .strip .s { width: 14px; height: 22px; border-radius: 3px; display: inline-block; }
    .strip .s.past { opacity: 0.35; } .strip .s.now { outline: 2px solid var(--fg); }
    .strip .s.banned { background: repeating-linear-gradient(45deg, #ff6b6b55, #ff6b6b55 3px, transparent 3px, transparent 6px); }
    .strip .s.none { background: #ffffff14; }
  `],
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Stake" sub="Blocks of stake every slot, each signed by the slot's leader; BMM blocks and tickets on eCash anchor them, and enough anchors make them final" [tabs]="tabs" active="/stake"></app-flush-head>
    @if (pos$ | async; as v) {
      <app-flush-state [state]="v" what="Staking" [list]="true" [height]="300"></app-flush-state>
      @if (v.data; as p) {
        <div class="kpis">
          <div class="kpi"><div class="l">Slot</div><div class="v">{{ p.slot | number }}</div><div class="s">epoch {{ p.epoch | number }} · {{ p.slotseconds }} s a slot</div></div>
          <div class="kpi"><div class="l">Leader now</div><div class="v"><a [routerLink]="['/validator', p.leader]" class="mono" style="font-size: 1rem" [style.color]="color(p.leader)">{{ fx.shortId(p.leader, 6) }}</a></div><div class="s">{{ p.stalled ? 'stalled: no block of stake can be made now' : (p.active ? 'blocks of stake on' : 'blocks of stake off') }}</div></div>
          <div class="kpi"><div class="l">Validators</div><div class="v">{{ p.validators?.length ?? 0 }}</div><div class="s">in the current epoch's set</div></div>
          <div class="kpi"><div class="l">Bonded</div><div class="v">{{ fx.compact(p.staking?.bonded) }} <span class="muted">ECX</span></div><div class="s">{{ fx.amount(p.staking?.unbonding) }} unbonding · min {{ fx.amount(p.staking?.minstake) }}</div></div>
          <div class="kpi"><div class="l">Anchors</div><div class="v">{{ p.anchors | number }}</div><div class="s">last at eCash {{ p.lastanchormainheight | number }}</div></div>
          <div class="kpi"><div class="l">Pot</div><div class="v">{{ fx.amount(p.pot?.accrued, 4) }}</div><div class="s">ECX accrued · {{ fx.amount(p.pot?.paid, 4) }} paid · reserve {{ fx.amount(p.pot?.reserve, 4) }}</div></div>
          <div class="kpi"><div class="l">Evidence</div><div class="v">{{ p.evidence | number }}</div><div class="s">proofs of a leader signing twice</div></div>
        </div>

        <h2>Validators <span class="hint">epoch {{ (vals$ | async)?.data?.epoch | number }}</span></h2>
        <div class="box">
          @if (vals$ | async; as vs) {
            <app-flush-state [state]="vs" what="Validators" [height]="200"></app-flush-state>
            @if (vs.data; as vd) {
              <app-chain-table [rows]="vd.validators" [columns]="valCols" [filters]="valFilters(vd.epoch)" [search]="valMatches" searchPlaceholder="Validator key" sort="stake"
                  [pageSize]="25" [empty]="vd.known ? 'No validator in this epoch\\'s set.' : 'The set of this epoch is not known yet (its seed is not on record).'" [trackBy]="trackKey">
                <ng-template cxCell="pubkey" let-x><span class="me-1" [style.color]="color(x.pubkey)">●</span><a [routerLink]="['/validator', x.pubkey]" class="mono" [title]="x.pubkey">{{ fx.shortId(x.pubkey, 10) }}</a></ng-template>
                <ng-template cxCell="stake" let-x>{{ fx.amount(x.stake / 1e8) }} <span class="muted">ECX</span></ng-template>
                <ng-template cxCell="share" let-x><div class="progress-cell"><div class="bar"><div class="fill" [style.width.%]="100 * x.stake / (vd.totalstake || 1)"></div></div><div class="t">{{ fx.pct(100 * x.stake / (vd.totalstake || 1), 1) }}</div></div></ng-template>
                <ng-template cxCell="pool" let-x>{{ fx.pct(100 * poolShare(p, x.pubkey), 2) }}</ng-template>
                <ng-template cxCell="slots" let-x>{{ x.slots | number }}</ng-template>
                <ng-template cxCell="status" let-x>@if (x.banned) {<span class="pill bad">banned</span>} @else if (x.jaileduntilepoch && x.jaileduntilepoch > vd.epoch) {<span class="pill warn">jailed until epoch {{ x.jaileduntilepoch | number }}</span>} @else {<span class="pill ok">active</span>}</ng-template>
              </app-chain-table>
            }
          }
        </div>

        <h2>Leader schedule <span class="hint">the next {{ shown }} slots of the epoch</span></h2>
        <div class="box">
          @if (sched$ | async; as s) {
            <app-flush-state [state]="s" what="Leader schedule" [height]="60"></app-flush-state>
            @if (s.data; as sd) {
              <div class="strip">
                @for (x of upcoming(sd, p.slot); track x.slot) {
                  <span class="s" [class.now]="x.slot === p.slot" [class.banned]="!!x.banned" [class.none]="!x.leader && !x.banned" [style.background]="x.leader ? color(x.leader) : null"
                    [title]="'Slot ' + x.slot + ' at ' + time(x.time) + ': ' + (x.leader ? 'led by ' + x.leader : x.banned ? 'its leader ' + x.banned + ' is banned: nobody leads it' : 'no leader known')"></span>
                }
              </div>
              <div class="hint mt-2">Each cell a slot (hover for its leader and time); the outlined one is now. Epoch {{ sd.epoch | number }}: {{ sd.slots.length | number }} slots.</div>
            }
          }
        </div>

        <div class="grid2 mt-3">
          <div class="card-box">
            <h3>Anchors and finality <span class="hint">getanchorinfo</span></h3>
            @if (anchors$ | async; as a) {
              @if (a.data; as ad) {
                <table class="kv"><tbody>
                  <tr><th>Anchors</th><td>{{ ad.anchors | number }} · final at {{ ad.finalanchors }} anchor{{ ad.finalanchors === 1 ? '' : 's' }}</td></tr>
                  <tr><th>Anchored tip</th><td>@if (ad.anchoredtip) {<a [routerLink]="['/block', ad.anchoredtip]">{{ ad.anchoredheight | number }}</a>} @else {–}</td></tr>
                  <tr><th>Final tip</th><td>@if (ad.finaltip) {<a [routerLink]="['/block', ad.finaltip]">{{ ad.finalheight | number }}</a>} @else {–}</td></tr>
                  <tr><th>Skipped commitments</th><td>{{ ad.skipped?.length ?? 0 }} <span class="muted">(on record, not acknowledged by this chain)</span></td></tr>
                  <tr><th>Tickets known</th><td>{{ (ad.tickets?.length ?? ad.tickets ?? 0) | number }}</td></tr>
                </tbody></table>
                <div class="mt-3">
                  <app-chain-table [rows]="ad.recent" [columns]="anchorCols" [filters]="anchorKinds" sort="height" [pageSize]="10" empty="No anchor yet." [trackBy]="trackBlock">
                    <ng-template cxCell="height" let-r><a [routerLink]="['/block', r.block]">{{ r.height | number }}</a></ng-template>
                    <ng-template cxCell="kind" let-r><span class="pill" [class.on]="r.kind === 'bmm'">{{ r.kind === 'bmm' ? 'BMM block' : 'ticket' }}</span></ng-template>
                    <ng-template cxCell="anchored" let-r><a [routerLink]="['/block', r.anchored]">{{ r.anchoredheight | number }}</a></ng-template>
                    <ng-template cxCell="mainheight" let-r><app-flush-ecash kind="block" [id]="r.mainheight" [text]="(r.mainheight | number) + ''"></app-flush-ecash></ng-template>
                  </app-chain-table>
                </div>
              } @else if (!a.loading) {<p class="muted mb-0">Not available.</p>}
            }
          </div>
          <div class="card-box">
            <h3>Fee split <span class="hint">network fees and the DEX's security parts</span></h3>
            @if (p.feesplit; as fs) {
              <div class="share" [title]="(fs.bidderbps / 100) + '% to the BMM bidder, ' + (fs.validatorsbps / 100) + '% to the validators'"><span class="b" [style.width.%]="fs.bidderbps / 100"></span><span class="v" [style.width.%]="fs.validatorsbps / 100"></span></div>
              <table class="kv"><tbody>
                <tr><th>Blocks of stake</th><td>{{ fx.bps(fs.bidderbps) }} BMM bidder · {{ fx.bps(fs.validatorsbps) }} validators <span class="muted">(spacing {{ fs.spacing }} s, target {{ fs.targetspacing }} s; curve {{ fs.curve }})</span></td></tr>
                <tr><th>A BMM block now</th><td>{{ fx.bps(fs.bmmbidderbps) }} to its bidder <span class="muted">(spacing {{ fs.bmmspacing }} s)</span></td></tr>
                <tr><th>In force</th><td>{{ fs.active ? 'yes' : 'not yet' }}@if (fs.activationheight && fs.activationheight < 2147483647) {, from block {{ fs.activationheight | number }}}</td></tr>
                <tr><th>Validator pool</th><td>{{ fx.amount(fs.pool) }} ECX this epoch</td></tr>
              </tbody></table>
            }
            <p class="hint mb-0"><a routerLink="/fees">Where every fee on {{ profile.name }} goes →</a></p>
            <h3 class="mt-3">Evidence <span class="hint">leaders that signed two blocks for a slot</span></h3>
            @if (evidence$ | async; as e) {
              @if (e.data; as ed) {
                <app-chain-table [rows]="ed" [columns]="evidenceCols" [search]="evidenceMatches" searchPlaceholder="Validator key" sort="slot" [pageSize]="10"
                    empty="No evidence: no leader has signed twice.">
                  <ng-template cxCell="pubkey" let-x><a [routerLink]="['/validator', x.pubkey]" class="mono">{{ fx.shortId(x.pubkey, 6) }}</a></ng-template>
                  <ng-template cxCell="slot" let-x>{{ x.slot | number }}</ng-template>
                  <ng-template cxCell="hashes" let-x>@for (h of x.hashes; track h) {<a [routerLink]="['/block', h]" class="mono me-2">{{ fx.shortId(h, 5) }}</a>}</ng-template>
                </app-chain-table>
              }
            }
          </div>
        </div>
      }
    }
  </div>`,
})
export class FlushStakePage implements OnInit {
  tabs = STAKE_TABS;
  fx = F;
  profile = PROFILE;
  valCols: CxColumn<any>[] = [
    { key: 'pubkey', label: 'Validator', nowrap: true },
    { key: 'stake', label: 'Stake', align: 'right', sort: x => Number(x.stake), nowrap: true },
    { key: 'share', label: 'Share of stake', sort: x => Number(x.stake), hide: 'sm' },
    { key: 'pool', label: 'Pool share', align: 'right', sort: x => this.poolShare(this.pos, x.pubkey), hide: 'md' },
    { key: 'slots', label: 'Slots led', align: 'right', sort: x => Number(x.slots) },
    { key: 'status', label: 'Status', sort: x => x.banned ? 2 : x.jaileduntilepoch ? 1 : 0 },
  ];
  valMatches = (x: any, q: string) => String(x.pubkey).toLowerCase().includes(q);
  anchorCols: CxColumn<any>[] = [
    { key: 'height', label: 'Block', sort: r => Number(r.height) },
    { key: 'kind', label: 'Kind', sort: r => r.kind },
    { key: 'anchored', label: 'Anchors', sort: r => Number(r.anchoredheight) },
    { key: 'mainheight', label: 'eCash', sort: r => Number(r.mainheight) },
  ];
  anchorKinds: CxFilter<any>[] = [{ label: 'Kind', options: [{ label: 'BMM block', test: r => r.kind === 'bmm' }, { label: 'ticket', test: r => r.kind !== 'bmm' }] }];
  evidenceCols: CxColumn<any>[] = [
    { key: 'pubkey', label: 'Validator' },
    { key: 'slot', label: 'Slot', sort: x => Number(x.slot) },
    { key: 'hashes', label: 'Blocks' },
  ];
  evidenceMatches = (x: any, q: string) => String(x.pubkey).toLowerCase().includes(q);
  trackKey = (x: any) => x.pubkey;
  trackBlock = (r: any) => r.block;
  private pos: any = null;
  private statusFilters: { epoch: number; filters: CxFilter<any>[] } | null = null;
  shown = SCHEDULE_SHOWN;
  color = keyColor;
  pos$: Observable<FlushLoaded<any>>;
  vals$: Observable<FlushLoaded<any>>;
  sched$: Observable<FlushLoaded<any>>;
  anchors$: Observable<FlushLoaded<any>>;
  evidence$: Observable<FlushLoaded<any[]>>;

  constructor(private api: FlushApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush stake: validators and anchors');
    const tick$ = timer(0, 30000);
    this.pos$ = tick$.pipe(switchMap(() => flushResult(this.api.rpc$<any>('getposinfo'))), tap(v => this.pos = v.data ?? this.pos), startWith({ loading: true } as FlushLoaded<any>), shareReplay(1));
    this.vals$ = flushLoaded(this.api.rpc$<any>('getvalidators')).pipe(shareReplay(1));
    this.sched$ = tick$.pipe(switchMap(() => flushResult(this.api.rpc$<any>('getleaderschedule'))), startWith({ loading: true } as FlushLoaded<any>));
    this.anchors$ = tick$.pipe(switchMap(() => flushResult(this.api.rpc$<any>('getanchorinfo', 20))), startWith({ loading: true } as FlushLoaded<any>));
    this.evidence$ = flushLoaded(this.api.rpc$<any[]>('listevidence'));
  }

  /** the validators' status as chips (one array per epoch, so the table keeps its choice) */
  valFilters(epoch: number): CxFilter<any>[] {
    if (this.statusFilters?.epoch !== epoch) {
      this.statusFilters = { epoch, filters: [{ label: 'Status', options: [
        { label: 'active', test: x => !x.banned && !(x.jaileduntilepoch && x.jaileduntilepoch > epoch) },
        { label: 'jailed', test: x => !x.banned && !!x.jaileduntilepoch && x.jaileduntilepoch > epoch },
        { label: 'banned', test: x => !!x.banned },
      ] }] };
    }
    return this.statusFilters.filters;
  }

  poolShare(p: any, key: string): number {
    return Number((p?.validators ?? []).find((v: any) => v.pubkey === key)?.poolshare ?? 0);
  }

  /** the slots from now on (the epoch's), at most SCHEDULE_SHOWN */
  upcoming(s: any, now: number): any[] {
    const slots = s?.slots ?? [];
    const i = Math.max(0, slots.findIndex((x: any) => x.slot >= now) - 4);
    return slots.slice(i, i + SCHEDULE_SHOWN);
  }

  time(t: number): string {
    return new Date(t * 1000).toLocaleTimeString();
  }
}

/** /validator/:key: one validator (getvalidator): stake, its bond, unbonds, slots, offences */
@Component({
  selector: 'app-flush-validator-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Validator" [tabs]="tabs" active=""></app-flush-head>
    <div class="sub"><span class="id">{{ key }}</span> <app-clipboard [text]="key"></app-clipboard> · <a routerLink="/stake">all validators</a></div>
    @if (view$ | async; as v) {
      <app-flush-state [state]="v" what="Validator" [id]="key" [height]="300"></app-flush-state>
      @if (v.data; as x) {
        <div class="kpis">
          <div class="kpi"><div class="l">In the set</div><div class="v">{{ x.inset ? 'yes' : 'no' }}</div><div class="s">@if (x.index !== undefined) {position {{ x.index }} in the current epoch's set} @else {not in the current epoch's set}</div></div>
          <div class="kpi"><div class="l">Stake</div><div class="v">{{ fx.amount((x.stake ?? 0) / 1e8) }} <span class="muted">ECX</span></div><div class="s">its weight in leader selection</div></div>
          <div class="kpi"><div class="l">Slots</div><div class="v">{{ (x.slots ?? 0) | number }}</div><div class="s">led this epoch · next @if (x.nextslot) {slot {{ x.nextslot | number }}} @else {none within two epochs}</div></div>
          <div class="kpi"><div class="l">Offences</div><div class="v" [class.neg]="x.offences > 0">{{ x.offences | number }}</div><div class="s">proofs of a double signature known</div></div>
        </div>
        @if (x.bond; as b) {
          <div class="grid2">
            <div class="card-box"><h3>Bond</h3>
              <table class="kv"><tbody>
                <tr><th>Owner</th><td>@if (b.owner) {<app-flush-addr [address]="b.owner" [short]="false"></app-flush-addr>} @else {<span class="muted">none: a genesis validator that never bonded</span>}</td></tr>
                <tr><th>Bonded</th><td>{{ fx.amount(b.bonded) }} ECX@if (b.genesisstake) { <span class="muted">· genesis stake {{ fx.amount(b.genesisstake) }}</span>}</td></tr>
                <tr><th>Unbonding</th><td>{{ fx.amount(b.unbonding) }} ECX</td></tr>
                <tr><th>Status</th><td>@if (b.banned) {<span class="pill bad">banned for good</span>} @else if (b.jaileduntilepoch) {<span class="pill warn">jailed until epoch {{ b.jaileduntilepoch | number }}</span>} @else if (b.eligible) {<span class="pill ok">eligible</span>} @else {<span class="pill warn">not eligible (too little bonded)</span>}</td></tr>
                <tr><th>First bond</th><td>@if (b.firstbond) {<a [routerLink]="['/tx', b.firstbond.split(':')[0]]" class="mono">{{ b.firstbond }}</a>} @else {–}</td></tr>
                @if (b.firstbondanchor && !zero(b.firstbondanchor)) {<tr><th>Its anchor</th><td><a [routerLink]="['/block', b.firstbondanchor]" class="mono">{{ fx.shortId(b.firstbondanchor) }}</a></td></tr>}
              </tbody></table>
            </div>
            <div class="card-box"><h3>Unbonds <span class="hint">paid at an anchor count</span></h3>
              <app-chain-table [rows]="b.unbonds" [columns]="unbondCols" sort="anchor" [asc]="true" [pageSize]="10" empty="No unbond waiting.">
                <ng-template cxCell="amount" let-u>{{ fx.amount(u.amount) }} ECX</ng-template>
                <ng-template cxCell="anchor" let-u>{{ u.releaseanchor | number }}</ng-template>
              </app-chain-table>
              <p class="hint mt-2 mb-0">Unbonded coins wait {{ (pos$ | async)?.data?.staking?.unbondinganchors ?? '–' }} anchors before they are paid to the owner.</p>
            </div>
          </div>
        }
        <h2>Its slots this epoch</h2>
        <div class="box">
          @if (slots$ | async; as s) {
            @if (s.data; as sd) {
              <div class="d-flex flex-wrap gap-2">
                @for (x of sd; track x.slot) {<span class="pill" [title]="time(x.time)">{{ x.slot | number }}</span>} @empty {<span class="muted">No slot of this epoch.</span>}
              </div>
            }
          }
        </div>
        @if (evidence$ | async; as e) {
          @if (e.data?.length) {
            <h2>Evidence against it</h2>
            <div class="box">
              <app-chain-table [rows]="e.data" [columns]="evidenceCols" sort="slot" [pageSize]="10">
                <ng-template cxCell="slot" let-x>{{ x.slot | number }}</ng-template>
                <ng-template cxCell="hashes" let-x>@for (h of x.hashes; track h) {<a [routerLink]="['/block', h]" class="mono me-2">{{ fx.shortId(h) }}</a>}</ng-template>
              </app-chain-table>
            </div>
          }
        }
      }
    }
  </div>`,
})
export class FlushValidatorPage implements OnInit {
  tabs = STAKE_TABS;
  fx = F;
  unbondCols: CxColumn<any>[] = [
    { key: 'amount', label: 'Amount', align: 'right', sort: u => Number(u.amount) },
    { key: 'anchor', label: 'Paid at anchor', align: 'right', sort: u => Number(u.releaseanchor) },
  ];
  evidenceCols: CxColumn<any>[] = [{ key: 'slot', label: 'Slot', sort: x => Number(x.slot) }, { key: 'hashes', label: 'The two blocks' }];
  key = '';
  view$: Observable<FlushLoaded<any>>;
  pos$: Observable<FlushLoaded<any>>;
  slots$: Observable<FlushLoaded<any[]>>;
  evidence$: Observable<FlushLoaded<any[]>>;

  constructor(private api: FlushApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    const key$ = this.route.paramMap.pipe(map(p => String(p.get('key') ?? '')), tap(k => {
      this.key = k;
      this.seo.setTitle('Flush validator ' + F.shortId(k, 6));
    }), shareReplay(1));
    this.view$ = key$.pipe(switchMap(k => flushLoaded(this.api.rpc$<any>('getvalidator', k))));
    this.pos$ = flushLoaded(this.api.rpc$<any>('getposinfo'));
    this.slots$ = key$.pipe(switchMap(k => flushLoaded(this.api.rpc$<any>('getleaderschedule').pipe(map(s => (s?.slots ?? []).filter((x: any) => x.leader === k || x.banned === k))))));
    this.evidence$ = key$.pipe(switchMap(k => flushLoaded(this.api.rpc$<any[]>('listevidence').pipe(map(l => (l ?? []).filter(x => x.pubkey === k))))));
  }

  zero(h: string): boolean {
    return /^0+$/.test(h);
  }

  time(t: number): string {
    return new Date(t * 1000).toLocaleString();
  }
}
