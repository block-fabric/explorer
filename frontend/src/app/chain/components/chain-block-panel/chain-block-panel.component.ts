import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription, catchError, of, timer, switchMap, takeWhile } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { DrivechainBlock, SidechainCarrier } from '@app/chain/chain.interfaces';
import { PROFILE, PROFILES, explorerUrl, profileBySlot, sideBlockPath } from '@app/chain/profiles';

/**
 * The block page's drivechain box.
 *
 * Chains (mainchain): everything the block did for its sidechains: the sidechain blocks it committed to by blind
 * merged mining (M7) and the bids paid for them (M8), BMM requests it did not accept, deposits into and
 * withdrawals out of the sidechains' escrows, its vote on withdrawal bundles (M4), bundles proposed (M3) and closed,
 * and sidechain proposals (M1) and acks (M2).
 *
 * A sidechain: the Chains block that committed to this block, and the bid paid for it.
 */
@Component({
  selector: 'app-chain-block-panel',
  templateUrl: './chain-block-panel.component.html',
  styleUrls: ['./chain-block-panel.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainBlockPanelComponent implements OnChanges, OnDestroy {
  sideBlockPath = sideBlockPath;
  @Input() blockHash: string;
  @Input() height: number;

  profile = PROFILE;
  mainchain = PROFILES.chains;
  block: DrivechainBlock | null = null;
  carrier: SidechainCarrier | null = null;
  pos: any = null;
  posSub: Subscription;
  loading = true;
  error: string | null = null;
  sub: Subscription;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.loading = true;
    this.block = null;
    this.carrier = null;
    this.error = null;
    if (!this.blockHash) {
      return;
    }
    this.posSub?.unsubscribe();
    this.pos = null;
    if (PROFILE.pos) {
      this.posSub = this.api.feature$<any>('block/' + this.blockHash + '/features').pipe(catchError(() => of(null))).subscribe((p) => {
        this.pos = p?.kind ? p : null;
        this.cd.markForCheck();
      });
    }
    // A new block can be shown before the index has it: ask again a few times
    let tries = 0;
    if (PROFILE.mainchain) {
      this.sub = timer(0, 5000).pipe(
        switchMap(() => this.api.drivechainBlock$(this.blockHash).pipe(catchError((e) => of({ error: e?.error?.error || 'unavailable' } as any)))),
        takeWhile((b) => !!b?.error && tries++ < 12, true),
      ).subscribe((b: any) => {
        if (b?.error) {
          this.error = b.error;
        } else {
          this.block = b;
          this.error = null;
        }
        this.loading = false;
        this.cd.markForCheck();
      });
    } else {
      this.sub = timer(0, 10000).pipe(
        switchMap(() => this.api.get<{ carrier: SidechainCarrier | null }>('sidechain/block/' + this.blockHash).pipe(catchError(() => of({ carrier: null })))),
        takeWhile((r) => !r.carrier && tries++ < 18, true),
      ).subscribe((r) => {
        this.carrier = r.carrier;
        this.loading = false;
        this.cd.markForCheck();
      });
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.posSub?.unsubscribe();
  }

  finColor(st: string): string { return st === 'final' ? '#3bd16f' : st === 'anchored' ? '#5aa6ff' : '#ffd166'; }
  finGlyph(st: string): string { return st === 'final' ? '✔' : st === 'anchored' ? '⚓' : '○'; }
  finHelp(st: string): string {
    return st === 'final' ? 'anchored deep enough in Chains to be final'
      : st === 'anchored' ? 'a Chains block committed to it (BMM); not final yet'
      : 'signed by its validator only, waiting for a Chains anchor';
  }

  mainExplorerHeight(h: number): string | null {
    return h ? explorerUrl('chains', '/block/' + h) : null;
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

  sideExplorer(slot: number, path: string): string | null {
    const p = profileBySlot(slot);
    return p ? explorerUrl(p.id, path) : null;
  }

  mainExplorer(path: string): string | null {
    return explorerUrl('chains', path);
  }

  colorOf(slot: number): string {
    return profileBySlot(slot)?.color ?? '#9a9788';
  }

  short(h: string): string {
    return h ? h.slice(0, 8) + '…' + h.slice(-8) : '';
  }
}
