import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { ActivityTableComponent } from './activity-table.component';
import { MiniLineChartComponent } from './line-chart.component';

/** One exchange pool (/pool/:id): reserves, price history, liquidity providers, every swap */
@Component({
  selector: 'app-bitassets-pool',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, ActivityTableComponent, MiniLineChartComponent],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <ng-container *ngIf="data$ | async as d; else loading">
      <ng-container *ngIf="d.pool as p; else unknown">
        <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images>
          <a [routerLink]="['/asset' | relativeUrl, p.asset_a_id || 'CHN']">{{ p.asset_a }}</a> / <a [routerLink]="['/asset' | relativeUrl, p.asset_b_id || 'CHN']">{{ p.asset_b }}</a> pool</h1>
        <div class="sub mono">{{ p.pool }} <span *ngIf="p.abandoned" class="pill">abandoned</span></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Price</div><div class="v">{{ p.price | number:'1.0-8' }}</div><div class="s">{{ p.asset_b }} per {{ p.asset_a }}</div></div>
          <div class="kpi"><div class="l">{{ p.asset_a }} reserve</div><div class="v">{{ p.reserve_a | number:'1.0-4' }}</div></div>
          <div class="kpi"><div class="l">{{ p.asset_b }} reserve</div><div class="v">{{ p.reserve_b | number:'1.0-4' }}</div></div>
          <div class="kpi"><div class="l">Swaps</div><div class="v">{{ p.swaps | number }}</div><div class="s">volume {{ p.volume_a | number:'1.0-2' }} {{ p.asset_a }} · {{ p.volume_b | number:'1.0-4' }} {{ p.asset_b }}</div></div>
          <div class="kpi" *ngIf="d.history"><div class="l">Fees earned</div><div class="v">{{ d.history.feesA }}</div><div class="s">{{ p.asset_a }} · {{ d.history.feesB }} {{ p.asset_b }} (0.3 %)</div></div>
          <div class="kpi"><div class="l">LP shares</div><div class="v">{{ p.shares | number }}</div><div class="s">1,000 locked for good · created at {{ p.created | number }}</div></div>
        </div>
        <div class="grid2">
          <div class="box">
            <h5>Price <small class="muted">{{ p.asset_b }} per {{ p.asset_a }}, per block that changed the pool</small></h5>
            <app-mini-line-chart [points]="pricePoints(d.history)" [step]="true" xPrefix="#"></app-mini-line-chart>
          </div>
          <div class="box">
            <h5>Liquidity providers</h5>
            <p *ngIf="!d.history" class="muted">The token ledger is still being built.</p>
            <table class="table table-borderless table-sm" *ngIf="d.history">
              <thead><tr><th>Address</th><th class="text-right">Shares</th><th>Share of the pool</th></tr></thead>
              <tbody><tr *ngFor="let lp of d.history.providers">
                <td class="mono"><a *ngIf="lp.address" [routerLink]="['/address' | relativeUrl, lp.address]">{{ lp.address | slice:0:22 }}…</a></td>
                <td class="text-right">{{ lp.shares | number }}</td>
                <td><div class="bar"><div class="fill" [style.width.%]="100 * lp.share"></div></div> <span class="muted">{{ lp.share * 100 | number:'1.0-2' }}%</span></td>
              </tr></tbody>
            </table>
          </div>
        </div>
        <h2>Activity</h2>
        <div class="box"><app-bitassets-activity [events]="d.history?.activity"></app-bitassets-activity></div>
      </ng-container>
      <ng-template #unknown><h1 class="mt-4">Unknown pool</h1></ng-template>
    </ng-container>
    <ng-template #loading><div class="skeleton-loader mt-4"></div></ng-template>
  </div>`,
})
export class BitassetsPoolPage implements OnInit {
  profile = PROFILE;
  data$: Observable<any>;

  constructor(private api: ChainApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.data$ = this.route.paramMap.pipe(
      map(p => p.get('id') ?? ''),
      switchMap(id => combineLatest([
        this.api.feature$<any>('pool/' + id).pipe(catchError(() => of(null))),
        this.api.feature$<any>('pool/' + id + '/history').pipe(catchError(() => of(null))),
      ])),
      map(([pool, history]) => ({ pool, history })),
    );
  }

  pricePoints(h: any): [number, number][] {
    return (h?.points ?? []).filter((p: any) => p.price !== null).map((p: any) => [p.h, p.price]);
  }
}
