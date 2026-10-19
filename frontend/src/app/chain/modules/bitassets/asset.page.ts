import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { ActivityTableComponent } from './activity-table.component';

/** One asset (/asset/:id, id = name, 0x<hash> or #seq): supply, holders, pools, auctions, every operation */
@Component({
  selector: 'app-bitassets-asset',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, ActivityTableComponent],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .id-row { display: flex; gap: 12px; align-items: baseline; } .id-row app-truncate { min-width: 0; } .seq { flex: 0 0 auto; }
    .asset-title { gap: 14px; flex-wrap: wrap; } .asset-title .display { font-size: 1.1rem; color: var(--transparent-fg); font-weight: normal; }
    .addr { max-width: 340px; } .pair { white-space: nowrap; } .sep { margin: 0 8px; color: var(--transparent-fg); }
    .dist { display: flex; height: 14px; border-radius: 7px; overflow: hidden; gap: 2px; margin: 6px 0 4px; }
    .dist span { min-width: 2px; }
    .legend { display: flex; gap: 14px; font-size: 0.75rem; color: var(--transparent-fg); flex-wrap: wrap; i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; } }
  `],
  template: `
  <div class="container-xl mp">
    <ng-container *ngIf="data$ | async as d; else loading">
      <ng-container *ngIf="d.info?.asset as a; else unknown">
        <h1 class="asset-title"><app-asset-badge [id]="a.asset" [label]="a.label" [size]="48" [link]="false"></app-asset-badge>
          <span *ngIf="a.display_name" class="display">{{ a.display_name }}</span></h1>
        <div class="sub mono id-row"><app-truncate [text]="a.asset" [lastChars]="12"></app-truncate><span class="seq">#{{ a.seq }}</span></div>
        <div class="kpis">
          <div class="kpi"><div class="l">Supply</div><div class="v">{{ a.supply | number:'1.0-' + a.decimals }}</div><div class="s">minted {{ a.minted | number:'1.0-' + a.decimals }} · burned {{ a.burned | number:'1.0-' + a.decimals }}</div></div>
          <div class="kpi"><div class="l">Holders</div><div class="v">{{ d.holders?.holders ?? '…' | number }}</div><div class="s">addresses with a balance</div></div>
          <div class="kpi" *ngIf="d.market?.price !== null && d.market?.price !== undefined"><div class="l">Price</div><div class="v">{{ d.market.price | number:'1.0-8' }}</div><div class="s">CHN · market cap {{ d.market.marketCap | number:'1.0-2' }}</div></div>
          <div class="kpi" *ngIf="d.market"><div class="l">Volume 24 h</div><div class="v">{{ d.market.volume24h }}</div><div class="s">{{ d.market.trades24h }} trades</div></div>
          <div class="kpi"><div class="l">Supply policy</div><div class="v">{{ a.fixed ? 'fixed' : 'mintable' }}</div><div class="s">{{ a.decimals }} decimals</div></div>
          <div class="kpi"><div class="l">Registered</div><div class="v"><a [routerLink]="['/tx' | relativeUrl, a.registration]">{{ a.registered | number }}</a></div><div class="s">block height</div></div>
        </div>

        <div class="grid2">
          <div class="box">
            <h5>Where the supply is</h5>
            <ng-container *ngIf="d.holders as h">
              <div class="dist">
                <span [style.flex]="+h.held" style="background: var(--chain-accent)" [title]="'held: ' + h.held"></span>
                <span [style.flex]="+h.inPools" style="background: #b5f27e" [title]="'in pools: ' + h.inPools"></span>
                <span [style.flex]="+h.inAuctions" style="background: #ffd166" [title]="'in auctions: ' + h.inAuctions"></span>
                <span [style.flex]="+h.inContracts" style="background: #5aa6ff" [title]="'in contracts: ' + h.inContracts"></span>
              </div>
              <div class="legend">
                <span><i style="background: var(--chain-accent)"></i>held {{ h.held }}</span>
                <span><i style="background: #b5f27e"></i>pools {{ h.inPools }}</span>
                <span><i style="background: #ffd166"></i>auctions {{ h.inAuctions }}</span>
                <span *ngIf="+h.inContracts"><i style="background: #5aa6ff"></i>contracts {{ h.inContracts }}</span>
              </div>
            </ng-container>
            <table class="table table-borderless table-sm mt-3">
              <tr *ngIf="d.holders?.controller"><td class="muted">Controlled by</td><td class="mono addr"><app-truncate [text]="d.holders.controller" [link]="['/address' | relativeUrl, d.holders.controller]" [lastChars]="6"></app-truncate></td></tr>
              <tr *ngFor="let kv of entries(a.data)"><td class="muted">{{ kv[0] }}</td><td>{{ kv[1] }}</td></tr>
            </table>
          </div>
          <div class="box">
            <h5>Top holders</h5>
            <p *ngIf="!d.holders" class="muted">The token ledger is still being built.</p>
            <table class="table table-borderless table-sm" *ngIf="d.holders">
              <thead><tr><th>Address</th><th class="text-right">Balance</th><th>Share</th></tr></thead>
              <tbody>
                <tr *ngFor="let h of d.holders.top.slice(0, 15)">
                  <td class="mono addr"><app-truncate *ngIf="h.address" [text]="h.address" [link]="['/address' | relativeUrl, h.address]" [lastChars]="6"></app-truncate><span *ngIf="!h.address" class="muted">non-standard</span></td>
                  <td class="text-right">{{ h.amount }}</td>
                  <td><div class="bar"><div class="fill" [style.width.%]="100 * h.share"></div></div></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <h2 *ngIf="d.info.pools?.length">Pools</h2>
        <div class="box" *ngIf="d.info.pools?.length">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Pool</th><th class="text-right">Reserves</th><th class="text-right">Price</th><th class="text-right">Swaps</th></tr></thead>
            <tbody><tr *ngFor="let p of d.info.pools">
              <td class="pair"><app-asset-badge [id]="p.asset_a_id" [label]="p.asset_a" [link]="false"></app-asset-badge><span class="sep">/</span><app-asset-badge [id]="p.asset_b_id" [label]="p.asset_b" [link]="false"></app-asset-badge>
                <a class="ms-2" [routerLink]="['/pool' | relativeUrl, p.pool]">pool</a></td>
              <td class="text-right">{{ p.reserve_a | number:'1.0-4' }} {{ p.asset_a }} · {{ p.reserve_b | number:'1.0-4' }} {{ p.asset_b }}</td>
              <td class="text-right">{{ p.price | number:'1.0-8' }} {{ p.asset_b }}</td>
              <td class="text-right">{{ p.swaps }}</td>
            </tr></tbody>
          </table>
        </div>

        <h2 *ngIf="d.info.auctions?.length">Auctions</h2>
        <div class="box" *ngIf="d.info.auctions?.length">
          <table class="table table-borderless table-sm">
            <tbody><tr *ngFor="let x of d.info.auctions">
              <td class="pair"><app-asset-badge [id]="x.base_id" [label]="x.base" [link]="false"></app-asset-badge><span class="sep">for</span><app-asset-badge [id]="x.quote_id" [label]="x.quote" [link]="false"></app-asset-badge>
                <a class="ms-2" [routerLink]="['/auction' | relativeUrl, x.auction]">auction</a></td>
              <td class="text-right">{{ x.remaining | number:'1.0-4' }} / {{ x.amount | number:'1.0-4' }} left</td>
              <td class="text-right">{{ x.price | number:'1.0-8' }} {{ x.quote }}</td>
              <td><span class="pill" [class.on]="x.status === 'open'">{{ x.status }}</span></td>
            </tr></tbody>
          </table>
        </div>

        <h2>Activity</h2>
        <div class="box"><app-bitassets-activity [events]="d.activity"></app-bitassets-activity></div>
      </ng-container>
      <ng-template #unknown><h1 class="mt-4">Unknown asset</h1><p class="muted">No asset has this name, hash or number.</p></ng-template>
    </ng-container>
    <ng-template #loading><div class="skeleton-loader mt-4"></div></ng-template>
  </div>`,
})
export class BitassetsAssetPage implements OnInit {
  profile = PROFILE;
  data$: Observable<any>;

  constructor(private api: ChainApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.data$ = this.route.paramMap.pipe(
      map(p => encodeURIComponent(p.get('id') ?? '')),
      switchMap(id => combineLatest([
        this.api.feature$<any>('asset/' + id).pipe(catchError(() => of(null))),
        this.api.feature$<any>('asset/' + id + '/holders').pipe(catchError(() => of(null))),
        this.api.feature$<any[]>('asset/' + id + '/activity', { limit: 100 }).pipe(catchError(() => of([]))),
        this.api.feature$<any>('markets').pipe(catchError(() => of({}))),
      ])),
      map(([info, holders, activity, markets]) => ({ info, holders, activity, market: info?.asset ? markets?.[info.asset.asset] : null })),
    );
  }

  entries(o: any): [string, any][] {
    return Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined);
  }
}
