import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription, catchError, of } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { MODULE } from '@app/chain/profiles';

/** The tokens an address holds (chains with a token ledger: BitAssets, Layers), on its address page */
@Component({
  selector: 'app-address-tokens',
  template: `
    <ng-container *ngIf="enabled && tokens?.length">
      <br>
      <div class="title-tx"><h2 class="text-start">Tokens</h2></div>
      <div class="box">
        <table class="table table-borderless table-sm mb-0">
          <thead><tr><th>Token</th><th>Kind</th><th class="text-right">Balance</th><th class="text-right">Outputs</th></tr></thead>
          <tbody>
            <tr *ngFor="let t of tokens">
              <td><a [routerLink]="[(t.kind === 'lp' ? '/pool' : t.kind === 'receipt' ? '/auction' : '/asset') | relativeUrl, t.id]"><b>{{ t.label }}</b></a></td>
              <td class="text-muted">{{ kindName(t.kind) }}</td>
              <td class="text-right"><b>{{ t.amount }}</b><span *ngIf="t.poolShare !== undefined" class="text-muted"> · {{ t.poolShare * 100 | number:'1.0-2' }}% of the pool</span></td>
              <td class="text-right text-muted">{{ t.outputs.length }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </ng-container>
  `,
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddressTokensComponent implements OnChanges, OnDestroy {
  @Input() address: string;
  enabled = !!MODULE.tokens;
  tokens: any[] | null = null;
  private sub: Subscription;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.tokens = null;
    if (!this.enabled || !this.address) { return; }
    this.sub = this.api.feature$<any[]>('tokens/' + this.address).pipe(catchError(() => of([]))).subscribe((t) => {
      this.tokens = t;
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  kindName(k: string): string {
    return { asset: 'asset', control: 'control coin (mints, updates)', reservation: 'name reservation', lp: 'liquidity shares', receipt: 'auction receipt (collects)' }[k] ?? k;
  }
}
