import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Injector, Input, OnChanges, OnDestroy } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { BlockMark, DrivechainLiveService } from '@app/chain/drivechain-live.service';
import { PROFILE, PROFILES, slotColor, slotMarkId } from '@app/chain/profiles';
import { L2LiveService, L2Mark } from '@app/chain/l2/full/l2-live.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';

/**
 * A block's drivechain marks, wherever blocks are shown:
 *   stripe  inside a block cube: one band per sidechain block it carried
 *   below   under a block cube: the miner, a mark per sidechain carried, deposits ↓ and withdrawals ↑
 *   inline  in a table row: the same as `below`, on one line
 *   miner   the miner alone (block and transaction pages)
 * On a sidechain explorer (chain/l2/full): the eCash block that carried the block by BMM, and the bid paid for it
 */
@Component({
  selector: 'app-chain-block-marks',
  template: `
    <!-- a sidechain block: the eCash block that carried it (BMM) -->
    <ng-container *ngIf="l2">
      <ng-container *ngIf="l2Mark !== undefined">
        <div *ngIf="mode === 'stripe'" class="stripe" [title]="l2Title">
          <span class="band" [style.background]="l2Mark?.mainBlock ? ecashColor : 'transparent'" [style.outline]="l2Mark?.mainBlock ? null : '1px dashed var(--transparent-fg)'"></span>
        </div>
        <ng-container *ngIf="mode !== 'stripe'">
          <ng-container *ngIf="l2Mark?.mainBlock as mb; else notCarried">
            <span *ngIf="mode === 'miner'" class="badge miner-badge" [title]="l2Title">BMM · <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> block
              <a *ngIf="mainBase$ | async as base; else plainMiner" [href]="base + '/block/' + mb.hash">{{ mb.height | number }}</a>
              <ng-template #plainMiner>{{ mb.height | number }}</ng-template>
              <span *ngIf="l2Mark?.bmm?.bid !== null && l2Mark?.bmm?.bid !== undefined"> · bid {{ l2Mark.bmm.bid | number }} sats</span>
            </span>
            <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'">
              <span class="icons">
                <a *ngIf="mainBase$ | async as base; else plainCarrier" class="carrier" [href]="base + '/block/' + mb.hash" [title]="l2Title">
                  <app-svg-images name="chain-mark" fill="ecash" [width]="px" [height]="px" [style.color]="ecashColor"></app-svg-images> {{ mb.height | number }}
                </a>
                <ng-template #plainCarrier><span class="carrier" [title]="l2Title"><app-svg-images name="chain-mark" fill="ecash" [width]="px" [height]="px" [style.color]="ecashColor"></app-svg-images> {{ mb.height | number }}</span></ng-template>
                <span *ngIf="l2Mark?.bmm?.contested" class="peg wd" title="Contested: other BMM requests for this slot in that eCash block">⚔</span>
                <span *ngIf="l2Mark?.deposits" class="peg dep" [title]="l2Mark.deposits + ' deposit(s) from eCash credited'">↓{{ l2Mark.deposits > 1 ? l2Mark.deposits : '' }}</span>
              </span>
            </div>
          </ng-container>
          <ng-template #notCarried>
            <span *ngIf="mode === 'miner'" class="badge miner-badge" title="No eCash block known to have carried this block (yet)">BMM · not carried yet</span>
            <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'"><span class="none" title="No eCash block known to have carried this block (yet)">–</span></div>
          </ng-template>
        </ng-container>
      </ng-container>
    </ng-container>

    <ng-container *ngIf="!l2 && mark?.summary as s">
      <!-- a band per sidechain carried -->
      <div *ngIf="mode === 'stripe'" class="stripe" [title]="stripeTitle">
        <span *ngFor="let a of s.bmm" class="band" [style.background]="colorOf(a.slot)"></span>
      </div>

      <!-- the miner alone (block and transaction pages) -->
      <span *ngIf="mode === 'miner'" class="badge miner-badge" [title]="'From the coinbase of this block' + (s.datum ? ' (DATUM: pool tag and miner tag)' : '')"><img *ngIf="s.minerLogo" class="pool-logo" [src]="logoUrl(s.minerLogo)" (error)="hideLogo($event)" alt="">{{ s.miner || 'Unknown' }}{{ s.datum && s.minerTag ? ' · ' + s.minerTag : '' }}</span>

      <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'">
        <span *ngIf="mode === 'below'" class="miner" [title]="'Mined by ' + (s.miner || 'an unknown miner') + (s.datum ? ', DATUM miner ' + (s.minerTag || 'without a tag') : '')"><img *ngIf="s.minerLogo" class="pool-logo" [src]="logoUrl(s.minerLogo)" (error)="hideLogo($event)" alt="">{{ s.miner || 'Unknown' }}</span>
        <span class="icons">
          <span *ngFor="let a of s.bmm" class="sc" [style.color]="colorOf(a.slot)" [title]="a.name + ' block carried' + (a.bid != null ? ', bid ' + a.bid + ' sats' : '')">
            <app-svg-images name="chain-mark" [fill]="markId(a.slot, a.name)" [width]="px" [height]="px"></app-svg-images>
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
    .miner-badge { background: color-mix(in srgb, var(--chain-accent, #E6A849) 25%, transparent); color: var(--fg); font-size: 0.85em; }
    .stripe { display: flex; gap: 1px; height: 4px; margin: 4px 8px 0; border-radius: 2px; overflow: hidden; }
    .band { flex: 1; }
    .marks { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; line-height: 1.1; }
    .marks.inline { flex-direction: row; justify-content: flex-start; }
    .miner { color: var(--transparent-fg); max-width: 124px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; }
    .pool-logo { width: 1.1em; height: 1.1em; object-fit: contain; flex: none; }
    .icons { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: center; }
    .sc { display: inline-flex; }
    .peg { font-weight: 700; font-size: 11px; padding: 0 2px; }
    .dep { color: #3bd16f; } .wd { color: #ff6b6b; } .bn { color: #ffd166; } .pr { color: #5aa6ff; }
    .none { color: var(--transparent-fg); }
    .carrier { display: inline-flex; align-items: center; gap: 3px; color: var(--fg); font-weight: 600; text-decoration: none; }
    a.carrier:hover { text-decoration: underline; }
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

  /** a sidechain explorer: the block's BMM mark (undefined: not known yet, null: none) */
  l2 = PROFILE.kind === 'l2';
  l2Mark: L2Mark | null | undefined;
  l2Title = '';
  ecashColor = PROFILES['ecash']?.color ?? '#E6A849';
  mainBase$: Observable<string | null>;

  constructor(private injector: Injector, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    if (this.l2) {
      // (the services are taken here, so that the eCash explorer never makes the sidechain one, nor the reverse)
      const l2Live = this.injector.get(L2LiveService);
      this.mainBase$ = this.injector.get(L2ApiService).mainchain$;
      l2Live.requestHash(this.hash);
      this.sub = l2Live.mark$(this.hash).subscribe((m) => {
        this.l2Mark = m;
        const mb = m?.mainBlock;
        const bid = m?.bmm?.bid;
        this.l2Title = mb
          ? `Carried by eCash block ${mb.height} (blind merged mining)` + (bid !== null && bid !== undefined ? `, bid ${bid} sats paid to its miner` : '')
          : (m === null ? '' : 'No eCash block known to have carried this block (yet)');
        this.cd.markForCheck();
      });
      return;
    }
    const live = this.injector.get(DrivechainLiveService);
    live.requestHash(this.hash);
    this.sub = live.mark$(this.hash).subscribe((m) => {
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

  markId(slot: number, name?: string | null): string {
    return slotMarkId(slot, name);
  }

  logoUrl(logo: string): string {
    return `/resources/pool-logos/${logo}`;
  }

  hideLogo(event: Event): void {
    (event.target as HTMLElement).style.display = 'none';
  }

  get profile() {
    return PROFILE;
  }
}
