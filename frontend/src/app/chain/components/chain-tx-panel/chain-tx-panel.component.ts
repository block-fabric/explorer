import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { ChainTxInfo } from '@app/chain/chain.interfaces';
import { PROFILE, slotColor } from '@app/chain/profiles';

/**
 * The transaction page's drivechain box: what the transaction did for a sidechain: a deposit (M5), a withdrawal (M6)
 * or a BMM bid (M8), from the drivechain index.
 */
@Component({
  selector: 'app-chain-tx-panel',
  template: `
    <!-- a sidechain transaction (chain/l2/full): what its outputs hold, its TxData, deposits, signers -->
    <app-l2-view *ngIf="l2" view="tx" [inputs]="{ txid: txid }"></app-l2-view>
    <ng-container *ngIf="!l2 && info as i">
      <div class="box ct-box" [style.--sc]="color">
        <div *ngIf="i.deposit as d" class="ct-row">
          <span class="ct-tag">M5</span>
          <span class="ct-main">Deposit of <b><app-amount [satoshis]="d.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount></b> into
            <app-sidechain-label [slot]="d.slot" [name]="d.name" [colored]="true"></app-sidechain-label> <span class="ct-slot">slot {{ d.slot }}</span></span>
          <span class="ct-sub">credited on the sidechain to <span class="mono">{{ destAddress(d.destination) }}</span>
            · escrow sequence {{ d.sequence | number }} · in block {{ i.height | number }}</span>
        </div>
        <div *ngIf="i.withdrawal as w" class="ct-row">
          <span class="ct-tag">M6</span>
          <span class="ct-main">Withdrawal of <b><app-amount [satoshis]="w.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount></b> from
            <app-sidechain-label [slot]="w.slot" [name]="w.name" [colored]="true"></app-sidechain-label> <span class="ct-slot">slot {{ w.slot }}</span></span>
          <span class="ct-sub">{{ w.payouts.length }} payout{{ w.payouts.length === 1 ? '' : 's' }} · bundle <app-truncate class="mono" [inline]="true" [text]="w.bundle" [lastChars]="8"></app-truncate> paid in block {{ i.height | number }} after the miners' vote</span>
        </div>
        <div *ngIf="i.bmmRequest as r" class="ct-row">
          <span class="ct-tag">M8</span>
          <span class="ct-main">BMM bid of <b>{{ r.bid | number }} sats</b> for a
            <app-sidechain-label [slot]="r.slot" [name]="r.name" [colored]="true"></app-sidechain-label> block</span>
          <span class="ct-sub">
            <app-truncate class="mono" [inline]="true" [text]="r.sideBlock" [lastChars]="8"></app-truncate>
            · <span [class.pos]="r.accepted" [class.neg]="!r.accepted">{{ r.accepted ? 'accepted (M7) by the miner of block ' + (i.height | number) : 'not accepted: the miner of block ' + (i.height | number) + ' took the fee and committed to another block' }}</span>
          </span>
        </div>
      </div>
      <br>
    </ng-container>
  `,
  styles: [`
    .ct-box { padding: 12px 16px; border-left: 3px solid var(--sc); }
    .ct-row + .ct-row { margin-top: 10px; padding-top: 10px; border-top: 1px solid #ffffff12; }
    .ct-tag { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 0 6px; border-radius: 4px; margin-right: 8px;
      color: var(--sc); border: 1px solid color-mix(in srgb, var(--sc) 55%, transparent); vertical-align: middle; }
    .ct-main { font-size: 1rem; }
    .sc-name { font-weight: 600; color: var(--sc); }
    .ct-slot { font-size: 0.8rem; color: var(--transparent-fg); }
    .ct-sub { display: block; font-size: 0.8rem; color: var(--transparent-fg); margin-top: 3px; }
    .mono { font-family: monospace; }
    .pos { color: #3bd16f; } .neg { color: #ff6b6b; }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainTxPanelComponent implements OnChanges, OnDestroy {
  @Input() txid: string;

  profile = PROFILE;
  /** a sidechain explorer: its own panel (chain/l2/full/l2-tx-panel.component.ts) */
  l2 = PROFILE.kind !== 'l1'; // (Flush too: chain/modules/flush/views)
  info: ChainTxInfo | null = null;
  color = PROFILE.color;
  private sub: Subscription;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.info = null;
    if (!this.txid || this.l2) { return; }
    this.sub = this.api.tx$(this.txid).subscribe((i) => {
      this.info = i && (i.deposit || i.withdrawal || i.bmmRequest) ? i : null;
      const slot = i?.deposit?.slot ?? i?.withdrawal?.slot ?? i?.bmmRequest?.slot;
      this.color = slot !== undefined ? slotColor(slot) : PROFILE.color;
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  /** s<slot>_<address>_<checksum> -> address */
  destAddress(dest: string): string {
    const m = /^s\d+_(.+)_[0-9a-f]{6}$/.exec(dest || '');
    return m ? m[1] : dest;
  }
}
