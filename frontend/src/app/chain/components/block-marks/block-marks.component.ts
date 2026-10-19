import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { BlockMark, DrivechainLiveService } from '@app/chain/drivechain-live.service';
import { PROFILE, explorerUrl, profileBySlot } from '@app/chain/profiles';

/**
 * A block's drivechain marks, wherever blocks are shown:
 *   stripe  inside a block cube: one band per sidechain block it carried (Chains)
 *   below   under a block cube: the miner, a mark per sidechain carried, deposits ↓ and withdrawals ↑ (Chains);
 *           the Chains block that carried it (a sidechain)
 *   inline  in a table row: the same as `below`, on one line
 */
@Component({
  selector: 'app-chain-block-marks',
  template: `
    <ng-container *ngIf="mark as m">
      <!-- Chains: a band per sidechain carried -->
      <!-- blocks of stake: a band in the colour of the block's finality -->
      <div *ngIf="mode === 'stripe' && m.pos as p" class="stripe" [title]="posTitle(p)">
        <span class="band" [style.background]="p.ack || p.kind === 'bmm' ? '#b5f27e' : finalityColor(p)"></span>
      </div>
      <div *ngIf="mode === 'stripe' && m.summary as s" class="stripe" [title]="stripeTitle">
        <span *ngFor="let a of s.bmm" class="band" [style.background]="colorOf(a.slot)"></span>
      </div>

      <!-- the miner alone (block and transaction pages) -->
      <span *ngIf="mode === 'miner' && m.summary as s" class="badge miner-badge" [title]="'From the coinbase of this block' + (s.datum ? ' (DATUM: pool tag and miner tag)' : '')">{{ s.miner || 'Unknown' }}{{ s.datum && s.minerTag ? ' · ' + s.minerTag : '' }}</span>
      <span *ngIf="mode === 'miner' && !m.pos && !m.summary && m.carrier as c" class="badge miner-badge" title="A sidechain block: made by its BMM bidder, committed by this Chains block">BMM · Chains block {{ c.height | number }}</span>
      <span *ngIf="mode === 'miner' && m.pos as p" class="badge miner-badge" [title]="posTitle(p)">{{ p.kind === 'pos' ? 'Validator ' + (p.proposer || '?').slice(0, 12) + '…' : 'BMM block (no validator)' }}</span>

      <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'">
        <ng-container *ngIf="m.summary as s">
          <span *ngIf="mode === 'below'" class="miner" [title]="'Mined by ' + (s.miner || 'an unknown miner') + (s.datum ? ', DATUM miner ' + (s.minerTag || 'without a tag') : '')">{{ s.miner || 'Unknown' }}</span>
          <span class="icons">
            <span *ngFor="let a of s.bmm" class="sc" [style.color]="colorOf(a.slot)" [title]="a.name + ' block carried' + (a.bid != null ? ', bid ' + a.bid + ' sats' : '')">
              <app-svg-images name="chain-mark" [fill]="profileId(a.slot)" [width]="px" [height]="px"></app-svg-images>
            </span>
            <span *ngIf="!s.bmm.length && mode === 'inline'" class="none">–</span>
            <span *ngIf="s.deposits" class="peg dep" [title]="s.deposits + ' deposit(s) into sidechains'">↓{{ s.deposits > 1 ? s.deposits : '' }}</span>
            <span *ngIf="s.withdrawals" class="peg wd" [title]="s.withdrawals + ' withdrawal(s) out of sidechains'">↑{{ s.withdrawals > 1 ? s.withdrawals : '' }}</span>
            <span *ngIf="s.bundlesProposed || s.bundlesClosed" class="peg bn" title="Withdrawal bundle proposed or closed">◆</span>
            <span *ngIf="s.proposals || s.acks" class="peg pr" title="Sidechain proposal or ack">✦</span>
          </span>
        </ng-container>
        <!-- blocks of stake: kind, slot and finality -->
        <span *ngIf="m.pos as p" class="pos" [title]="posTitle(p)">
          <span class="kind" [class.bmm]="p.kind === 'bmm'" [class.anchor]="p.ack">{{ kindLabel(p) }}</span>
          <span class="fin" [style.color]="finalityColor(p)">{{ finalityGlyph(p) }} {{ p.finality?.status || '' }}</span>
        </span>
        <ng-container *ngIf="m.carrier !== undefined && (!m.pos || m.carrier?.role === 'ticket' || (m.carrier && !m.carrier.role))">
          <a *ngIf="m.carrier as c; else notCarried" class="carrier" [href]="mainUrl(c.hash || c.height)" [title]="'Carried by Chains block ' + c.height + (c.bid !== null ? ', bid ' + c.bid + ' sats' : '')">
            <app-svg-images name="chain-mark" fill="chains" [width]="px" [height]="px"></app-svg-images> {{ c.height }}
          </a>
          <ng-template #notCarried><span class="carrier pending" title="Not carried by a Chains block (yet)">{{ m.pos ? '' : 'not merged mined' }}</span></ng-template>
        </ng-container>
      </div>
    </ng-container>
  `,
  styles: [`
    :host { display: block; }
    .miner-badge { background: color-mix(in srgb, #b5f27e 25%, transparent); color: var(--fg); font-size: 0.85em; }
    .pos { display: inline-flex; gap: 4px; align-items: center; font-size: 10px; font-weight: 700; }
    .kind { padding: 0 4px; border-radius: 3px; background: color-mix(in srgb, var(--chain-accent, #8f7cff) 35%, transparent); color: var(--fg); }
    .kind.bmm { background: color-mix(in srgb, #b5f27e 35%, transparent); }
    .kind.anchor { background: color-mix(in srgb, #b5f27e 22%, transparent); outline: 1px solid color-mix(in srgb, #b5f27e 60%, transparent); }
    .fin { font-weight: 600; }
    .marks.inline .pos { margin-right: 6px; }
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
    .carrier { display: inline-flex; align-items: center; gap: 3px; color: #b5f27e; font-weight: 600; text-decoration: none; }
    .carrier.pending { color: var(--transparent-fg); font-weight: normal; }
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
    return profileBySlot(slot)?.color ?? '#9a9788';
  }

  profileId(slot: number): string {
    return profileBySlot(slot)?.id ?? 'chains';
  }

  mainUrl(hash: string | number): string | null {
    return explorerUrl('chains', '/block/' + hash);
  }

  /** finality of a block of stake: soft (only its validator), anchored (a Chains block committed to it), final */
  finalityColor(p: any): string {
    const st = p?.finality?.status;
    return st === 'final' ? '#3bd16f' : st === 'anchored' ? '#5aa6ff' : '#ffd166';
  }

  finalityGlyph(p: any): string {
    const st = p?.finality?.status;
    return st === 'final' ? '✔' : st === 'anchored' ? '⚓' : '○';
  }

  /** PoS: a block of stake; PoS·BMM: one that lands a Chains BMM anchor; BMM: a fallback block made by merged mining */
  kindLabel(p: any): string {
    return p.kind === 'bmm' ? 'BMM' : p.ack ? 'PoS·BMM' : 'PoS';
  }

  posTitle(p: any): string {
    const parts = [p.kind === 'pos' ? `Block of stake, slot ${p.slot ?? '?'}` : `BMM fallback block${p.mainheight ? ' at Chains ' + p.mainheight : ''}`];
    if (p.proposer) { parts.push(`proposer ${p.proposer}`); }
    if (p.finality) { parts.push(`${p.finality.status}${p.finality.anchors ? ', ' + p.finality.anchors + ' anchors' : ''}`); }
    if (p.ack) { parts.push(`lands the BMM anchor committed by Chains block ${p.ack.mainheight ?? '?'} (ticket ${(p.ack.ticket ?? '').slice(0, 12)}…)`); }
    return parts.join(' · ');
  }

  get profile() {
    return PROFILE;
  }
}
