import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, map, of, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { FreebankApiService, FbLoaded, fbLoaded } from '../freebank-api.service';
import { FB_PAGE_IMPORTS, MARKET_TABS } from '../freebank-kit';
import { Asset, GoldFix, OracleSubmitter, Pool } from '../freebank.interfaces';
import * as F from '../freebank-format';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../freebank-page.scss'];
const ASSETS_PAGE = 100;

/**
 * /gold: the on-chain gold fix (getgoldfix: milligrams of gold per 1000 ECX, the raw median of the last quorum and its
 * braked view; null before the first fix) and the bonded price submitters (listoraclesubmitters)
 */
@Component({
  selector: 'app-freebank-gold-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Gold fix" sub="One shared price of ECX in gold, the median of the bonded submitters' prices; consensus-inert for now: the credit rules do not read it yet" [tabs]="tabs" active="/gold"></app-fb-head>
    @if (fix$ | async; as v) {
      <app-fb-state [state]="v" what="The gold fix" [height]="120"></app-fb-state>
      @if (!v.loading && !v.error) {
        @if (v.data; as g) {
          <div class="kpis">
            <div class="kpi"><div class="l">Fix (raw)</div><div class="v">{{ g.raw | number }}</div><div class="s">mg of gold per 1000 ECX</div></div>
            <div class="kpi"><div class="l">Braked</div><div class="v">{{ g.braked | number }}</div><div class="s">follows raw up freely, down bounded</div></div>
            <div class="kpi"><div class="l">Formed at</div><div class="v"><a [routerLink]="['/block', g.fixheight]">{{ g.fixheight | number }}</a></div><div class="s">@if (g.ageblocks !== undefined) {{{ g.ageblocks | number }} blocks ago}</div></div>
            <div class="kpi"><div class="l">1 ECX</div><div class="v">{{ g.raw / 1000 | number:'1.0-3' }}</div><div class="s">mg of gold</div></div>
          </div>
        } @else {
          <div class="unavail">No gold fix yet: the chain has no price until a quorum of submitters first forms one.</div>
        }
      }
    }
    <h2>Price submitters <span class="hint">listoraclesubmitters</span></h2>
    <div class="box">
      @if (subs$ | async; as s) {
        <app-fb-state [state]="s" what="The submitters" [height]="120"></app-fb-state>
        @if (s.data; as list) {
          <app-chain-table [rows]="list" [columns]="subCols" [filters]="subFilters" [search]="subMatches" searchPlaceholder="Submitter, key, bond…"
            sort="id" [asc]="true" empty="No submitter has bonded yet." [trackBy]="trackId">
            <ng-template cxCell="pubkey" let-x><span class="mono" [title]="x.pubkey">{{ fx.shortId(x.pubkey, 8) }}</span></ng-template>
            <ng-template cxCell="bond" let-x><a [routerLink]="['/tx', x.bondtxid]" [fragment]="'vout=' + x.bondvout" class="mono">{{ fx.shortId(x.bondtxid, 6) }}:{{ x.bondvout }}</a></ng-template>
            <ng-template cxCell="bondheight" let-x><a [routerLink]="['/block', x.bondheight]">{{ x.bondheight | number }}</a></ng-template>
            <ng-template cxCell="last" let-x>@if (x.lastsubmitheight) {<a [routerLink]="['/block', x.lastsubmitheight]">{{ x.lastsubmitheight | number }}</a><span class="hint ms-2">{{ x.blockssincesubmit | number }} blocks ago</span>} @else {<span class="muted">never</span>}</ng-template>
            <ng-template cxCell="unbond" let-x>@if (x.unbondrequestheight) {since {{ x.unbondrequestheight | number }}} @else {<span class="muted">–</span>}</ng-template>
          </app-chain-table>
          <p class="note mt-2 mb-0">A gap in a submitter's heights does not prove it was absent: the block producer may have left its submission out.</p>
        }
      }
    </div>
  </div>`,
})
export class FreebankGoldPage implements OnInit {
  tabs = MARKET_TABS;
  fx = F;
  fix$: Observable<FbLoaded<GoldFix | null>>;
  subs$: Observable<FbLoaded<OracleSubmitter[]>>;
  trackId = (x: OracleSubmitter) => x.id;
  subMatches = (x: OracleSubmitter, q: string) => String(x.id) === q || x.pubkey.toLowerCase().includes(q) || x.bondtxid.toLowerCase().includes(q);
  subCols: CxColumn<OracleSubmitter>[] = [
    { key: 'id', label: '#', sort: x => x.id },
    { key: 'pubkey', label: 'Key' },
    { key: 'bond', label: 'Bond', hide: 'md' },
    { key: 'bondheight', label: 'Bonded', sort: x => x.bondheight },
    { key: 'last', label: 'Last submission', sort: x => x.lastsubmitheight || null, nowrap: true },
    { key: 'unbond', label: 'Unbonding', sort: x => x.unbondrequestheight || null },
  ];
  subFilters: CxFilter<OracleSubmitter>[] = [{ options: [
    { label: 'bonded', test: x => !x.unbondrequestheight }, { label: 'unbonding', test: x => !!x.unbondrequestheight },
    { label: 'never submitted', test: x => !x.lastsubmitheight },
  ] }];

  constructor(private api: FreebankApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: gold fix`);
    this.fix$ = fbLoaded(this.api.rpc$<GoldFix | null>('getgoldfix'));
    this.subs$ = fbLoaded(this.api.rpc$<OracleSubmitter[]>('listoraclesubmitters').pipe(map(l => l ?? [])));
  }
}

/** /pools: the note/ECX pools (listpools), one per house */
@Component({
  selector: 'app-freebank-pools-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Note pools" sub="A house's notes against ECX in an AMM pool, one pool per house" [tabs]="tabs" active="/pools"></app-fb-head>
    @if (pools$ | async; as v) {
      <app-fb-state [state]="v" what="The pools" [height]="200"></app-fb-state>
      @if (v.data; as list) {
        <div class="box">
          <app-chain-table [rows]="list" [columns]="poolCols" [search]="poolMatches" searchPlaceholder="Pool, house…" sort="pool_id" [asc]="true"
            empty="No pool yet." [trackBy]="trackPool">
            <ng-template cxCell="pool_id" let-p><a [routerLink]="['/pool', p.pool_id]">#{{ p.pool_id }}</a></ng-template>
            <ng-template cxCell="house_id" let-p><a [routerLink]="['/house', p.house_id]">house {{ p.house_id }}</a></ng-template>
            <ng-template cxCell="note_reserve" let-p>{{ fx.num(p.note_reserve) }}</ng-template>
            <ng-template cxCell="btx_reserve" let-p>{{ fx.sats(p.btx_reserve) }}</ng-template>
            <ng-template cxCell="price" let-p>{{ p.spot_price_sats_x1e8 ? (p.spot_price_sats_x1e8 / 1e8 | number:'1.0-6') + ' sats' : '–' }}</ng-template>
            <ng-template cxCell="fee_bps" let-p>{{ fx.bps(p.fee_bps) }}</ng-template>
            <ng-template cxCell="lp_supply" let-p>{{ fx.num(p.lp_supply) }}</ng-template>
            <ng-template cxCell="createheight" let-p><a [routerLink]="['/block', p.createheight]">{{ p.createheight | number }}</a></ng-template>
          </app-chain-table>
        </div>
      }
    }
  </div>`,
})
export class FreebankPoolsPage implements OnInit {
  tabs = MARKET_TABS;
  fx = F;
  pools$: Observable<FbLoaded<Pool[]>>;
  trackPool = (p: Pool) => p.pool_id;
  poolMatches = (p: Pool, q: string) => String(p.pool_id) === q.replace(/^#/, '') || `house ${p.house_id}` === q || String(p.house_id) === q;
  poolCols: CxColumn<Pool>[] = [
    { key: 'pool_id', label: 'Pool', sort: true },
    { key: 'house_id', label: 'House', sort: true, nowrap: true },
    { key: 'note_reserve', label: 'Notes', align: 'right', sort: true, nowrap: true },
    { key: 'btx_reserve', label: 'ECX', align: 'right', sort: true, nowrap: true },
    { key: 'price', label: 'Price', align: 'right', sort: p => p.spot_price_sats_x1e8 || null, nowrap: true },
    { key: 'fee_bps', label: 'Fee', align: 'right', sort: true },
    { key: 'lp_supply', label: 'LP shares', align: 'right', sort: true, hide: 'md' },
    { key: 'createheight', label: 'Created', sort: true, hide: 'md' },
  ];

  constructor(private api: FreebankApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: note pools`);
    this.pools$ = fbLoaded(this.api.rpc$<Pool[]>('listpools').pipe(map(l => l ?? [])));
  }
}

/** /pool/:id: a pool (getpool): its reserves, price, fee, shares and custody outpoints */
@Component({
  selector: 'app-freebank-pool-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head [title]="'Pool #' + id" [tabs]="tabs" active="/pools"></app-fb-head>
    @if (pool$ | async; as v) {
      <app-fb-state [state]="v" what="Pool" [id]="id" [height]="200"></app-fb-state>
      @if (v.data; as p) {
        <div class="kpis">
          <div class="kpi"><div class="l">Notes</div><div class="v">{{ fx.num(p.note_reserve) }}</div><div class="s">of <a [routerLink]="['/house', p.house_id]">house {{ p.house_id }}</a></div></div>
          <div class="kpi"><div class="l">ECX</div><div class="v">{{ fx.sats(p.btx_reserve) }}</div><div class="s">reserve</div></div>
          <div class="kpi"><div class="l">Price</div><div class="v">{{ p.spot_price_sats_x1e8 ? (p.spot_price_sats_x1e8 / 1e8 | number:'1.0-6') : '–' }}</div><div class="s">sats per note unit</div></div>
          <div class="kpi"><div class="l">Fee</div><div class="v">{{ fx.bps(p.fee_bps) }}</div><div class="s">{{ fx.num(p.lp_supply) }} LP shares</div></div>
        </div>
        <div class="box mt-3">
          <table class="kv"><tbody>
            <tr><th>Notes in custody</th><td><a [routerLink]="['/tx', p.note_escrow_txid]" [fragment]="'vout=' + p.note_escrow_vout" class="mono">{{ p.note_escrow_txid }}:{{ p.note_escrow_vout }}</a></td></tr>
            <tr><th>ECX in custody</th><td><a [routerLink]="['/tx', p.btx_escrow_txid]" [fragment]="'vout=' + p.btx_escrow_vout" class="mono">{{ p.btx_escrow_txid }}:{{ p.btx_escrow_vout }}</a></td></tr>
            <tr><th>Created</th><td>block <a [routerLink]="['/block', p.createheight]">{{ p.createheight | number }}</a></td></tr>
            @if (p.locked_lp) {<tr><th>Locked shares</th><td>{{ fx.num(p.locked_lp) }}</td></tr>}
          </tbody></table>
        </div>
      }
    }
  </div>`,
})
export class FreebankPoolPage implements OnInit {
  tabs = MARKET_TABS;
  fx = F;
  id = '';
  pool$: Observable<FbLoaded<Pool>>;

  constructor(private route: ActivatedRoute, private api: FreebankApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.pool$ = this.route.paramMap.pipe(map(p => p.get('id') ?? ''), switchMap(id => {
      this.id = id;
      this.seo.setTitle(`${PROFILE.name}: pool ${id}`);
      return /^\d{1,9}$/.test(id) ? fbLoaded(this.api.rpc$<Pool>('getpool', Number(id)))
        : of({ loading: false, error: { status: 400, message: 'Not a valid id' } } as FbLoaded<Pool>);
    }));
  }
}

/** /assets: the assets created on the chain (listassets), in asset-id order from the node a hundred at a time, sorted and searched in the table */
@Component({
  selector: 'app-freebank-assets-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Assets" sub="Anyone may create an asset and tickers are not unique: an asset is its id (its genesis transaction), and a token is only as good as its issuer" [tabs]="tabs" active="/assets"></app-fb-head>
    @if (assets$ | async; as v) {
      <app-fb-state [state]="v" what="The assets" [height]="200"></app-fb-state>
      @if (v.data; as list) {
        <div class="box">
          <app-chain-table [rows]="list" [columns]="assetCols" [search]="assetMatches" searchPlaceholder="Ticker, headline, id…"
            empty="No asset yet." [trackBy]="trackAsset">
            <ng-template cxCell="ticker" let-a><b>{{ a.ticker }}</b></ng-template>
            <ng-template cxCell="supply" let-a>{{ a.supply / pow10(a.decimals) | number:'1.0-8' }}</ng-template>
            <ng-template cxCell="height" let-a><a [routerLink]="['/block', a.height]">{{ a.height | number }}</a></ng-template>
            <ng-template cxCell="asset_id" let-a><a [routerLink]="['/tx', a.asset_id]" class="mono">{{ fx.shortId(a.asset_id, 8) }}</a></ng-template>
          </app-chain-table>
          @if (starts.length > 1 || list.length >= pageSize) {
            <div class="pager">
              <span>assets {{ (starts.length - 1) * pageSize + 1 | number }}–{{ (starts.length - 1) * pageSize + list.length | number }}, in asset-id order</span>
              @if (starts.length > 1) {<button class="btn btn-sm" (click)="first()">First</button>}
              @if (list.length >= pageSize) {<button class="btn btn-sm" (click)="next(list[list.length - 1].asset_id)">Next {{ pageSize }} →</button>}
            </div>
          }
        </div>
      }
    }
  </div>`,
})
export class FreebankAssetsPage implements OnInit {
  tabs = MARKET_TABS;
  fx = F;
  pageSize = ASSETS_PAGE;
  starts: (string | null)[] = [null];
  private start$ = new BehaviorSubject<string | null>(null);
  assets$: Observable<FbLoaded<Asset[]>>;
  trackAsset = (a: Asset) => a.asset_id;
  assetMatches = (a: Asset, q: string) => [a.ticker, a.headline, a.asset_id].some(x => String(x ?? '').toLowerCase().includes(q));
  assetCols: CxColumn<Asset>[] = [
    { key: 'ticker', label: 'Ticker', sort: true, nowrap: true },
    { key: 'headline', label: 'Headline', sort: true },
    { key: 'supply', label: 'Supply', align: 'right', sort: a => a.supply / this.pow10(a.decimals), nowrap: true },
    { key: 'height', label: 'Created', sort: true },
    { key: 'asset_id', label: 'Genesis', sort: true, hide: 'sm' },
  ];

  constructor(private api: FreebankApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: assets`);
    // "from_asset_id" is inclusive: the page after drops the asset it starts at
    this.assets$ = this.start$.pipe(switchMap(start => fbLoaded(this.api.rpc$<Asset[]>('listassets', start ?? '', ASSETS_PAGE + (start ? 1 : 0))
      .pipe(map(l => start ? (l ?? []).filter(a => a.asset_id !== start) : (l ?? []))))));
  }

  pow10(d: number): number {
    return Math.pow(10, Number(d) || 0);
  }

  next(last: string): void {
    this.starts.push(last);
    this.start$.next(last);
  }

  first(): void {
    this.starts = [null];
    this.start$.next(null);
  }
}

