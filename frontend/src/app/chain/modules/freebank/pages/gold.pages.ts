import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, map, of, switchMap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { FreebankApiService, FbLoaded, fbLoaded } from '../freebank-api.service';
import { FB_PAGE_IMPORTS, MARKET_TABS } from '../freebank-kit';
import { Asset, GoldFix, OracleSubmitter, Pool } from '../freebank.interfaces';
import * as F from '../freebank-format';

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
          <table class="table table-borderless table-sm"><thead><tr><th>#</th><th>Key</th><th>Bond</th><th>Bonded</th><th>Last submission</th><th>Unbonding</th></tr></thead><tbody>
            @for (x of list; track x.id) {
              <tr><td>{{ x.id }}</td><td class="mono" [title]="x.pubkey">{{ fx.shortId(x.pubkey, 8) }}</td>
                <td><a [routerLink]="['/tx', x.bondtxid]" [fragment]="'vout=' + x.bondvout" class="mono">{{ fx.shortId(x.bondtxid, 6) }}:{{ x.bondvout }}</a></td>
                <td><a [routerLink]="['/block', x.bondheight]">{{ x.bondheight | number }}</a></td>
                <td>@if (x.lastsubmitheight) {<a [routerLink]="['/block', x.lastsubmitheight]">{{ x.lastsubmitheight | number }}</a><span class="hint ms-2">{{ x.blockssincesubmit | number }} blocks ago</span>} @else {<span class="muted">never</span>}</td>
                <td>@if (x.unbondrequestheight) {since {{ x.unbondrequestheight | number }}} @else {<span class="muted">–</span>}</td></tr>
            } @empty {<tr><td colspan="6" class="empty">No submitter has bonded yet.</td></tr>}
          </tbody></table>
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
          <table class="table table-borderless table-sm"><thead><tr><th>Pool</th><th>House</th><th class="r">Notes</th><th class="r">ECX</th><th class="r">Price</th><th class="r">Fee</th><th class="r">LP shares</th><th>Created</th></tr></thead><tbody>
            @for (p of list; track p.pool_id) {
              <tr><td><a [routerLink]="['/pool', p.pool_id]">#{{ p.pool_id }}</a></td><td><a [routerLink]="['/house', p.house_id]">house {{ p.house_id }}</a></td>
                <td class="r">{{ fx.num(p.note_reserve) }}</td><td class="r">{{ fx.sats(p.btx_reserve) }}</td>
                <td class="r">{{ p.spot_price_sats_x1e8 ? (p.spot_price_sats_x1e8 / 1e8 | number:'1.0-6') + ' sats' : '–' }}</td>
                <td class="r">{{ fx.bps(p.fee_bps) }}</td><td class="r">{{ fx.num(p.lp_supply) }}</td>
                <td><a [routerLink]="['/block', p.createheight]">{{ p.createheight | number }}</a></td></tr>
            } @empty {<tr><td colspan="8" class="empty">No pool yet.</td></tr>}
          </tbody></table>
        </div>
      }
    }
  </div>`,
})
export class FreebankPoolsPage implements OnInit {
  tabs = MARKET_TABS;
  fx = F;
  pools$: Observable<FbLoaded<Pool[]>>;

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

/** /assets: the assets created on the chain (listassets), in asset-id order, a hundred a page */
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
          <table class="table table-borderless table-sm"><thead><tr><th>Ticker</th><th>Headline</th><th class="r">Supply</th><th>Created</th><th>Genesis</th></tr></thead><tbody>
            @for (a of list; track a.asset_id) {
              <tr><td><b>{{ a.ticker }}</b></td><td>{{ a.headline }}</td><td class="r">{{ a.supply / pow10(a.decimals) | number:'1.0-8' }}</td>
                <td><a [routerLink]="['/block', a.height]">{{ a.height | number }}</a></td>
                <td><a [routerLink]="['/tx', a.asset_id]" class="mono">{{ fx.shortId(a.asset_id, 8) }}</a></td></tr>
            } @empty {<tr><td colspan="5" class="empty">No asset yet.</td></tr>}
          </tbody></table>
          <div class="pager">
            @if (starts.length > 1) {<button class="btn btn-sm btn-secondary" (click)="first()">First</button>}
            @if (list.length >= pageSize) {<button class="btn btn-sm btn-secondary" (click)="next(list[list.length - 1].asset_id)">Next →</button>}
          </div>
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

