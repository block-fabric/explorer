import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { BlockMark, DrivechainLiveService } from '@app/chain/drivechain-live.service';
import { PROFILE, slotColor, slotMarkId } from '@app/chain/profiles';

/**
 * A block's drivechain marks, wherever blocks are shown:
 *   stripe  inside a block cube: one band per sidechain block it carried
 *   below   under a block cube: the miner, a mark per sidechain carried, deposits ↓ and withdrawals ↑
 *   inline  in a table row: the same as `below`, on one line
 *   miner   the miner alone (block and transaction pages)
 */
@Component({
  selector: 'app-chain-block-marks',
  template: `
    <ng-container *ngIf="mark?.summary as s">
      <!-- a band per sidechain carried -->
      <div *ngIf="mode === 'stripe'" class="stripe" [title]="stripeTitle">
        <span *ngFor="let a of s.bmm" class="band" [style.background]="colorOf(a.slot)"></span>
      </div>

      <!-- the miner alone (block and transaction pages) -->
      <span *ngIf="mode === 'miner'" class="badge miner-badge" [title]="'From the coinbase of this block' + (s.datum ? ' (DATUM: pool tag and miner tag)' : '')">{{ s.miner || 'Unknown' }}{{ s.datum && s.minerTag ? ' · ' + s.minerTag : '' }}</span>

      <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'">
        <span *ngIf="mode === 'below'" class="miner" [title]="'Mined by ' + (s.miner || 'an unknown miner') + (s.datum ? ', DATUM miner ' + (s.minerTag || 'without a tag') : '')">{{ s.miner || 'Unknown' }}</span>
        <span class="icons">
          <span *ngFor="let a of s.bmm" class="sc" [style.color]="colorOf(a.slot)" [title]="a.name + ' block carried' + (a.bid != null ? ', bid ' + a.bid + ' sats' : '')">
            <app-svg-images name="chain-mark" [fill]="markId(a.slot)" [width]="px" [height]="px"></app-svg-images>
          </span>
          <span *ngIf="!s.bmm.length && mode === 'inline'" class="none">–</span>
          <span *ngIf="s.deposits" class="peg dep" [title]="s.deposits + ' deposit(s) into sidechains'">↓{{ s.deposits > 1 ? s.deposits : '' }}</span>
          <span *ngIf="s.withdrawals" class="peg wd" [title]="s.withdrawals + ' withdrawal(s) out of sidechains'">↑{{ s.withdrawals > 1 ? s.withdrawals : '' }}</span>
          <span *ngIf="s.bundlesProposed || s.bundlesClosed" class="peg bn" title="Withdrawal bundle proposed or closed">◆</span>
          <span *ngIf="s.proposals || s.acks" class="peg pr" title="Sidechain proposal or ack">✦</span>
        </span>
      </div>
    </ng-container>
  `,
  styles: [`
    :host { display: block; }
    .miner-badge { background: color-mix(in srgb, var(--chain-accent, #2ec4b6) 25%, transparent); color: var(--fg); font-size: 0.85em; }
    .stripe { display: flex; gap: 1px; height: 4px; margin: 4px 8px 0; border-radius: 2px; overflow: hidden; }
    .band { flex: 1; }
    .marks { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; line-height: 1.1; }
    .marks.inline { flex-direction: row; justify-content: flex-start; }
    .miner { color: var(--transparent-fg); max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .icons { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: center; }
    .sc { display: inline-flex; }
    .peg { font-weight: 700; font-size: 11px; padding: 0 2px; }
    .dep { color: #3bd16f; } .wd { color: #ff6b6b; } .bn { color: #ffd166; } .pr { color: #5aa6ff; }
    .none { color: var(--transparent-fg); }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainBlockMarksComponent implements OnChanges, OnDestroy {
  @Input() hash: string;
  @Input() mode: 'stripe' | 'below' | 'inline' | 'miner' = 'below';
  @Input() size: string | number = 13;
  get px(): string { return String(this.size); }

  mark: BlockMark | undefined;
  stripeTitle = '';
  private sub: Subscription;

  constructor(private live: DrivechainLiveService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.live.requestHash(this.hash);
    this.sub = this.live.mark$(this.hash).subscribe((m) => {
      this.mark = m;
      const s = m?.summary;
      this.stripeTitle = s ? (s.bmm.length ? s.bmm.map(a => a.name).join(', ') + ' carried' : 'No sidechain block carried') : '';
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  colorOf(slot: number): string {
    return slotColor(slot);
  }

  markId(slot: number): string {
    return slotMarkId(slot);
  }

  get profile() {
    return PROFILE;
  }
}
