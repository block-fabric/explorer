import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { ChainProfile } from '@app/chain/chain-module';
import { SIDECHAIN_MARK, SIDECHAIN_MARKS } from '@app/chain/marks';
import { PROFILES, profileBySlot, sidechainMarkId, slotColor } from '@app/chain/profiles';

/**
 * A chain named in the text: its mark (an icon in its colour, sized to the line) and its name. Wherever a sidechain
 * (or the eCash mainchain, [chain]="'ecash'") is named: block and transaction panels, tables, legends, event logs,
 * widgets, the chain lists. The mark is the sidechain's by its title (chain/marks.ts SIDECHAIN_MARKS), else its
 * profile's, else the generic block (SIDECHAIN_MARK); the colour is the profile's or the slot's. The name is plain
 * interpolation; extra content (a slot, a suffix) goes after it.
 *
 * Standalone and free of SharedModule, so that SharedModule can declare it for upstream's templates.
 */
@Component({
  selector: 'app-sidechain-label',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline; white-space: nowrap; }
    .m { display: inline-block; width: 1.1em; height: 1.1em; vertical-align: -0.2em; margin-right: 0.3em; color: var(--scl); flex: none; }
    .n.c { color: var(--scl); font-weight: 600; }
  `],
  template: `<span [style.--scl]="color" [attr.title]="title"><svg class="m" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">@for (r of rects; track $index) {<rect [attr.x]="r.x" [attr.y]="r.y" [attr.width]="r.w" [attr.height]="r.h" [attr.rx]="r.rx"></rect>}@for (d of paths; track $index) {<path [attr.d]="d"></path>}</g></svg><span class="n" [class.c]="colored">{{ name }}</span><ng-content></ng-content></span>`,
})
export class SidechainLabelComponent implements OnChanges {
  /** BIP300 slot (colour, and the mark when the name has none) */
  @Input() slot: number | null | undefined = null;
  /** the name shown (the enforcer's title, or a profile's name); the mark is looked up by it */
  @Input() name: string | null | undefined = '';
  /** the sidechain title to take the mark from, when the name shown is something else (e.g. "Thunder escrow, +1 ECX") */
  @Input() markOf: string | null | undefined = null;
  /** a chain profile id instead of a slot, e.g. 'ecash' for the mainchain */
  @Input() chain: string | null = null;
  /** the name in the chain's colour too */
  @Input() colored = false;
  /** a tooltip (plain text) */
  @Input() title: string | null = null;

  color = '#9aa4b2';
  paths: string[] = [];
  rects: { x: number; y: number; w: number; h: number; rx: number }[] = [];

  ngOnChanges(): void {
    const profile: ChainProfile | undefined = this.chain ? PROFILES[this.chain]
      : (this.slot !== null && this.slot !== undefined ? profileBySlot(this.slot) : undefined);
    const byName = sidechainMarkId(this.markOf ?? this.name);
    const mark = (byName ? SIDECHAIN_MARKS[byName] : null) ?? profile ?? SIDECHAIN_MARK;
    this.paths = mark.mark ?? [];
    this.rects = mark.markRects ?? [];
    this.color = profile?.color ?? (this.slot !== null && this.slot !== undefined ? slotColor(this.slot) : '#9aa4b2');
    if (!this.name && profile) {
      this.name = profile.name;
    }
  }
}
