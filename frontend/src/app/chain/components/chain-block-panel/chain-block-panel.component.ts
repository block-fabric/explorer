import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription, catchError, of, timer, switchMap, takeWhile } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { DrivechainBlock } from '@app/chain/chain.interfaces';
import { PROFILE, slotColor } from '@app/chain/profiles';

/**
 * The block page's drivechain box: everything the block did for its sidechains: the sidechain blocks it committed
 * to by blind merged mining (M7) and the bids paid for them (M8), BMM requests it did not accept, deposits into and
 * withdrawals out of the sidechains' escrows, its vote on withdrawal bundles (M4), bundles proposed (M3) and closed,
 * and sidechain proposals (M1) and acks (M2).
 */
@Component({
  selector: 'app-chain-block-panel',
  templateUrl: './chain-block-panel.component.html',
  styleUrls: ['./chain-block-panel.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainBlockPanelComponent implements OnChanges, OnDestroy {
  @Input() blockHash: string;
  @Input() height: number;

  profile = PROFILE;
  block: DrivechainBlock | null = null;
  loading = true;
  error: string | null = null;
  sub: Subscription;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.loading = true;
    this.block = null;
    this.error = null;
    if (!this.blockHash) {
      return;
    }
    // A new block can be shown before the index has it: ask again a few times
    let tries = 0;
    this.sub = timer(0, 5000).pipe(
      switchMap(() => this.api.drivechainBlock$(this.blockHash).pipe(catchError((e) => of({ error: e?.error?.error || e?.error || 'unavailable' } as any)))),
      takeWhile((b) => !!b?.error && tries++ < 12, true),
    ).subscribe((b: any) => {
      if (b?.error) {
        this.error = typeof b.error === 'string' ? b.error : 'unavailable';
      } else {
        this.block = b;
        this.error = null;
      }
      this.loading = false;
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  get isEmpty(): boolean {
    const b = this.block;
    return !!b && !b.bmm.length && !b.bmmRequests.length && !b.deposits.length && !b.withdrawals.length && !b.proposals.length
      && !b.acks.length && !b.bundlesProposed.length && !b.bundlesClosed.length && !(b.votes?.entries?.some(e => e.vote !== 'abstain'));
  }

  get unaccepted() {
    return this.block?.bmmRequests.filter(r => !r.accepted) ?? [];
  }

  get castVotes() {
    return this.block?.votes?.entries.filter(e => e.vote !== 'abstain') ?? [];
  }

  scoreAfter(slot: number, bundle?: string): number | null {
    if (!bundle) {
      return null;
    }
    return this.block?.pending?.[slot]?.find(p => p.hash === bundle)?.score ?? null;
  }

  colorOf(slot: number): string {
    return slotColor(slot);
  }

  short(h: string): string {
    return h ? h.slice(0, 8) + '…' + h.slice(-8) : '';
  }
}
