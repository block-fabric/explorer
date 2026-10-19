import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { ActivityTableComponent } from './activity-table.component';
import { MiniLineChartComponent } from './line-chart.component';

/** One Dutch auction (/auction/:id): the falling price of all that is sold, the bids, what is left */
@Component({
  selector: 'app-bitassets-auction',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, ActivityTableComponent, MiniLineChartComponent],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.pair-title { gap: 10px; flex-wrap: wrap; font-size: 1.6rem; }`],
  template: `
  <div class="container-xl mp">
    <ng-container *ngIf="data$ | async as d; else loading">
      <ng-container *ngIf="d.auction as a; else unknown">
        <h1 class="pair-title">Auction of <app-asset-badge [id]="a.base_id" [label]="a.base" [size]="36"></app-asset-badge> for <app-asset-badge [id]="a.quote_id" [label]="a.quote" [size]="36"></app-asset-badge></h1>
        <div class="sub mono"><app-truncate [text]="a.auction" [link]="['/tx' | relativeUrl, a.auction]" [lastChars]="12"></app-truncate> <span class="pill" [class.on]="a.status === 'open'">{{ a.status }}</span></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Selling</div><div class="v">{{ a.amount | number:'1.0-4' }}</div><div class="s">{{ a.base }} · {{ a.remaining | number:'1.0-4' }} left</div></div>
          <div class="kpi"><div class="l">Unit price now</div><div class="v">{{ a.unit_price | number:'1.0-8' }}</div><div class="s">{{ a.quote }} per {{ a.base }}</div></div>
          <div class="kpi"><div class="l">All the rest costs</div><div class="v">{{ a.cost_of_remaining | number:'1.0-8' }}</div><div class="s">{{ a.quote }} in the next block</div></div>
          <div class="kpi"><div class="l">Proceeds</div><div class="v">{{ a.proceeds | number:'1.0-8' }}</div><div class="s">{{ a.quote }} from {{ a.bids }} bid{{ a.bids === 1 ? '' : 's' }}, not collected</div></div>
          <div class="kpi"><div class="l">Blocks</div><div class="v">{{ a.start_height | number }}–{{ a.end_height | number }}</div><div class="s">price of all {{ a.start_price | number:'1.0-4' }} → {{ a.end_price | number:'1.0-4' }}</div></div>
        </div>
        <div class="box">
          <div class="bar" style="height: 14px"><div class="fill" [style.width.%]="a.amount ? 100 * (a.amount - a.remaining) / a.amount : 0"></div></div>
          <div class="muted" style="font-size: 0.78rem; margin-top: 4px">{{ a.amount ? (100 * (a.amount - a.remaining) / a.amount | number:'1.0-1') : 0 }}% sold</div>
        </div>
        <h2>Price curve <small class="muted" style="font-size: 0.8rem">{{ a.quote }} for all {{ a.amount | number:'1.0-4' }} {{ a.base }}, by block; green dots are bids</small></h2>
        <div class="box"><app-mini-line-chart [points]="curve(d.bids)" [dots]="bidDots(d.bids)" xPrefix="#"></app-mini-line-chart></div>
        <h2>Bids</h2>
        <div class="box"><app-bitassets-activity [events]="d.bids?.bids"></app-bitassets-activity></div>
      </ng-container>
      <ng-template #unknown><h1 class="mt-4">Unknown auction</h1></ng-template>
    </ng-container>
    <ng-template #loading><div class="skeleton-loader mt-4"></div></ng-template>
  </div>`,
})
export class BitassetsAuctionPage implements OnInit {
  profile = PROFILE;
  data$: Observable<any>;

  constructor(private api: ChainApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.data$ = this.route.paramMap.pipe(
      map(p => p.get('id') ?? ''),
      switchMap(id => combineLatest([
        this.api.feature$<any>('auction/' + id).pipe(catchError(() => of(null))),
        this.api.feature$<any>('auction/' + id + '/bids').pipe(catchError(() => of(null))),
      ])),
      map(([auction, bids]) => ({ auction, bids })),
    );
  }

  curve(b: any): [number, number][] {
    return (b?.curve ?? []).map((p: any) => [p.h, Number(p.price)]);
  }

  bidDots(b: any): [number, number, string][] {
    return (b?.bids ?? []).filter((e: any) => e.kind === 'bid' && e.amounts?.price).map((e: any) =>
      [e.h, Number(e.amounts.price), `block ${e.h}: paid ${e.amounts.paid} for ${e.amounts.bought}`]);
  }
}
