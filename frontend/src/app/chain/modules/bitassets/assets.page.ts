import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { ActivityTableComponent } from './activity-table.component';

/** BitAssets: the assets, the exchange pools (constant product, 0.3% fee) and the Dutch auctions (/assets) */
@Component({
  selector: 'app-bitassets-assets',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, ActivityTableComponent],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp" *ngIf="data$ | async as d">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> Assets</h1>
    <div class="sub">Assets issued on {{ profile.name }}, traded in exchange pools against each other and CHN, and sold in Dutch auctions.</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Assets</div><div class="v">{{ d.info?.assets | number }}</div><div class="s">{{ d.info?.reservations }} reservations</div></div>
      <div class="kpi"><div class="l">Pools</div><div class="v">{{ d.info?.pools | number }}</div><div class="s">{{ chnLiquidity(d.pools) | number:'1.0-2' }} CHN of liquidity</div></div>
      <div class="kpi"><div class="l">Swaps</div><div class="v">{{ swaps(d.pools) | number }}</div><div class="s">across all pools</div></div>
      <div class="kpi"><div class="l">Auctions</div><div class="v">{{ open(d.auctions) }}</div><div class="s">open of {{ d.info?.auctions_all }}</div></div>
    </div>

    <div class="tabs">
      <button [class.on]="tab === 'assets'" (click)="tab = 'assets'">Assets</button>
      <button [class.on]="tab === 'pools'" (click)="tab = 'pools'">Pools</button>
      <button [class.on]="tab === 'auctions'" (click)="tab = 'auctions'">Auctions</button>
      <button [class.on]="tab === 'activity'" (click)="tab = 'activity'">Activity</button>
    </div>

    <div class="box" *ngIf="tab === 'assets'">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Asset</th><th class="text-right">Supply</th><th class="text-right">Minted</th><th class="text-right">Burned</th><th>Supply</th><th>Registered</th><th>Info</th></tr></thead>
        <tbody>
          <tr *ngFor="let a of d.assets">
            <td><a [routerLink]="['/asset' | relativeUrl, a.asset]"><b>{{ a.label || a.name }}</b></a> <span class="muted mono">{{ a.asset | slice:0:8 }}</span></td>
            <td class="text-right">{{ a.supply | number:'1.0-' + a.decimals }}</td>
            <td class="text-right muted">{{ a.minted | number:'1.0-' + a.decimals }}</td>
            <td class="text-right muted">{{ a.burned | number:'1.0-' + a.decimals }}</td>
            <td><span class="pill" [class.on]="a.fixed">{{ a.fixed ? 'fixed' : 'mintable' }}</span></td>
            <td><a [routerLink]="['/tx' | relativeUrl, a.registration]">{{ a.registered | number }}</a></td>
            <td class="muted">{{ a.data?.info }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="box" *ngIf="tab === 'pools'">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Pool</th><th class="text-right">Reserve</th><th class="text-right">Reserve</th><th class="text-right">Price</th><th>Depth</th><th class="text-right">Swaps</th><th class="text-right">Volume</th><th>Created</th></tr></thead>
        <tbody>
          <tr *ngFor="let p of d.pools">
            <td><a [routerLink]="['/pool' | relativeUrl, p.pool]"><b>{{ p.asset_a }}</b> / <b>{{ p.asset_b }}</b></a> <span *ngIf="p.abandoned" class="pill">abandoned</span></td>
            <td class="text-right">{{ p.reserve_a | number:'1.0-4' }} <span class="muted">{{ p.asset_a }}</span></td>
            <td class="text-right">{{ p.reserve_b | number:'1.0-4' }} <span class="muted">{{ p.asset_b }}</span></td>
            <td class="text-right">{{ p.price | number:'1.0-8' }} <span class="muted">{{ p.asset_b }}/{{ p.asset_a }}</span></td>
            <td><div class="bar"><div class="fill" [style.width.%]="depth(d.pools, p)"></div></div></td>
            <td class="text-right">{{ p.swaps | number }}</td>
            <td class="text-right muted">{{ p.volume_a | number:'1.0-2' }} / {{ p.volume_b | number:'1.0-4' }}</td>
            <td class="muted">{{ p.created | number }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="box" *ngIf="tab === 'activity'"><app-bitassets-activity [events]="d.activity"></app-bitassets-activity></div>

    <div class="box" *ngIf="tab === 'auctions'">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Auction</th><th class="text-right">Selling</th><th>Sold</th><th class="text-right">Price now</th><th class="text-right">Start → end</th><th>Blocks</th><th class="text-right">Bids</th><th>Status</th></tr></thead>
        <tbody>
          <tr *ngFor="let a of d.auctions">
            <td><a [routerLink]="['/auction' | relativeUrl, a.auction]"><b>{{ a.base }}</b> for {{ a.quote }}</a></td>
            <td class="text-right">{{ a.amount | number:'1.0-4' }}</td>
            <td><div class="bar"><div class="fill" [style.width.%]="a.amount ? 100 * (a.amount - a.remaining) / a.amount : 0"></div></div></td>
            <td class="text-right">{{ a.price | number:'1.0-8' }} <span class="muted">{{ a.quote }}</span></td>
            <td class="text-right muted">{{ a.start_price | number:'1.0-4' }} → {{ a.end_price | number:'1.0-4' }}</td>
            <td class="muted">{{ a.start_height | number }}–{{ a.end_height | number }}</td>
            <td class="text-right">{{ a.bids }}</td>
            <td><span class="pill" [class.on]="a.status === 'open'">{{ a.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
})
export class BitassetsAssetsPage implements OnInit {
  profile = PROFILE;
  tab: 'assets' | 'pools' | 'auctions' | 'activity' = 'assets';
  data$: Observable<any>;

  constructor(private api: ChainApiService) {}

  ngOnInit(): void {
    const get = (p: string) => this.api.feature$<any>(p).pipe(catchError(() => of(null)));
    this.data$ = combineLatest([get('info'), get('assets'), get('pools'), get('auctions'), this.api.feature$<any[]>('activity', { limit: 100 }).pipe(catchError(() => of([])))]).pipe(
      map(([info, assets, pools, auctions, activity]) => ({ info, activity, assets: assets ?? [], pools: (pools ?? []).sort((a: any, b: any) => b.reserve_b - a.reserve_b), auctions: auctions ?? [] })),
    );
  }

  chnLiquidity(pools: any[]): number {
    return pools.filter(p => p.asset_b === 'CHN').reduce((a, p) => a + Number(p.reserve_b), 0);
  }

  swaps(pools: any[]): number {
    return pools.reduce((a, p) => a + p.swaps, 0);
  }

  open(auctions: any[]): number {
    return auctions.filter(a => a.status === 'open').length;
  }

  depth(pools: any[], p: any): number {
    const max = Math.max(...pools.map(x => Number(x.reserve_b)), 1e-9);
    return 100 * Number(p.reserve_b) / max;
  }
}
