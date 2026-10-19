import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AssetMetaService, CHN_ID } from '@app/chain/asset-meta.service';

/**
 * An asset as the chain names it: its logo (or a letter in a colour of its own), its ticker, and its display name
 * when asked (never instead of the ticker: display names are not unique). CHN is drawn with the Chains mark.
 */
@Component({
  selector: 'app-asset-badge',
  template: `
    <a *ngIf="link && !isChn; else plain" class="ab" [routerLink]="['/asset' | relativeUrl, id]" [title]="title"><ng-container *ngTemplateOutlet="inner"></ng-container></a>
    <ng-template #plain><span class="ab" [title]="title"><ng-container *ngTemplateOutlet="inner"></ng-container></span></ng-template>
    <ng-template #inner>
      <span class="icon" [style.width.px]="size" [style.height.px]="size">
        <img *ngIf="logo && !broken; else letter" [src]="logo" [width]="size" [height]="size" alt="" (error)="broken = true" referrerpolicy="no-referrer">
        <ng-template #letter>
          <app-svg-images *ngIf="isChn" name="chain-mark" fill="chains" [width]="'' + size" [height]="'' + size" style="color: #b5f27e"></app-svg-images>
          <span *ngIf="!isChn" class="letter" [style.background]="color" [style.font-size.px]="size * 0.55">{{ ticker.charAt(0) }}</span>
        </ng-template>
      </span>
      <span class="ticker">{{ ticker }}</span>
      <span *ngIf="showName && display" class="display">{{ display }}</span>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; max-width: 100%; vertical-align: middle; }
    .ab { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: inherit; text-decoration: none; }
    a.ab .ticker { color: var(--chain-accent, var(--title-fg)); }
    a.ab:hover .ticker { text-decoration: underline; }
    .icon { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; overflow: hidden; }
    .icon img { object-fit: cover; border-radius: 50%; }
    .letter { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #11131f; font-weight: 800; border-radius: 50%; }
    .ticker { font-weight: 700; white-space: nowrap; }
    .display { color: var(--transparent-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetBadgeComponent implements OnInit, OnChanges, OnDestroy {
  @Input() id: string | null;
  @Input() label: string | null = null;    // the ticker when the metadata does not know the asset (yet)
  @Input() size = 18;
  @Input() showName = false;
  @Input() link = true;

  ticker = ''; display: string | null = null; logo: string | null = null; color = '#9aa4b2'; title = ''; isChn = false; broken = false;
  private sub: Subscription;

  constructor(private meta: AssetMetaService, private cd: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.sub = this.meta.meta$.subscribe(() => { this.update(); this.cd.markForCheck(); });
  }

  ngOnChanges(): void { this.broken = false; this.update(); }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  private update(): void {
    const id = this.id || CHN_ID;
    this.isChn = id === CHN_ID || (this.label ?? '').toUpperCase() === 'CHN' && !this.id;
    const m = this.isChn ? undefined : this.meta.get(id);
    this.ticker = this.isChn ? 'CHN' : (m?.ticker ?? m?.label ?? this.label ?? id.slice(0, 8));
    this.display = m?.display ?? null;
    this.logo = this.isChn ? null : this.meta.logoUrl(id);
    let h = 0;
    for (const c of id.slice(0, 8)) { h = (h * 31 + c.charCodeAt(0)) % 360; }
    this.color = `hsl(${h}, 60%, 68%)`;
    this.title = this.isChn ? 'CHN' : `${this.ticker}${this.display ? ' · ' + this.display : ''}\n${id}`;
  }
}
