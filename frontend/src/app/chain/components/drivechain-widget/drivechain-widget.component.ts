import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Observable, catchError, combineLatest, map, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { DrivechainLiveService } from '@app/chain/drivechain-live.service';
import { PROFILE, explorerUrl, profileBySlot } from '@app/chain/profiles';

/**
 * Dashboard widgets of the drivechain (data: DrivechainLiveService, the cockpit over the newest 144 blocks):
 *   treasury  the CHN locked in each sidechain, as a bar and a list, with the share of the supply
 *   bmm       the newest blocks x sidechains, coverage and bids
 *   bundles   the pending withdrawal bundles on their way to the payout score
 *   peg       the latest deposits and withdrawals
 */
@Component({
  selector: 'app-drivechain-widget',
  templateUrl: './drivechain-widget.component.html',
  styleUrls: ['./drivechain-widget.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrivechainWidgetComponent implements OnInit {
  @Input() kind: 'treasury' | 'bmm' | 'bundles' | 'peg' | 'stake' = 'treasury';

  profile = PROFILE;
  cockpitPath = PROFILE.mainchain ? '/drivechain' : '/bmm';
  data$: Observable<any>;
  peg$: Observable<any[]>;
  stake$: Observable<any>;

  constructor(private live: DrivechainLiveService, private api: ChainApiService) {}

  ngOnInit(): void {
    this.data$ = this.live.cockpit$;
    this.peg$ = this.live.peg$;
    if (this.kind === 'stake') {
      this.stake$ = timer(0, 15000).pipe(
        switchMap(() => combineLatest([
          this.api.feature$<any>('pos').pipe(catchError(() => of(null))),
          this.api.feature$<any>('validators').pipe(catchError(() => of(null))),
          this.api.get<number>('blocks/tip/height').pipe(catchError(() => of(null))),
        ])),
        map(([pos, vals, tip]) => pos ? { pos, vals, tip } : null),
      );
    }
  }

  colorOf(slot: number): string {
    return profileBySlot(slot)?.color ?? PROFILE.color;
  }

  profileId(slot: number): string {
    return profileBySlot(slot)?.id ?? 'chains';
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

  progress(d: any, b: any): number {
    return Math.min(1, b.score / (d.live.info.withdrawalminscore || 1));
  }

  canMake(d: any, b: any): boolean {
    return d.live.info.withdrawalminscore - b.score <= b.blocksleft;
  }

  /** a mainchain link: in-app on Chains, to the Chains explorer from a sidechain */
  blockLink(hash: string): string | null {
    return PROFILE.mainchain ? null : explorerUrl('chains', '/block/' + hash);
  }

  txLink(txid: string): string | null {
    return PROFILE.mainchain ? null : explorerUrl('chains', '/tx/' + txid);
  }

  trackSlot = (_: number, s: any) => s.slot;

  /** where the slot is in its epoch (40 slots), 0..1 */
  epochProgress(pos: any, vals: any): number {
    const first = vals?.firstslot ?? (pos.epoch * 40);
    return Math.min(1, Math.max(0, (pos.slot - first + 1) / 40));
  }

  keyShort(k: string): string { return k ? k.slice(0, 10) + '…' : '?'; }
}
