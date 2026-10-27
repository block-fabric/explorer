import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Observable, catchError, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { DrivechainLiveService } from '@app/chain/drivechain-live.service';
import { PROFILE, slotColor, slotMarkId } from '@app/chain/profiles';

/**
 * Dashboard widgets of the drivechain (data: DrivechainLiveService, the cockpit over the newest 144 blocks):
 *   treasury  the ECX locked in each sidechain, as a bar and a list, with the share of the supply
 *   bmm       the newest blocks x sidechains, coverage and bids
 *   bundles   the pending withdrawal bundles: their votes against the threshold, the blocks they have left
 *   peg       the latest deposits and withdrawals
 *   mining    hashrate, the retarget, pools by coinbase tag, the halving
 */
@Component({
  selector: 'app-drivechain-widget',
  templateUrl: './drivechain-widget.component.html',
  styleUrls: ['./drivechain-widget.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrivechainWidgetComponent implements OnInit {
  /** (a sidechain explorer's widgets, chain/l2/full/l2-widget.component.ts: chain, treasury, bmm, bundles, peg, deposits,
   * withdrawals; a node sidechain's, MODULE.dashboard: its module's own kinds) */
  @Input() kind: 'treasury' | 'bmm' | 'bundles' | 'peg' | 'mining' | 'chain' | 'deposits' | 'withdrawals' | string = 'treasury';

  profile = PROFILE;
  l2 = PROFILE.kind !== 'l1'; // (a node sidechain too: its module's views)
  cockpitPath = '/drivechain';
  data$: Observable<any>;
  peg$: Observable<any[]>;
  mining$: Observable<any>;

  constructor(private live: DrivechainLiveService, private api: ChainApiService) {}

  ngOnInit(): void {
    if (this.l2) {
      return;
    }
    this.data$ = this.live.cockpit$;
    this.peg$ = this.live.peg$;
    if (this.kind === 'mining') {
      this.mining$ = timer(0, 30000).pipe(switchMap(() => this.api.get<any>('drivechain/mining', { window: 144 }).pipe(catchError(() => of(null)))));
    }
  }

  logoUrl(logo: string): string {
    return `/resources/pool-logos/${logo}`;
  }

  hideLogo(event: Event): void {
    (event.target as HTMLElement).style.display = 'none';
  }

  colorOf(slot: number): string {
    return slotColor(slot);
  }

  markId(slot: number, name?: string | null): string {
    return slotMarkId(slot, name);
  }

  pct(x: number, d = 1): string {
    return ((x || 0) * 100).toFixed(d) + '%';
  }

  short(h: string): string {
    return h ? h.slice(0, 6) + '…' + h.slice(-4) : '';
  }

  /** the sidechains by escrow, largest first */
  byEscrow(d: any): any[] {
    return [...d.live.sidechains].sort((a, b) => b.escrow - a.escrow);
  }

  stat(d: any, slot: number): any {
    return d.slots.find((s: any) => s.slot === slot);
  }

  accepted(b: any, slot: number): any {
    return b.accepts.find((a: any) => a.slot === slot);
  }

  newest(d: any, n: number): any[] {
    return d.coverage.slice(-n);
  }

  /** a pending bundle's votes against the threshold, 0..1 */
  progress(b: any): number {
    return Math.min(1, b.score / (b.threshold || 1));
  }

  /** whether a bundle can still reach the threshold in the blocks it has left (one upvote per block at most) */
  canMake(b: any): boolean {
    return b.threshold - b.score <= b.blocksleft;
  }

  trackSlot = (_: number, s: any) => s.slot;

  hashrate(h: number): string {
    if (!h) { return '0 H/s'; }
    const u = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
    let i = 0;
    while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
    return h.toFixed(h < 10 ? 2 : 1) + ' ' + u[i];
  }

  diff(d: number): string {
    if (d === null || d === undefined) { return '–'; }
    const u: [number, string][] = [[1e12, ' T'], [1e9, ' G'], [1e6, ' M'], [1e3, ' k']];
    for (const [x, s] of u) { if (d >= x) { return (d / x).toFixed(2) + s; } }
    return d.toFixed(d < 10 ? 3 : 1);
  }
}
