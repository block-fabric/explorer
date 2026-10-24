import { ChangeDetectionStrategy, Component, Input, OnChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject, Observable, combineLatest, map, shareReplay, startWith, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ChainApiService } from '@app/chain/chain-api.service';
import { CxColumn } from '@app/chain/components/chain-table/chain-table.component';
import { FlushApiService, FlushLoaded, flushLoaded, flushResult } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS, STAKE_TABS } from '../flush-kit';
import { FeeShare, FlushFees, FlushStats, FlushTreasury } from '../flush.interfaces';
import * as F from '../flush-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];
/** the ranges of GET /api/v1/flush/block-fees (how far back the backend reads its block index) */
const RANGES = [{ id: '24h', label: '24 h' }, { id: '48h', label: '48 h' }, { id: '7d', label: '7 days' }, { id: '30d', label: '30 days' }];

/** the tones of a split: the chain's accent for the main recipient, blue for the chain's security, amber for the treasury */
const ACCENT = 'var(--chain-accent, #7d94ab)';
const SECURITY = '#5aa6ff';
const TREASURY = '#f5b83d';
const TONE: Record<string, string> = {
  liquidity_providers: ACCENT, creator: ACCENT, validators: ACCENT, security: SECURITY, bidder: SECURITY, treasury: TREASURY,
};
const LABEL: Record<string, string> = {
  liquidity_providers: 'Liquidity providers', creator: 'Creator', security: 'Security (BMM bidder and validators)', treasury: 'Treasury',
};

/** a recipient's part of a fee */
export interface SplitPart { label: string; bps: number; color: string }

function parts(shares: FeeShare[] | null | undefined): SplitPart[] {
  return (shares ?? []).map(s => ({ label: LABEL[s.to] ?? F.shareLabel(s.to), bps: Number(s.bps) || 0, color: TONE[s.to] ?? '#9aa4b2' }));
}

/** A fee's split among its recipients: a segmented bar and its legend */
@Component({
  selector: 'app-flush-split',
  standalone: true,
  imports: [CommonModule],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="seg" role="img" [attr.aria-label]="summary">
      @for (p of shown; track p.label) {<span [style.flex-grow]="p.bps" [style.--seg]="p.color" [title]="p.label + ': ' + fx.bps(p.bps)"></span>}
    </div>
    <div class="legend">
      @for (p of parts; track p.label) {<span [style.--seg]="p.color"><i></i>{{ p.label }}<b>{{ fx.bps(p.bps) }}</b></span>}
    </div>`,
})
export class FlushSplitComponent implements OnChanges {
  @Input() parts: SplitPart[] = [];
  fx = F;
  shown: SplitPart[] = [];
  summary = '';

  ngOnChanges(): void {
    this.shown = (this.parts ?? []).filter(p => p.bps > 0);
    this.summary = (this.parts ?? []).map(p => `${p.label} ${F.bps(p.bps)}`).join(', ');
  }
}

/** a block of the range with its fees split as the split in force now splits them */
interface FeeBlock {
  hash: string;
  height: number;
  time: number;
  kind: 'pos' | 'bmm' | null;
  fees: number;
  bidder: number;
  validators: number;
  bidderBps: number | null;
}

/** GET /api/v1/flush/block-fees */
interface BlockFeesPage {
  range: string;
  page: number;
  size: number;
  total: number;
  totals: {
    blocks: number; withFees: number; fees: number; fromHeight: number | null; toHeight: number | null;
    byKind: { pos: number; bmm: number; unknown: number }; unknownBlocks: number; beyondKinds: number;
  };
  indexedFrom: { height: number | null; time: number | null };
  blocks: { height: number; hash: string; time: number; fees: number; txs: number; kind: 'pos' | 'bmm' | null }[];
}
interface BlockFeesView { page: BlockFeesPage; rows: FeeBlock[]; bidder: number | null; validators: number | null }

/**
 * /fees: where every fee on Flush goes: the network fees of a block (the BMM bidder and the validators, getposinfo's
 * feesplit), the DEX's swap fees and the launches' fees (GET market/fees), the treasury (GET market/treasury), and the
 * blocks of a range (24 h to 30 days) and their fees split by their kind, a page at a time (GET /api/v1/flush/block-fees)
 */
@Component({
  selector: 'app-flush-fees-page',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, FlushSplitComponent],
  styleUrls: STYLES,
  styles: [`.share { min-width: 90px; margin: 0; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-flush-head title="Fees" sub="Where every fee on Flush goes: a block's fees to the chain's security, a swap's to its pool, security and the treasury, a launch's to its creator, the treasury and security" [tabs]="tabs" active="/fees"></app-flush-head>
    @if (fees$ | async; as fv) {<app-flush-state [state]="fv" what="Fees" [list]="true" [height]="120"></app-flush-state>}
    <div class="kpis">
      @if ((pos$ | async)?.data?.feesplit; as fs) {
        <div class="kpi"><div class="l">Network split now</div><div class="v">{{ fx.bps(fs.bidderbps) }} <span class="muted">/</span> {{ fx.bps(fs.validatorsbps) }}</div>
          <div class="s">BMM bidder / validators, a block of stake · a BMM block: {{ fx.bps(fs.bmmbidderbps) }} to its bidder</div></div>
      }
      @if ((fees$ | async)?.data; as f) {
        <div class="kpi"><div class="l">Default swap fee</div><div class="v">{{ fx.ppm(f.default_pool_fee_ppm) }}</div>
          <div class="s">{{ f.dynamic_fees ? 'dynamic fees on' : 'fixed tiers' }}@if ((stats$ | async)?.data; as st) { · {{ fx.compact(st.volume_24h) }} ECX traded in 24 h}</div></div>
        <div class="kpi"><div class="l">Launch fee</div><div class="v">{{ fx.ppm(f.launch_fee_ppm) }}</div><div class="s">of a trade on a bonding curve, until it raises {{ f.launch_graduation_ecx | number }} ECX</div></div>
      }
      @if ((treasury$ | async)?.data; as t) {
        <div class="kpi"><div class="l">Treasury</div><div class="v">{{ fx.amount(t.balance_ecx, 4) }} <span class="muted">ECX</span></div><div class="s">held by the chain itself · <a routerLink="/treasury">its page</a></div></div>
        <div class="kpi"><div class="l">Treasury inflow, 24 h</div><div class="v">+{{ fx.amount(t.inflow_24h_ecx, 4) }}</div><div class="s">ECX from swaps and launches</div></div>
        <div class="kpi"><div class="l">Security paid</div><div class="v">{{ fx.amount(t.security_paid_ecx, 4) }}</div><div class="s">ECX of the DEX's fees to the BMM bidder and validators</div></div>
      }
    </div>

    <h2>Where a fee goes</h2>
    <div class="grid3">
      <div class="card-box">
        <h3>Network fees <span class="hint">a block's transaction fees</span></h3>
        @if (pos$ | async; as pv) {
          @if (pv.data?.feesplit; as fs) {
            <app-flush-split [parts]="networkParts(fs)"></app-flush-split>
            <p class="hint mt-3 mb-0">A block of stake pays its fees to the bidder of the last BMM block and to the validators' pool, shared by stake each epoch;
              a BMM block pays {{ fx.bps(fs.bmmbidderbps) }} to its own bidder, the rest to the validators. The split follows how often eCash carries a BMM block
              (one every {{ fs.spacing }} s now, against a target of {{ fs.targetspacing }} s){{ fs.active ? '' : '; not in force yet' }}.
              @if (minRelay$ | async; as mr) { A transaction pays at least {{ mr }} ECX per kvB.}</p>
          } @else if (!pv.loading) {<p class="muted mb-0">The network fee split is not available.</p>}
        }
      </div>
      <div class="card-box">
        <h3>DEX swaps <span class="hint">a pool's fee on a swap</span></h3>
        @if ((fees$ | async)?.data; as f) {
          <app-flush-split [parts]="swapParts(f)"></app-flush-split>
          <p class="hint mt-3 mb-0">A swap pays its pool's fee tier: most of it stays in the pool for its liquidity providers; the security part goes to the BMM bidder
            and the validators, the treasury part to the treasury (the protocol's share: {{ fx.ppm(f.protocol_fee_share_ppm) }} of the fee).</p>
        }
      </div>
      <div class="card-box">
        <h3>Launches <span class="hint">the fee of a trade on a curve</span></h3>
        @if ((fees$ | async)?.data; as f) {
          <app-flush-split [parts]="launchParts(f)"></app-flush-split>
          <p class="hint mt-3 mb-0">A buy or sale on a bonding curve pays {{ fx.ppm(f.launch_fee_ppm) }} in ECX: the creator's part waits until it is claimed
            (by anyone, paid to the creator), the rest goes to the treasury and the chain's security.</p>
        }
      </div>
    </div>

    <div class="grid2 mt-3">
      <div class="card-box">
        <h3>Pool fee tiers <span class="hint">by pool kind</span></h3>
        @if ((fees$ | async)?.data; as f) {
          <table class="table table-borderless table-sm">
            <thead><tr><th>Kind</th><th>Tiers</th></tr></thead>
            <tbody>
              @for (k of f.kinds; track k.curve) {
                <tr><td class="nowrap">{{ fx.kindLabel(k.curve) }}</td>
                  <td>@for (t of k.fee_tiers_ppm; track t) {<span class="pill me-1" [class.on]="t === f.default_pool_fee_ppm" [title]="t === f.default_pool_fee_ppm ? 'the default tier' : ''">{{ fx.ppm(t) }}</span>}</td></tr>
              }
              <tr><td class="nowrap">{{ fx.kindLabel('launch') }}</td><td><span class="pill me-1">{{ fx.ppm(f.launch_fee_ppm) }}</span><span class="muted">the launch fee</span></td></tr>
              <tr><td class="nowrap">{{ fx.kindLabel('book') }}</td><td><span class="muted">no fee: a book clears at one price per block</span></td></tr>
            </tbody>
          </table>
          <p class="hint mt-2 mb-0">A pool's creator picks its tier; the highlighted one is the default (a pair's default pool).
            {{ f.dynamic_fees ? 'Dynamic fees are on: a pool may charge more than its tier while its price moves fast.' : '' }}</p>
        }
      </div>
      <div class="card-box">
        <h3>Treasury inflows <span class="hint">by block</span></h3>
        @if (treasury$ | async; as tv) {
          <app-flush-state [state]="tv" what="Treasury" [list]="true" [height]="160"></app-flush-state>
          @if (tv.data; as t) {
            <app-flush-inflows [inflows]="t.inflows" [pageSize]="10"></app-flush-inflows>
            <p class="hint mt-2 mb-0">{{ t.reason }}. Security parts of fees paid in an asset other than ECX stay in the treasury, held per asset.</p>
          }
        }
      </div>
    </div>

    <h2>Block fees <span class="hint">every block of the range, its fees split by its kind, a page at a time</span></h2>
    <div class="filters">
      <div class="chips">
        @for (r of ranges; track r.id) {<button class="chip" [class.on]="q.range === r.id" (click)="setQuery({ range: r.id, page: 0 })">{{ r.label }}</button>}
      </div>
      <div class="chips"><button class="chip" [class.on]="q.feesOnly" (click)="setQuery({ feesOnly: !q.feesOnly, page: 0 })">Only blocks with fees</button></div>
    </div>
    @if (blocks$ | async; as bv) {
      <app-flush-state [state]="bv" what="Block fees" [list]="true" [height]="240"></app-flush-state>
      @if (bv.data; as v) {
        <div class="kpis">
          <div class="kpi"><div class="l">Blocks</div><div class="v">{{ v.page.totals.blocks | number }}</div>
            <div class="s">@if (v.page.totals.fromHeight !== null) { {{ v.page.totals.fromHeight | number }} to {{ v.page.totals.toHeight | number }}} @else {none in the range}</div></div>
          <div class="kpi"><div class="l">With fees</div><div class="v">{{ v.page.totals.withFees | number }}</div>
            <div class="bar mt-1"><div class="fill" [style.width.%]="v.page.totals.blocks ? 100 * v.page.totals.withFees / v.page.totals.blocks : 0"></div></div>
            <div class="s mt-1">{{ pct(v.page.totals.blocks ? v.page.totals.withFees / v.page.totals.blocks : 0) }} of the blocks</div></div>
          <div class="kpi"><div class="l">Fees</div><div class="v">{{ fx.amount(v.page.totals.fees / 1e8) }} <span class="muted">ECX</span></div>
            <div class="s">{{ v.page.totals.fees | number }} sats in the range</div></div>
          <div class="kpi"><div class="l">To BMM bidders</div><div class="v">@if (v.bidder !== null) { {{ fx.amount(v.bidder / 1e8) }} <span class="muted">ECX</span>} @else {–}</div>
            <div class="s">BMM blocks {{ fx.amount(v.page.totals.byKind.bmm / 1e8) }} ECX of fees</div></div>
          <div class="kpi"><div class="l">To validators</div><div class="v">@if (v.validators !== null) { {{ fx.amount(v.validators / 1e8) }} <span class="muted">ECX</span>} @else {–}</div>
            <div class="s">blocks of stake {{ fx.amount(v.page.totals.byKind.pos / 1e8) }} ECX of fees</div></div>
        </div>
        <div class="box">
          <app-chain-table [rows]="v.rows" [columns]="blockCols" [serverTotal]="v.page.total" [serverPage]="v.page.page" [pageSize]="v.page.size"
            (pageChange)="setQuery({ page: $event.page, size: $event.size })" [trackBy]="trackBlock"
            [empty]="q.feesOnly ? 'No block with fees in the range.' : 'No block in the range.'">
            <ng-template cxCell="height" let-b><a [routerLink]="['/block', b.hash]">{{ b.height | number }}</a></ng-template>
            <ng-template cxCell="time" let-b><app-time kind="since" [time]="b.time" [fastRender]="true"></app-time></ng-template>
            <ng-template cxCell="kind" let-b><span class="pill" [class.on]="b.kind === 'bmm'">{{ b.kind === 'bmm' ? 'BMM block' : b.kind === 'pos' ? 'block of stake' : 'not known' }}</span></ng-template>
            <ng-template cxCell="fees" let-b>@if (b.fees > 0) {<span>{{ fx.amount(b.fees / 1e8) }}</span><span class="muted ms-1">ECX</span>} @else {<span class="muted">no fee</span>}</ng-template>
            <ng-template cxCell="bidder" let-b>@if (b.bidderBps !== null && b.fees > 0) {<span>{{ fx.amount(b.bidder / 1e8) }}</span><span class="muted ms-1">{{ fx.bps(b.bidderBps) }}</span>} @else {<span class="muted">–</span>}</ng-template>
            <ng-template cxCell="validators" let-b>@if (b.bidderBps !== null && b.fees > 0) {<span>{{ fx.amount(b.validators / 1e8) }}</span><span class="muted ms-1">{{ fx.bps(10000 - b.bidderBps) }}</span>} @else {<span class="muted">–</span>}</ng-template>
            <ng-template cxCell="split" let-b>@if (b.bidderBps !== null && b.fees > 0) {<div class="share" [title]="fx.bps(b.bidderBps) + ' to the BMM bidder, ' + fx.bps(10000 - b.bidderBps) + ' to the validators'"><span class="b" [style.width.%]="b.bidderBps / 100"></span><span class="v" [style.width.%]="100 - b.bidderBps / 100"></span></div>}</ng-template>
          </app-chain-table>
          <p class="hint mt-2 mb-0">Each block's transaction fees, from this explorer's block index, split at the split in force now: a BMM block's at its bidder's part,
            a block of stake's between the last BMM bidder and the validators' pool (a past block was split at the split of its own time, which may differ).
            @if (v.page.totals.unknownBlocks) { The kinds of {{ v.page.totals.unknownBlocks | number }} blocks with fees are still being read: their fees are in neither part yet.}
            @if (v.page.indexedFrom.height !== null && v.page.indexedFrom.height > 0) { The index starts at block {{ v.page.indexedFrom.height | number }}.}</p>
        </div>
      }
    }
  </div>`,
})
export class FlushFeesPage implements OnInit {
  tabs = STAKE_TABS;
  fx = F;
  ranges = RANGES;
  q = { range: '48h', page: 0, size: 25, feesOnly: false };
  private query$ = new BehaviorSubject(this.q);
  fees$: Observable<FlushLoaded<FlushFees>>;
  treasury$: Observable<FlushLoaded<FlushTreasury>>;
  stats$: Observable<FlushLoaded<FlushStats>>;
  pos$: Observable<FlushLoaded<any>>;
  blocks$: Observable<FlushLoaded<BlockFeesView>>;
  minRelay$: Observable<string | null>;
  blockCols: CxColumn<FeeBlock>[] = [
    { key: 'height', label: 'Block' },
    { key: 'time', label: 'Time', nowrap: true, hide: 'sm' },
    { key: 'kind', label: 'Kind' },
    { key: 'fees', label: 'Fees', align: 'right', nowrap: true },
    { key: 'bidder', label: 'BMM bidder', align: 'right', nowrap: true },
    { key: 'validators', label: 'Validators', align: 'right', nowrap: true },
    { key: 'split', label: 'Split', hide: 'md' },
  ];
  trackBlock = (b: FeeBlock) => b.hash;

  constructor(private api: FlushApiService, private chainApi: ChainApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Flush fees: where every fee goes');
    const tick$ = timer(0, 30000);
    this.fees$ = flushLoaded(this.api.market$<FlushFees>('fees')).pipe(shareReplay(1));
    this.treasury$ = flushLoaded(this.api.market$<FlushTreasury>('treasury')).pipe(shareReplay(1));
    this.stats$ = flushLoaded(this.api.market$<FlushStats>('stats')).pipe(shareReplay(1));
    this.pos$ = tick$.pipe(switchMap(() => flushResult(this.api.rpc$<any>('getposinfo'))), startWith({ loading: true } as FlushLoaded<any>), shareReplay(1));
    this.minRelay$ = this.fees$.pipe(map(f => f.data?.min_relay_fee_ecx_per_kvb ? F.amount(f.data.min_relay_fee_ecx_per_kvb) : null));
    const split$ = this.pos$.pipe(map(p => p.data?.feesplit ?? null));
    // a page of the range: on a change of range, page or size, and every 30 s
    this.blocks$ = combineLatest([this.query$, tick$]).pipe(
      switchMap(([q]) => flushResult(this.chainApi.get<BlockFeesPage>('flush/block-fees', {
        range: q.range, page: q.page, size: q.size, fees: q.feesOnly ? 1 : null,
      }).pipe(switchMap(page => split$.pipe(map(fs => this.view(page, fs))))))),
      startWith({ loading: true } as FlushLoaded<BlockFeesView>),
      shareReplay(1),
    );
  }

  networkParts(fs: any): SplitPart[] {
    return [
      { label: 'BMM bidder', bps: Number(fs.bidderbps) || 0, color: TONE['bidder'] },
      { label: 'Validators', bps: Number(fs.validatorsbps) || 0, color: TONE['validators'] },
    ];
  }

  swapParts(f: FlushFees): SplitPart[] {
    return parts(f.swap_split);
  }

  launchParts(f: FlushFees): SplitPart[] {
    return parts(f.launch_split);
  }

  setQuery(change: Partial<{ range: string; page: number; size: number; feesOnly: boolean }>): void {
    this.q = { ...this.q, ...change };
    this.query$.next(this.q);
  }

  pct(x: number): string {
    return (100 * (x || 0)).toFixed(1) + '%';
  }

  /** a page with its rows split, and the range's fees by recipient (null: no split known) */
  private view(page: BlockFeesPage, fs: any): BlockFeesView {
    const rows = page.blocks.map(b => this.feeBlock(b, fs));
    const k = page.totals.byKind;
    const bidder = fs ? Math.floor(k.bmm * (Number(fs.bmmbidderbps) || 0) / 10000) + Math.floor(k.pos * (Number(fs.bidderbps) || 0) / 10000) : null;
    return { page, rows, bidder, validators: bidder === null ? null : k.bmm + k.pos - bidder };
  }

  private feeBlock(b: BlockFeesPage['blocks'][number], fs: any): FeeBlock {
    const kind = b.kind ?? null;
    const fees = Number(b.fees) || 0;
    const bidderBps = !fs || !kind ? null : Number(kind === 'bmm' ? fs.bmmbidderbps : fs.bidderbps) || 0;
    const bidder = bidderBps === null ? 0 : Math.floor(fees * bidderBps / 10000);
    return { hash: b.hash, height: b.height, time: b.time, kind, fees, bidder, validators: bidderBps === null ? 0 : fees - bidder, bidderBps };
  }
}
