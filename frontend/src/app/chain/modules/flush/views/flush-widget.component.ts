import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, combineLatest, forkJoin, map, of, shareReplay, switchMap, timer } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FlushApiService } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { FlushWidgetKind } from '../flush-widget-kinds';
import { FlushStats, FlushTreasury, LaunchSummary, Page, Pool, Trade } from '../flush.interfaces';
import * as F from '../flush-format';

const REFRESH = 30000;

/**
 * Flush's dashboard widgets, where the eCash explorer has its drivechain and mining widgets (placed by
 * app-drivechain-widget): the chain (tip, anchored and final tips, epoch and slot, validators), the DEX (24 h volume,
 * liquidity, launches live, treasury), the launches (closest to graduation and busiest), stake (validators by stake),
 * the drivechain (escrow on eCash, bundle, BMM coverage) and recent trades.
 */
@Component({
  selector: 'app-flush-widget',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: ['../../../components/drivechain-widget/drivechain-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .kv { width: 100%; font-size: 0.85rem; margin: 0; td { padding: 3px 4px; vertical-align: middle; } td:first-child { color: var(--transparent-fg); } }
    .big-row { flex-wrap: wrap; }
    .bar { height: 6px; border-radius: 3px; background: #ffffff10; overflow: hidden; min-width: 60px; .fill { height: 100%; background: var(--chain-accent, #38bdf8); } }
    .rows { width: 100%; font-size: 0.85rem; td { padding: 3px 4px; vertical-align: middle; } }
    .muted { color: var(--transparent-fg); } .mono { font-family: monospace; } .pos { color: #3bd16f; } .neg { color: #ff6b6b; }
    .pill { display: inline-block; font-size: 0.7rem; padding: 0 7px; border-radius: 10px; background: #ffffff14; }
    @media (max-width: 480px) { .big-value { font-size: 1.1rem; } }
  `],
  template: `
  <div class="card dc-card">
    <div class="card-body">
      @if (data$ | async; as d) {
        @if (d.error) {
          <p class="empty">{{ d.error }}</p>
        } @else {
          @switch (kind) {
            @case ('flush-chain') {
              <div class="big-row">
                <div class="big"><div class="big-value"><a [routerLink]="['/block', d.bci.bestblockhash]">{{ d.bci.blocks | number }}</a></div><div class="big-label">tip</div></div>
                <div class="big"><div class="big-value">@if (d.anchors?.anchoredtip) {<a [routerLink]="['/block', d.anchors.anchoredtip]">{{ d.anchors.anchoredheight | number }}</a>} @else {–}</div><div class="big-label">anchored</div></div>
                <div class="big"><div class="big-value">@if (d.anchors?.finaltip) {<a [routerLink]="['/block', d.anchors.finaltip]">{{ d.anchors.finalheight | number }}</a>} @else {–}</div><div class="big-label">final</div></div>
              </div>
              <table class="kv"><tbody>
                <tr><td>Epoch · slot</td><td>{{ d.pos?.epoch | number }} · {{ d.pos?.slot | number }} <span class="muted">({{ d.pos?.slotseconds }} s slots)</span></td></tr>
                <tr><td>Leader now</td><td>@if (d.pos?.leader) {<a [routerLink]="['/validator', d.pos.leader]" class="mono">{{ fx.shortId(d.pos.leader, 6) }}</a>} @else {–}@if (d.pos?.stalled) { <span class="pill">stalled</span>}</td></tr>
                <tr><td>Validators</td><td>{{ d.pos?.validators?.length ?? 0 }} · {{ fx.compact(d.pos?.staking?.bonded) }} ECX bonded</td></tr>
                <tr><td>Anchors</td><td>{{ d.anchors?.anchors | number }} · final at {{ d.anchors?.finalanchors }} · last at eCash {{ d.pos?.lastanchormainheight | number }}</td></tr>
              </tbody></table>
              <a class="more" routerLink="/stake">Stake and finality →</a>
            }
            @case ('flush-dex') {
              <div class="big-row">
                <div class="big"><div class="big-value">{{ fx.compact(d.stats?.volume_24h) }}</div><div class="big-label">ECX traded, 24 h</div></div>
                <div class="big"><div class="big-value">{{ fx.compact(d.stats?.liquidity_ecx) }}</div><div class="big-label">ECX in pools</div></div>
                <div class="big"><div class="big-value">{{ d.stats?.live ?? 0 }}</div><div class="big-label">launches live</div></div>
              </div>
              <table class="kv"><tbody>
                <tr><td>Pools</td><td>{{ (d.stats?.pools ?? 0) | number }} · swap fee {{ fx.bps(d.stats?.fees?.pool_fee_bps) }}</td></tr>
                <tr><td>Launches</td><td>{{ d.stats?.launches ?? 0 }} · {{ d.stats?.graduated ?? 0 }} graduated · {{ fx.compact(d.stats?.raised_total) }} ECX raised</td></tr>
                <tr><td>Treasury</td><td>@if (d.treasury) {<span>{{ fx.amount(d.treasury.balance_ecx, 4) }} ECX · +{{ fx.amount(d.treasury.inflow_24h_ecx, 4) }} in 24 h</span>} @else {<span class="muted">–</span>}</td></tr>
                <tr><td>All-time volume</td><td>{{ fx.compact(d.stats?.volume_total) }} ECX</td></tr>
              </tbody></table>
              <a class="more" routerLink="/pools">The DEX →</a>
            }
            @case ('flush-launches') {
              <table class="rows"><tbody>
                @for (l of d.launches; track l.id) {
                  <tr>
                    <td><app-flush-token [ticker]="l.ticker" [id]="l.id" [logo]="l.logo" [link]="false"></app-flush-token> <a [routerLink]="['/launch', l.ticker || l.id]" class="ms-1">→</a></td>
                    <td style="width: 34%"><div class="bar" [title]="fx.pct(l.progress, 1) + ' of the graduation amount'"><div class="fill" [style.width.%]="min100(l.progress)"></div></div></td>
                    <td class="text-end">{{ l.state === 'curve' ? fx.pct(l.progress, 0) : l.state }}</td>
                    <td class="text-end">{{ fx.compact(l.volume_24h) }} <span class="muted">ECX</span></td>
                  </tr>
                } @empty {<tr><td class="empty">No launch yet.</td></tr>}
              </tbody></table>
              <a class="more" routerLink="/launches">Launches →</a>
            }
            @case ('flush-stake') {
              <table class="rows"><tbody>
                @for (v of top(d.pos?.validators); track v.pubkey) {
                  <tr><td><a [routerLink]="['/validator', v.pubkey]" class="mono">{{ fx.shortId(v.pubkey, 6) }}</a>@if (v.pubkey === d.pos?.leader) { <span class="pill">leader</span>}</td>
                    <td style="width: 40%"><div class="bar"><div class="fill" [style.width.%]="share(d.pos, v) * 100"></div></div></td>
                    <td class="text-end">{{ fx.pct(share(d.pos, v) * 100, 1) }}</td></tr>
                } @empty {<tr><td class="empty">No validator in the current epoch's set.</td></tr>}
              </tbody></table>
              <table class="kv mt-1"><tbody>
                <tr><td>Fee split now</td><td>@if (d.pos?.feesplit; as fs) {<span>{{ fx.bps(fs.bidderbps) }} BMM bidder · {{ fx.bps(fs.validatorsbps) }} validators</span>}</td></tr>
                <tr><td>Evidence</td><td>{{ d.pos?.evidence ?? 0 }} double signatures known</td></tr>
              </tbody></table>
              <a class="more" routerLink="/stake">Validators →</a>
            }
            @case ('flush-peg') {
              <div class="big-row">
                <div class="big"><div class="big-value">{{ fx.compact(d.peg?.escrow?.amount) }}</div><div class="big-label">ECX in escrow on eCash</div></div>
                <div class="big"><div class="big-value">{{ d.cockpitSlot ? fx.pct(d.cockpitSlot.coverage * 100, 1) : '–' }}</div><div class="big-label">of eCash blocks carry a BMM block</div></div>
                <div class="big"><div class="big-value">{{ d.peg?.bundles?.length ?? 0 }}</div><div class="big-label">bundles on eCash</div></div>
              </div>
              <table class="kv"><tbody>
                <tr><td>Slot</td><td>{{ d.peg?.sidechain?.slot ?? profile.slot }} · {{ d.peg?.sidechain?.title || profile.name }}</td></tr>
                <tr><td>Bundle</td><td>@if (d.bundle) {<span>{{ d.bundle.status }} · {{ d.bundle.withdrawals | number }} withdrawals · {{ fx.amount(d.bundle.amount) }} ECX</span>} @else {<span class="muted">none</span>}</td></tr>
                @if (d.cockpitSlot; as s) {<tr><td>BMM bids</td><td>median {{ s.bidMedian | number }} sats · {{ s.accepts | number }} blocks carried in the last day</td></tr>}
              </tbody></table>
              <a class="more" routerLink="/peg">The peg and BMM →</a>
            }
            @case ('flush-trades') {
              <app-flush-trades [trades]="d.trades" [showPair]="true" empty="No trade yet."></app-flush-trades>
              <a class="more" routerLink="/pools">The DEX →</a>
            }
          }
        }
      } @else {<div class="skeleton-loader"></div><div class="skeleton-loader mt-2"></div><div class="skeleton-loader mt-2"></div>}
    </div>
  </div>`,
})
export class FlushWidgetComponent implements OnChanges {
  @Input() kind: FlushWidgetKind = 'flush-chain';
  profile = PROFILE;
  fx = F;
  data$: Observable<any>;

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    const safe = <T>(o: Observable<T>) => o.pipe(catchError(() => of(null)));
    const load = (): Observable<any> => {
      switch (this.kind) {
        case 'flush-chain':
          return combineLatest([this.api.rpc$<any>('getblockchaininfo'), safe(this.api.rpc$<any>('getanchorinfo', 1)), safe(this.api.rpc$<any>('getposinfo'))])
            .pipe(map(([bci, anchors, pos]) => ({ bci, anchors, pos })));
        case 'flush-dex':
          return combineLatest([this.api.market$<FlushStats>('stats'), safe(this.api.market$<FlushTreasury>('treasury'))]).pipe(map(([stats, treasury]) => ({ stats, treasury })));
        case 'flush-launches':
          return this.api.market$<Page<LaunchSummary>>('launches', { sort: 'volume', limit: 6 }).pipe(map(p => ({ launches: p.items })));
        case 'flush-stake':
          return this.api.rpc$<any>('getposinfo').pipe(map(pos => ({ pos })));
        case 'flush-peg':
          return combineLatest([this.api.rpc$<any>('getpeginfo'), safe(this.api.rpc$<any>('getwithdrawalbundle')), safe(this.api.drivechain$<any>('cockpit', { window: 144 }))])
            .pipe(map(([peg, bundle, cockpit]) => ({ peg, bundle, cockpitSlot: cockpit?.slots?.find((s: any) => s.slot === PROFILE.slot) ?? null })));
        case 'flush-trades':
        case 'flush-pools':
          return this.api.market$<Page<Pool>>('pools', { sort: 'volume', limit: 3 }).pipe(
            switchMap(p => p.items.length ? forkJoin(p.items.map(x => safe(this.api.market$<Page<Trade>>(`pools/${x.pool}/trades`, { limit: 6 })))) : of([])),
            map(pages => ({ trades: (pages as (Page<Trade> | null)[]).flatMap(pg => pg?.items ?? []).sort((a, b) => b.height - a.height || b.time - a.time).slice(0, 8) })),
          );
        default:
          return of({ error: 'Unknown widget' });
      }
    };
    this.data$ = timer(0, REFRESH).pipe(
      switchMap(() => load().pipe(catchError(() => of({ error: `${PROFILE.name}'s data cannot be reached right now.` })))),
      shareReplay(1),
    );
  }

  min100(n: number): number {
    return Math.max(0, Math.min(100, Number(n) || 0));
  }

  top(vs: any[] | undefined): any[] {
    return [...(vs ?? [])].sort((a, b) => b.stake - a.stake).slice(0, 6);
  }

  share(pos: any, v: any): number {
    const total = (pos?.validators ?? []).reduce((s: number, x: any) => s + (Number(x.stake) || 0), 0);
    return total ? v.stake / total : 0;
  }
}
