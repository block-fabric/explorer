import { ChangeDetectionStrategy, Component, Input, OnChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, catchError, map, of, shareReplay, startWith, switchMap, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ChainApiService } from '@app/chain/chain-api.service';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';
import { FlushApiService, FlushLoaded, flushLoaded, flushResult } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS, STAKE_TABS } from '../flush-kit';
import { FlushBlockMark } from '../flush-live.service';
import { FeeShare, FlushFees, FlushStats, FlushTreasury } from '../flush.interfaces';
import * as F from '../flush-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../flush-page.scss'];
/** how many of the newest blocks the fee split of blocks shows (one GET /api/v1/flush/blocks: at most 30) */
const RECENT_BLOCKS = 30;

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

/** a recent block with its fees split as the split in force now splits them */
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

/**
 * /fees: where every fee on Flush goes: the network fees of a block (the BMM bidder and the validators, getposinfo's
 * feesplit), the DEX's swap fees and the launches' fees (GET market/fees), the treasury (GET market/treasury), and the
 * newest blocks' fees split by their kind (upstream's /api/v1/blocks, GET /api/v1/flush/blocks for the kinds)
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

    <h2>Recent blocks' fees <span class="hint">the newest {{ recent }} blocks</span></h2>
    <div class="box">
      @if (blocks$ | async; as bv) {
        <app-flush-state [state]="bv" what="Blocks" [list]="true" [height]="240"></app-flush-state>
        @if (bv.data; as rows) {
          <app-chain-table [rows]="rows" [columns]="blockCols" [filters]="blockKinds" sort="height" [pageSize]="10" empty="No block yet." [trackBy]="trackBlock">
            <ng-template cxCell="height" let-b><a [routerLink]="['/block', b.hash]">{{ b.height | number }}</a></ng-template>
            <ng-template cxCell="time" let-b><app-time kind="since" [time]="b.time" [fastRender]="true"></app-time></ng-template>
            <ng-template cxCell="kind" let-b><span class="pill" [class.on]="b.kind === 'bmm'">{{ b.kind === 'bmm' ? 'BMM block' : b.kind === 'pos' ? 'block of stake' : 'not known' }}</span></ng-template>
            <ng-template cxCell="fees" let-b>{{ fx.amount(b.fees / 1e8) }} <span class="muted">ECX</span></ng-template>
            <ng-template cxCell="bidder" let-b>@if (b.bidderBps !== null) {<span>{{ fx.amount(b.bidder / 1e8) }}</span><span class="muted ms-1">{{ fx.bps(b.bidderBps) }}</span>} @else {<span class="muted">–</span>}</ng-template>
            <ng-template cxCell="validators" let-b>@if (b.bidderBps !== null) {<span>{{ fx.amount(b.validators / 1e8) }}</span><span class="muted ms-1">{{ fx.bps(10000 - b.bidderBps) }}</span>} @else {<span class="muted">–</span>}</ng-template>
            <ng-template cxCell="split" let-b>@if (b.bidderBps !== null && b.fees > 0) {<div class="share" [title]="fx.bps(b.bidderBps) + ' to the BMM bidder, ' + fx.bps(10000 - b.bidderBps) + ' to the validators'"><span class="b" [style.width.%]="b.bidderBps / 100"></span><span class="v" [style.width.%]="100 - b.bidderBps / 100"></span></div>} @else {<span class="muted">no fee</span>}</ng-template>
          </app-chain-table>
          <p class="hint mt-2 mb-0">Each block's transaction fees (upstream's totalFees) split at the split in force now: a BMM block's at its bidder's part, a block of
            stake's between the last BMM bidder and the validators' pool. A past block was split at the split of its own time, which may differ.</p>
        }
      }
    </div>
  </div>`,
})
export class FlushFeesPage implements OnInit {
  tabs = STAKE_TABS;
  fx = F;
  recent = RECENT_BLOCKS;
  fees$: Observable<FlushLoaded<FlushFees>>;
  treasury$: Observable<FlushLoaded<FlushTreasury>>;
  stats$: Observable<FlushLoaded<FlushStats>>;
  pos$: Observable<FlushLoaded<any>>;
  blocks$: Observable<FlushLoaded<FeeBlock[]>>;
  minRelay$: Observable<string | null>;
  blockCols: CxColumn<FeeBlock>[] = [
    { key: 'height', label: 'Block', sort: b => b.height },
    { key: 'time', label: 'Time', sort: b => b.time, nowrap: true, hide: 'sm' },
    { key: 'kind', label: 'Kind', sort: b => b.kind ?? '' },
    { key: 'fees', label: 'Fees', align: 'right', sort: b => b.fees, nowrap: true },
    { key: 'bidder', label: 'BMM bidder', align: 'right', sort: b => b.bidder, nowrap: true },
    { key: 'validators', label: 'Validators', align: 'right', sort: b => b.validators, nowrap: true },
    { key: 'split', label: 'Split', hide: 'md' },
  ];
  blockKinds: CxFilter<FeeBlock>[] = [{ label: 'Kind', options: [
    { label: 'BMM blocks', test: b => b.kind === 'bmm' }, { label: 'blocks of stake', test: b => b.kind === 'pos' },
  ] }];
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
    this.blocks$ = tick$.pipe(
      switchMap(() => flushResult(this.recentBlocks$())),
      startWith({ loading: true } as FlushLoaded<FeeBlock[]>),
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

  /** the newest blocks (upstream's list, two pages of 15) with their kinds (one GET flush/blocks) and the split now */
  private recentBlocks$(): Observable<FeeBlock[]> {
    return this.chainApi.get<any[]>('blocks').pipe(
      switchMap(first => {
        const last = first?.[first.length - 1];
        const more$ = last && first.length < RECENT_BLOCKS && last.height > 0
          ? this.chainApi.get<any[]>('blocks/' + (last.height - 1)).pipe(catchError(() => of([])))
          : of([]);
        return more$.pipe(map(more => [...(first ?? []), ...(more ?? [])].slice(0, RECENT_BLOCKS)));
      }),
      switchMap(blocks => {
        const kinds$ = blocks.length
          ? this.api.blocks$<FlushBlockMark>(blocks.map(b => b.id)).pipe(catchError(() => of({} as Record<string, FlushBlockMark | null>)))
          : of({} as Record<string, FlushBlockMark | null>);
        const split$ = this.pos$.pipe(map(p => p.data?.feesplit ?? null), catchError(() => of(null)));
        return kinds$.pipe(switchMap(kinds => split$.pipe(map(fs => blocks.map(b => this.feeBlock(b, kinds[b.id] ?? null, fs))))));
      }),
    );
  }

  private feeBlock(b: any, mark: FlushBlockMark | null, fs: any): FeeBlock {
    const kind = mark?.kind ?? null;
    const fees = Number(b?.extras?.totalFees) || 0;
    const bidderBps = !fs || !kind ? null : Number(kind === 'bmm' ? fs.bmmbidderbps : fs.bidderbps) || 0;
    const bidder = bidderBps === null ? 0 : Math.floor(fees * bidderBps / 10000);
    return { hash: b.id, height: b.height, time: b.timestamp, kind, fees, bidder, validators: bidderBps === null ? 0 : fees - bidder, bidderBps };
  }
}
