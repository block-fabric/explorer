import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, map } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { ChainLink, chainLinks } from '@app/chain/chain-links';

@Component({
  selector: 'app-chain-switcher',
  standalone: true,
  imports: [CommonModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: flex; align-items: center; }
    .dropdown-toggle { width: 62px; height: 36px; }
    @media (min-width: 992px) { .dropdown-container { margin-right: 16px; } }
    .chain-switch-item { display: flex; align-items: center; gap: 10px; min-width: 210px; }
    .chain-switch-item .cs-name { flex: 1 1 auto; text-align: left; }
    .chain-switch-item .cs-id { flex: 0 0 auto; margin-left: 16px; font-size: 0.8em; color: var(--transparent-fg); }
    .chain-switch-item.active { opacity: 0.7; }
    .cs-mark { display: inline-flex; }
  `],
  template: `
  <ng-container *ngIf="links$ | async as links">
    <div ngbDropdown class="dropdown-container" *ngIf="links.length > 1">
      <button ngbDropdownToggle type="button" class="btn btn-secondary dropdown-toggle-split d-flex justify-content-center align-items-center"
        aria-haspopup="true" aria-label="Other chains' explorers" title="Other chains' explorers: eCash and its sidechains">
        <app-svg-images name="nav-drivechain" width="20" height="20"></app-svg-images>
      </button>
      <div ngbDropdownMenu class="dropdown-menu-right">
        <ng-container *ngFor="let l of links">
          <span *ngIf="l.here; else other" ngbDropdownItem class="chain-switch-item active" [disabled]="true">
            <app-svg-images name="chain-mark" [fill]="l.mark" width="18" height="18" class="cs-mark" [style]="'color: ' + l.color"></app-svg-images>
            <span class="cs-name">{{ l.name }}</span><span class="cs-id">this explorer</span>
          </span>
          <ng-template #other>
            <a ngbDropdownItem [href]="l.url" class="chain-switch-item">
              <app-svg-images name="chain-mark" [fill]="l.mark" width="18" height="18" class="cs-mark" [style]="'color: ' + l.color"></app-svg-images>
              <span class="cs-name">{{ l.name }}</span><span class="cs-id">{{ l.id === 'ecash' ? 'mainchain' : 'sidechain' }}</span>
            </a>
          </ng-template>
        </ng-container>
      </div>
    </div>
  </ng-container>`,
})
export class ChainSwitcherComponent {
  links$: Observable<ChainLink[]>;

  constructor(chainApi: ChainApiService) {
    this.links$ = chainApi.chain$().pipe(map(chainLinks));
  }
}
