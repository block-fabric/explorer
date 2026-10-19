import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { ChainProfile, explorerUrl, profileBySlot } from '@app/chain/profiles';

/**
 * A sidechain named by its mark, colour and name; a link into that sidechain's explorer when it has a public URL
 * (CHAIN_EXPLORER_URLS) and a path is given (e.g. /block/<hash>).
 */
@Component({
  selector: 'app-sidechain-chip',
  template: `
    <a *ngIf="href; else plain" class="sc-chip" [class.compact]="compact" [href]="href" [style.--sc]="color" [title]="title">
      <ng-container *ngTemplateOutlet="inner"></ng-container>
    </a>
    <ng-template #plain>
      <span class="sc-chip" [class.compact]="compact" [style.--sc]="color" [title]="title"><ng-container *ngTemplateOutlet="inner"></ng-container></span>
    </ng-template>
    <ng-template #inner>
      <app-svg-images name="chain-mark" [fill]="profileId" width="14" height="14"></app-svg-images>
      <span class="sc-name" *ngIf="!compact">{{ label }}</span>
    </ng-template>
  `,
  styles: [`
    .sc-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px 1px 5px; border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--sc) 55%, transparent); color: var(--sc); background: color-mix(in srgb, var(--sc) 12%, transparent);
      font-size: 0.85em; line-height: 1.5; white-space: nowrap; text-decoration: none; vertical-align: middle; }
    .sc-chip.compact { padding: 2px; border-radius: 50%; }
    a.sc-chip:hover { background: color-mix(in srgb, var(--sc) 25%, transparent); text-decoration: none; }
    .sc-name { color: var(--fg); }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidechainChipComponent implements OnChanges {
  @Input() slot: number;
  @Input() name: string;
  @Input() path: string | null = null;
  @Input() compact = false;
  @Input() suffix = '';

  profile: ChainProfile | undefined;
  profileId = 'chains';
  color = '#9a9788';
  href: string | null = null;
  label = '';
  title = '';

  ngOnChanges(): void {
    this.profile = profileBySlot(this.slot);
    this.profileId = this.profile?.id ?? 'chains';
    this.color = this.profile?.color ?? '#9a9788';
    this.label = (this.name || this.profile?.name || `Slot ${this.slot}`) + (this.suffix ? ' ' + this.suffix : '');
    this.title = `${this.name || this.profile?.name || 'Sidechain'} (slot ${this.slot})`;
    this.href = this.profile && this.path !== null ? explorerUrl(this.profile.id, this.path) : null;
  }
}


