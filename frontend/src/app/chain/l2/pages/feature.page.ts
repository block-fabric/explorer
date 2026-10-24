import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, of, tap, distinctUntilChanged } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, humanize, shortId } from '@app/chain/l2/l2-common';
import { L2FeaturePage, L2_FEATURE_PAGES, featurePage } from '@app/chain/l2/l2-nav';
import { CxColumn } from '@app/chain/components/chain-table/chain-table.component';

/**
 * The chain features' pages (/names, /assets, /auctions, /pools, /markets, /votes, /shielded, /swaps and their
 * /<page>/:id). The backend passes the nodes' own shapes through, lists wrapped as { items: [...] }, so these pages
 * render what is there: an item is an object, or a pair [id, data], or a triple [seq, id, data] (BitAssets); its id
 * is the pair's or triple's, else the first of the usual id fields. Everything else shows as key/value tables.
 */

const ID_KEYS = ['id', 'market_id', 'marketId', 'swap_id', 'swapId', 'name_hash', 'nameHash', 'asset_id', 'assetId', 'txid', 'hash'];

/** Columns put first, by page (substrings of the field names, without _ and in lower case) */
const PREFER: Record<string, string[]> = {
  swaps: ['parentchain', 'recipient', 'l1amount', 'l2amount', 'state', 'status', 'confirmation', 'expir'],
  markets: ['title', 'description', 'state', 'outcome', 'volume', 'fee'],
  names: ['name', 'commitment', 'address', 'pubkey'],
  assets: ['name', 'ticker', 'supply', 'amount'],
  auctions: ['asset', 'start', 'duration', 'price'],
  pools: ['asset', 'reserve', 'outstanding'],
};
const MAX_COLUMNS = 7;

export interface FeatureItem {
  id: string | null;
  fields: Record<string, any>;
  /** its place in the node's list, from 1 */
  n?: number;
}

function isObject(v: any): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function normalizeItem(raw: any): FeatureItem {
  if (Array.isArray(raw)) {
    if (raw.length === 3 && typeof raw[0] === 'number' && typeof raw[1] === 'string') {
      return { id: raw[1], fields: { seq: raw[0], ...(isObject(raw[2]) ? raw[2] : { data: raw[2] }) } };
    }
    if (raw.length === 2 && (typeof raw[0] === 'string' || typeof raw[0] === 'number')) {
      return { id: String(raw[0]), fields: isObject(raw[1]) ? raw[1] : { value: raw[1] } };
    }
    return { id: null, fields: Object.fromEntries(raw.map((v, i) => [String(i), v])) };
  }
  if (isObject(raw)) {
    const k = ID_KEYS.find(key => typeof raw[key] === 'string' || typeof raw[key] === 'number');
    return { id: k ? String(raw[k]) : null, fields: raw };
  }
  return { id: null, fields: { value: raw } };
}

/** a field's value to sort by: numbers and text as they are, anything else not sortable */
function scalar(v: any): number | string | null {
  return typeof v === 'number' || typeof v === 'string' ? v : typeof v === 'boolean' ? Number(v) : null;
}

function columnsOf(items: FeatureItem[], page: string, idKey: string | null): string[] {
  const keys: string[] = [];
  for (const it of items) {
    for (const k of Object.keys(it.fields)) {
      if (!keys.includes(k) && k !== idKey) {
        keys.push(k);
      }
    }
  }
  const prefer = PREFER[page] ?? [];
  const rank = (k: string): number => {
    const n = k.replace(/_/g, '').toLowerCase();
    const i = prefer.findIndex(p => n.includes(p));
    return i < 0 ? prefer.length + (items.some(it => isObject(it.fields[k]) || Array.isArray(it.fields[k])) ? 1 : 0) : i;
  };
  const sorted = keys.map((k, i) => ({ k, i, r: rank(k) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.k);
  const preferred = sorted.filter(k => rank(k) < prefer.length);
  return preferred.length > MAX_COLUMNS ? preferred : sorted.slice(0, Math.max(MAX_COLUMNS, preferred.length));
}

interface FeatureView {
  /** a list ({ items }) */
  items: FeatureItem[] | null;
  columns: string[];
  /** the table's columns: the id, then the fields (keys 'f:<field>') */
  cols: CxColumn<FeatureItem>[];
  /** fields left out of the table */
  hidden: number;
  /** not a list: shown as is */
  object: any;
}

@Component({
  selector: 'app-l2-feature',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.tabs a.btn-tab { padding: 6px 12px; color: var(--transparent-fg); border-bottom: 2px solid transparent; text-decoration: none; }
    .tabs a.btn-tab.on { color: var(--fg); border-bottom-color: var(--chain-accent, var(--title-fg)); }`],
  template: `
  <div class="container-xl mp">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="28" height="28" class="cmark"></app-svg-images> {{ page.title }}</h1>
    <div class="sub">{{ page.about }}</div>
    @if (siblings.length > 1) {
      <div class="tabs">
        @for (s of siblings; track s.path) {<a class="btn-tab" [class.on]="s.path === page.path" [routerLink]="['/' + s.path]">{{ s.title }}</a>}
      </div>
    }
    @if (page.note) {<p class="note">{{ page.note }}</p>}
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">{{ profile.name }} has no {{ page.title.toLowerCase() }}: this page belongs to another sidechain's explorer.</div>
      } @else {
        <app-l2-state [state]="v" [what]="page.title" [height]="400"></app-l2-state>
        @if (v.data; as f) {
          @if (f.items) {
            <div class="box">
              <app-chain-table [rows]="f.items" [columns]="f.cols" [search]="matches" [searchPlaceholder]="page.item + ', any field…'" empty="None yet.">
                <ng-template cxCell="id" let-it>
                  @if (it.id !== null && page.detail) {<a [routerLink]="['/' + page.path, it.id]" class="mono" [title]="it.id">{{ shortId(it.id, 10) }}</a>}
                  @else if (it.id !== null) {<span class="mono" [title]="it.id">{{ shortId(it.id, 10) }}</span>}
                  @else {<span class="muted">#{{ it.n }}</span>}
                </ng-template>
                @for (c of f.columns; track c) {
                  <ng-template [cxCell]="'f:' + c" let-it><app-l2-value [value]="it.fields[c]" [depth]="3"></app-l2-value></ng-template>
                }
              </app-chain-table>
              @if (f.hidden && page.detail) {<div class="muted small mt-2">More fields on each {{ page.item.toLowerCase() }}'s page.</div>}
            </div>
            <div class="muted small mt-1">{{ f.items.length | number }} {{ page.title.toLowerCase() }}</div>
          } @else {
            <div class="box"><app-l2-value [value]="f.object"></app-l2-value></div>
          }
        }
      }
    }
  </div>`,
})
export class L2FeaturePageComponent implements OnInit {
  profile = PROFILE;
  page: L2FeaturePage;
  siblings: L2FeaturePage[] = [];
  view$: Observable<Loaded<FeatureView> | 'unavailable'>;
  shortId = shortId;
  label = humanize;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.page = featurePage(this.route.snapshot.data['page']) ?? L2_FEATURE_PAGES[0];
    this.siblings = L2_FEATURE_PAGES.filter(p => p.feature === this.page.feature);
    this.seo.setTitle(this.page.title);
    this.view$ = this.api.features$.pipe(
      map(f => f.includes(this.page.feature)),
      distinctUntilChanged(),
      switchMap(on => !on ? of('unavailable' as const) : loaded(this.api.feature$<any>(this.page.api).pipe(map(r => this.toView(r))))),
    );
  }

  toView(r: any): FeatureView {
    if (r && Array.isArray(r.items)) {
      const items: FeatureItem[] = r.items.map((x: any, i: number) => ({ ...normalizeItem(x), n: i + 1 }));
      const all = new Set(items.flatMap((it: FeatureItem) => Object.keys(it.fields)));
      const columns = columnsOf(items, this.page.path, null);
      const cols: CxColumn<FeatureItem>[] = [
        { key: 'id', label: this.page.item, sort: it => it.id ?? it.n },
        ...columns.map(c => ({ key: 'f:' + c, label: humanize(c), sort: (it: FeatureItem) => scalar(it.fields[c]) })),
      ];
      return { items, columns, cols, hidden: Math.max(0, all.size - columns.length), object: null };
    }
    return { items: null, columns: [], cols: [], hidden: 0, object: r };
  }

  matches = (it: FeatureItem, q: string): boolean => {
    try {
      return (String(it.id ?? '') + JSON.stringify(it.fields)).toLowerCase().includes(q);
    } catch (e) {
      return false;
    }
  };
}

/** /<page>/:id: one name, asset, market or swap, as the node gives it */
@Component({
  selector: 'app-l2-feature-item',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="28" height="28" class="cmark"></app-svg-images> {{ page.item }}</h1>
    <div class="sub"><span class="id">{{ id }}</span><app-clipboard class="ms-1" [text]="id"></app-clipboard> · <a [routerLink]="['/' + page.path]">all {{ page.title.toLowerCase() }}</a></div>
    @if (page.note) {<p class="note">{{ page.note }}</p>}
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" [what]="page.item" [id]="id" [height]="300"></app-l2-state>
      @if (!v.loading && !v.error) {
        <div class="box"><app-l2-value [value]="v.data"></app-l2-value></div>
      }
    }
  </div>`,
})
export class L2FeatureItemPage implements OnInit {
  profile = PROFILE;
  page: L2FeaturePage;
  id = '';
  view$: Observable<Loaded<any>>;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.page = featurePage(this.route.snapshot.data['page']) ?? L2_FEATURE_PAGES[0];
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.seo.setTitle(this.page.item + ' ' + shortId(id));
      }),
      switchMap(id => loaded(this.api.feature$<any>(this.page.api, id))),
    );
  }
}
