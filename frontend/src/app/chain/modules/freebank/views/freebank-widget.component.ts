import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, combineLatest, map, of, shareReplay, switchMap, timer } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FreebankApiService } from '../freebank-api.service';
import { FB_PAGE_IMPORTS } from '../freebank-kit';
import { Bill, House, LoanBook } from '../freebank.interfaces';
import * as F from '../freebank-format';

const REFRESH = 30000;

/** FreeBank's dashboard widgets (MODULE.dashboard), placed by app-drivechain-widget like a sidechain's */
export type FreebankWidgetKind = 'freebank-chain' | 'freebank-credit' | 'freebank-bmm' | 'freebank-houses' | 'freebank-peg' | 'freebank-bills';

/**
 * FreeBank's dashboard widgets, where the eCash explorer has its drivechain and mining widgets: the chain (tip, the
 * eCash chain as the node follows it, houses and bills), credit (houses by status, notes minted, deposits, bills, the
 * loan book), blind merged mining on eCash (coverage, bids, the latest BMM blocks), the houses (by escrow), the peg
 * (deposits from eCash, the withdrawal bundle) and the bills nearest to maturity.
 */
@Component({
  selector: 'app-freebank-widget',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: ['../../../components/drivechain-widget/drivechain-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .kv { width: 100%; font-size: 0.85rem; margin: 0; td { padding: 3px 4px; vertical-align: middle; } td:first-child { color: var(--transparent-fg); } }
    .big-row { flex-wrap: wrap; }
    .rows { width: 100%; font-size: 0.85rem; td { padding: 3px 4px; vertical-align: middle; } }
    .muted { color: var(--transparent-fg); } .pos { color: #3bd16f; } .neg { color: #ff6b6b; }
    .rows tr + tr td { border-top: 1px solid #ffffff0b; }
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
            @case ('freebank-chain') {
              <div class="big-row">
                <div class="big"><div class="big-value"><a [routerLink]="['/block', d.bci?.bestblockhash]">{{ d.bci?.blocks | number }}</a></div><div class="big-label">tip</div></div>
                <div class="big"><div class="big-value">{{ d.houses?.length ?? '–' }}</div><div class="big-label">discount houses</div></div>
                <div class="big"><div class="big-value">{{ d.active ?? '–' }}</div><div class="big-label">active bills</div></div>
              </div>
              <table class="kv"><tbody>
                <tr><td>eCash chain</td><td>@if (d.mainCount) {<app-fb-ecash kind="block" [id]="d.mainCount" [text]="(d.mainCount | number) + ' blocks'"></app-fb-ecash><span class="muted">&nbsp;as the node follows it</span>} @else {<span class="muted">–</span>}</td></tr>
                <tr><td>Slot</td><td>{{ profile.slot }} · blind merged mined on eCash</td></tr>
                <tr><td>Chain</td><td>{{ d.bci?.chain }} · {{ (d.bci?.size_on_disk ?? 0) / 1e9 | number:'1.0-1' }} GB on disk</td></tr>
              </tbody></table>
              <a class="more" routerLink="/blocks">Blocks →</a>
            }
            @case ('freebank-credit') {
              <div class="big-row">
                <div class="big"><div class="big-value">{{ fx.compact(d.minted) }}</div><div class="big-label">note units out</div></div>
                <div class="big"><div class="big-value">{{ fx.compact(d.billsFace) }}</div><div class="big-label">ECX in active bills</div></div>
                <div class="big"><div class="big-value">{{ fx.sats(d.book?.face_total) }}</div><div class="big-label">ECX in loan books</div></div>
              </div>
              <table class="kv"><tbody>
                <tr><td>Houses</td><td>@for (s of d.byStatus; track s[0]) {<span class="pill me-1" [ngClass]="fx.statusTone(s[0])">{{ s[1] }} {{ fx.houseStatus(s[0]) }}</span>} @empty {<span class="muted">none yet</span>}</td></tr>
                <tr><td>Escrow</td><td>{{ fx.ecx(d.escrow, 4) }} ECX · reserves attested {{ fx.ecx(d.reserves, 4) }} ECX</td></tr>
                <tr><td>Term deposits</td><td>{{ fx.num(d.deposits) }} note units</td></tr>
                <tr><td>Bills</td><td>{{ d.bills?.length ?? 0 }} · {{ d.active }} active · {{ d.book?.count ?? 0 }} held by houses</td></tr>
              </tbody></table>
              <a class="more" routerLink="/houses">Houses →</a>
            }
            @case ('freebank-bmm') {
              <div class="big-row">
                <div class="big"><div class="big-value">{{ d.slot ? (d.slot.coverage * 100 | number:'1.0-1') + '%' : '–' }}</div><div class="big-label">of eCash blocks carry one</div></div>
                <div class="big"><div class="big-value">{{ d.slot?.bidMedian !== undefined && d.slot?.bidMedian !== null ? (d.slot.bidMedian | number) : '–' }}</div><div class="big-label">median bid, sats</div></div>
              </div>
              <table class="rows"><tbody>
                @for (e of d.events; track $index) {
                  <tr><td><app-fb-ecash kind="block" [id]="e.blockHash" [text]="(e.height | number) + ''"></app-fb-ecash></td>
                    <td><app-time kind="since" [time]="e.time" [fastRender]="true"></app-time></td>
                    <td class="text-end">@if (e.bid !== null && e.bid !== undefined) {{{ e.bid | number }} <span class="muted">sats</span>}</td></tr>
                } @empty {<tr><td class="empty">No BMM block in the indexed eCash blocks.</td></tr>}
              </tbody></table>
              <a class="more" routerLink="/bmm">BMM on eCash →</a>
            }
            @case ('freebank-houses') {
              <table class="rows"><tbody>
                @for (h of d.top; track h.id) {
                  <tr><td><a [routerLink]="['/house', h.id]">#{{ h.id }}</a><span class="muted ms-2">{{ h.classid }}</span></td>
                    <td><span class="pill" [ngClass]="fx.statusTone(h.effective_status)">{{ fx.houseStatus(h.effective_status) }}</span></td>
                    <td class="text-end">{{ fx.ecx(h.activeescrow, 4) }} <span class="muted">ECX</span></td>
                    <td class="text-end" title="Attested reserve ratio">{{ fx.bps(h.attestedratiobps) }}</td></tr>
                } @empty {<tr><td class="empty">No discount house yet.</td></tr>}
              </tbody></table>
              <a class="more" routerLink="/houses">Discount houses →</a>
            }
            @case ('freebank-peg') {
              <div class="big-row">
                <div class="big"><div class="big-value">{{ d.slot ? (d.slot.deposits | number) : '–' }}</div><div class="big-label">deposits, last 144 eCash blocks</div></div>
                <div class="big"><div class="big-value">{{ d.bundle ? 'yes' : 'none' }}</div><div class="big-label">withdrawal bundle</div></div>
              </div>
              <table class="rows"><tbody>
                @for (e of d.deposits; track $index) {
                  <tr><td><app-fb-ecash kind="block" [id]="e.blockHash" [text]="(e.height | number) + ''"></app-fb-ecash></td>
                    <td><app-time kind="since" [time]="e.time" [fastRender]="true"></app-time></td>
                    <td class="text-end pos">{{ fx.sats(e.amount) }} ECX</td></tr>
                } @empty {<tr><td class="empty">No deposit in the indexed eCash blocks.</td></tr>}
              </tbody></table>
              <a class="more" routerLink="/peg">The peg →</a>
            }
            @case ('freebank-bills') {
              <table class="rows"><tbody>
                @for (b of d.soon; track b.id) {
                  <tr><td><a [routerLink]="['/bill', b.id]">#{{ b.id }}</a></td>
                    <td class="text-end">{{ fx.ecx(b.amount, 4) }} <span class="muted">ECX</span></td>
                    <td class="text-end">@if (fx.billTerm(b, d.tip); as t) {<span [class.neg]="t.tone === 'bad'">{{ t.label || ('block ' + (b.maturity_height | number)) }}</span>}</td></tr>
                } @empty {<tr><td class="empty">No active bill.</td></tr>}
              </tbody></table>
              <a class="more" routerLink="/bills">Bills →</a>
            }
          }
        }
      } @else {<div class="skeleton-loader"></div><div class="skeleton-loader mt-2"></div><div class="skeleton-loader mt-2"></div>}
    </div>
  </div>`,
})
export class FreebankWidgetComponent implements OnChanges {
  @Input() kind: FreebankWidgetKind = 'freebank-chain';
  profile = PROFILE;
  fx = F;
  data$: Observable<any>;

  constructor(private api: FreebankApiService) {}

  ngOnChanges(): void {
    const safe = <T>(o: Observable<T>, fallback: T | null = null) => o.pipe(catchError(() => of(fallback)));
    const slot$ = safe(this.api.drivechain$<any>('cockpit', { window: 144 })).pipe(map(c => c?.slots?.find((s: any) => s.slot === PROFILE.slot) ?? null));
    const load = (): Observable<any> => {
      switch (this.kind) {
        case 'freebank-chain':
          return combineLatest([this.api.rpc$<any>('getblockchaininfo'), safe(this.api.mainBlockCount$()),
            safe(this.api.rpc$<House[]>('listhouses'), []), safe(this.api.rpc$<Bill[]>('listbills'), [])])
            .pipe(map(([bci, mainCount, houses, bills]) => ({ bci, mainCount, houses, active: (bills ?? []).filter(b => b.status === 'a').length })));
        case 'freebank-credit':
          return combineLatest([this.api.rpc$<House[]>('listhouses'), safe(this.api.rpc$<Bill[]>('listbills'), []), safe(this.api.rpc$<LoanBook>('listloanbook'))])
            .pipe(map(([houses, bills, book]) => {
              const by = new Map<string, number>();
              (houses ?? []).forEach(h => by.set(h.effective_status, (by.get(h.effective_status) ?? 0) + 1));
              const sum = (k: keyof House) => (houses ?? []).reduce((s, h) => s + (Number(h[k]) || 0), 0);
              const active = (bills ?? []).filter(b => b.status === 'a');
              return {
                byStatus: [...by.entries()], minted: sum('mintedunits'), deposits: sum('depositunits'), escrow: sum('activeescrow'),
                reserves: sum('lastattestreserves'), bills, active: active.length, billsFace: active.reduce((s, b) => s + (Number(b.amount) || 0), 0), book,
              };
            }));
        case 'freebank-bmm':
          return combineLatest([slot$, safe(this.api.drivechain$<any[]>('events/bmm', { limit: 6 }), [])]).pipe(map(([slot, events]) => ({ slot, events })));
        case 'freebank-houses':
          return this.api.rpc$<House[]>('listhouses').pipe(map(hs => ({ top: [...(hs ?? [])].sort((a, b) => b.activeescrow - a.activeescrow).slice(0, 7) })));
        case 'freebank-peg':
          return combineLatest([slot$, safe(this.api.drivechain$<any[]>('events/deposits', { limit: 6 }), []), safe(this.api.rpc$<string>('getwithdrawalbundle'))])
            .pipe(map(([slot, deposits, bundle]) => ({ slot, deposits, bundle })));
        case 'freebank-bills':
          return combineLatest([this.api.rpc$<Bill[]>('listbills'), safe(this.api.rpc$<any>('getblockchaininfo'))]).pipe(map(([bills, bci]) => ({
            tip: Number(bci?.blocks) || null,
            soon: (bills ?? []).filter(b => b.status === 'a').sort((a, b) => a.maturity_height - b.maturity_height).slice(0, 7),
          })));
        default:
          return of({ error: 'Unknown widget' });
      }
    };
    this.data$ = timer(0, REFRESH).pipe(
      switchMap(() => load().pipe(catchError(() => of({ error: `${PROFILE.name}'s data cannot be reached right now.` })))),
      shareReplay(1),
    );
  }
}
