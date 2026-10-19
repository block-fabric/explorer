import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, of, timer, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';

/** zSide: the shielded (Orchard) pool (/shielded) */
@Component({
  selector: 'app-zside-shielded',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp" *ngIf="info$ | async as i">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> Shielded pool</h1>
    <div class="sub">zSide carries Zcash Orchard bundles: inside the pool, amounts, senders and receivers are hidden. Only what enters and leaves it is public.</div>
    <div class="kpis">
      <div class="kpi"><div class="l">In the pool</div><div class="v">{{ i.pool | number:'1.0-4' }}</div><div class="s">CHN shielded</div></div>
      <div class="kpi"><div class="l">Notes</div><div class="v">{{ i.notes | number }}</div><div class="s">commitments in the tree</div></div>
      <div class="kpi"><div class="l">Spent</div><div class="v">{{ i.spent | number }}</div><div class="s">nullifiers revealed</div></div>
      <div class="kpi"><div class="l">Index</div><div class="v">{{ i.index?.synced ? 'synced' : 'syncing' }}</div><div class="s">{{ i.index?.notes | number }} notes</div></div>
    </div>
    <h2>Note commitment tree</h2>
    <div class="box"><span class="muted">Anchor (tree root)</span><div class="mono">{{ i.root }}</div></div>
    <h2>Reading a shielded transaction</h2>
    <div class="box muted">A transaction's Orchard bundle shows on its page as a <b>ZORC</b> output: the number of actions, and whether it
      shields coins (value into the pool), unshields them (value out) or stays fully shielded. A viewing key is needed to see more.</div>
  </div>`,
})
export class ZsideShieldedPage implements OnInit {
  profile = PROFILE;
  info$: Observable<any>;

  constructor(private api: ChainApiService) {}

  ngOnInit(): void {
    this.info$ = timer(0, 30000).pipe(switchMap(() => this.api.feature$<any>('info').pipe(catchError(() => of(null)))));
  }
}
