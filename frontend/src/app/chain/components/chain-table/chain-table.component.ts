import {
  ChangeDetectionStrategy, Component, ContentChildren, Directive, Input, OnChanges, QueryList, TemplateRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/*
 * The explorers' data table (the cockpit, mining, the sidechain and module pages): sorting by any sortable column,
 * a search box, chip filters, a choice of rows per page and numbered pages, over rows held in the page. A column's
 * cell is the page's own template (<ng-template cxCell="key" let-row>), or the row's value as text.
 *
 *   <app-chain-table [rows]="rows" [columns]="cols" [search]="matches" [filters]="filters" empty="No bills.">
 *     <ng-template cxCell="height" let-r><a [routerLink]="['/block', r.height]">{{ r.height | number }}</a></ng-template>
 *   </app-chain-table>
 */

export interface CxColumn<T = any> {
  key: string;
  label: string;
  /** sortable: true sorts by row[key]; a function by what it returns (numbers before strings, nulls last) */
  sort?: boolean | ((row: T) => number | string | null | undefined);
  align?: 'left' | 'right' | 'center';
  /** hidden below this breakpoint */
  hide?: 'sm' | 'md' | 'lg';
  /** a tooltip on the head */
  title?: string;
  nowrap?: boolean;
}

export interface CxFilterOption<T = any> { label: string; test: (row: T) => boolean }
/** a row of chips: All, then each option with its count */
export interface CxFilter<T = any> { label?: string; options: CxFilterOption<T>[] }

@Directive({ selector: 'ng-template[cxCell]', standalone: true })
export class CxCellDirective {
  @Input('cxCell') key = '';
  constructor(public tpl: TemplateRef<any>) {}
}

@Component({
  selector: 'app-chain-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./chain-table.component.scss'],
  template: `
    @if (searchable || hasFilters() || title) {
      <div class="cx-tools">
        @if (title) {<div class="cx-title">{{ title }}@if (subtitle) {<span>{{ subtitle }}</span>}</div>}
        @for (f of filters; track $index; let fi = $index) {
          @if (useful(fi)) {
          <div class="cx-chips">
            @if (f.label) {<span class="cx-flabel">{{ f.label }}</span>}
            <button class="cx-chip" [class.on]="chosen[fi] === null" (click)="choose(fi, null)">All <b>{{ rows?.length ?? 0 }}</b></button>
            @for (o of f.options; track o.label; let oi = $index) {
              @if (counts[fi]?.[oi] || chosen[fi] === oi) {
                <button class="cx-chip" [class.on]="chosen[fi] === oi" (click)="choose(fi, oi)">{{ o.label }} <b>{{ counts[fi]?.[oi] ?? 0 }}</b></button>
              }
            }
          </div>
          }
        }
        @if (searchable) {
          <input class="cx-search" type="search" [placeholder]="searchPlaceholder" [ngModel]="query" (ngModelChange)="setQuery($event)" aria-label="Filter the table">
        }
      </div>
    }
    <div class="cx-scroll">
      <table class="cx-table">
        <thead><tr>
          @for (c of columns; track c.key) {
            <th [class]="cls(c)" [attr.title]="c.title ?? null" [class.sortable]="!!c.sort" [class.sorted]="sortKey === c.key"
              (click)="c.sort ? sortBy(c) : null" [attr.aria-sort]="sortKey === c.key ? (sortDir > 0 ? 'ascending' : 'descending') : null">
              {{ c.label }}@if (c.sort) {<i class="cx-arrow">{{ sortKey === c.key ? (sortDir > 0 ? '▲' : '▼') : '↕' }}</i>}
            </th>
          }
        </tr></thead>
        <tbody>
          @for (r of page; track trackRow($index, r)) {
            <tr [class.cx-click]="!!rowClick" (click)="rowClick ? rowClick(r) : null">
              @for (c of columns; track c.key) {
                <td [class]="cls(c)">
                  @if (cells[c.key]; as tpl) {<ng-container *ngTemplateOutlet="tpl; context: { $implicit: r }"></ng-container>} @else {<span>{{ r?.[c.key] ?? '–' }}</span>}
                </td>
              }
            </tr>
          } @empty {
            <tr><td class="cx-empty" [attr.colspan]="columns.length">{{ query || isFiltered() ? 'Nothing matches.' : empty }}</td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (shown.length > pageSizes[0] || pageIndex > 0) {
      <div class="cx-foot">
        <span class="cx-count">{{ from + 1 | number }}–{{ to | number }} of {{ shown.length | number }}</span>
        <label class="cx-size">Rows
          <select [ngModel]="size" (ngModelChange)="setSize($event)">@for (n of pageSizes; track n) {<option [ngValue]="n">{{ n }}</option>}</select>
        </label>
        <div class="cx-pages">
          <button class="cx-pg" [disabled]="pageIndex === 0" (click)="go(pageIndex - 1)" aria-label="Previous page">‹</button>
          @for (p of pageList; track $index) {
            @if (p === null) {<span class="cx-gap">…</span>}
            @else {<button class="cx-pg" [class.on]="p === pageIndex" (click)="go(p)">{{ p + 1 }}</button>}
          }
          <button class="cx-pg" [disabled]="pageIndex >= pages - 1" (click)="go(pageIndex + 1)" aria-label="Next page">›</button>
        </div>
      </div>
    }`,
})
export class ChainTableComponent<T = any> implements OnChanges {
  @Input() rows: T[] | null = [];
  @Input() columns: CxColumn<T>[] = [];
  @Input() filters: CxFilter<T>[] | null = null;
  /** a row matches the search text (lower case); null: no search box */
  @Input() search: ((row: T, q: string) => boolean) | null = null;
  @Input() searchPlaceholder = 'Filter';
  @Input() pageSize = 25;
  @Input() pageSizes = [10, 25, 50, 100];
  /** the initial sort: a column key, descending unless asc */
  @Input() sort: string | null = null;
  @Input() asc = false;
  @Input() empty = 'Nothing yet.';
  @Input() title: string | null = null;
  @Input() subtitle: string | null = null;
  @Input() trackBy: ((row: T) => unknown) | null = null;
  @Input() rowClick: ((row: T) => void) | null = null;

  @ContentChildren(CxCellDirective, { descendants: true }) set cellTemplates(list: QueryList<CxCellDirective>) {
    this.cells = {};
    list?.forEach(d => this.cells[d.key] = d.tpl);
  }
  cells: Record<string, TemplateRef<any>> = {};

  query = '';
  chosen: (number | null)[] = [];
  counts: number[][] = [];
  sortKey: string | null = null;
  sortDir = -1;
  size = 25;
  pageIndex = 0;
  shown: T[] = [];
  page: T[] = [];
  pages = 1;
  pageList: (number | null)[] = [];
  from = 0;
  to = 0;
  private sizeSet = false;

  get searchable(): boolean {
    return !!this.search;
  }

  ngOnChanges(): void {
    if (!this.sizeSet) {
      this.size = this.pageSize;
    }
    if (this.sortKey === null && this.sort) {
      this.sortKey = this.sort;
      this.sortDir = this.asc ? 1 : -1;
    }
    if (this.chosen.length !== (this.filters?.length ?? 0)) {
      this.chosen = (this.filters ?? []).map(() => null);
    }
    this.counts = (this.filters ?? []).map(f => f.options.map(o => (this.rows ?? []).filter(r => o.test(r)).length));
    this.compute(false);
  }

  cls(c: CxColumn<T>): string {
    return [c.align === 'right' ? 'r' : c.align === 'center' ? 'c' : '', c.hide ? `cx-hide-${c.hide}` : '', c.nowrap ? 'nw' : ''].join(' ');
  }

  trackRow = (i: number, r: T): unknown => this.trackBy ? this.trackBy(r) : r;

  /** a filter row is worth showing when two of its options have rows (or one is chosen) */
  useful(fi: number): boolean {
    return this.chosen[fi] !== null || (this.counts[fi] ?? []).filter(c => c > 0).length >= 2;
  }

  hasFilters(): boolean {
    return (this.filters ?? []).some((_, fi) => this.useful(fi));
  }

  isFiltered(): boolean {
    return this.chosen.some(c => c !== null);
  }

  setQuery(q: string): void {
    this.query = q ?? '';
    this.compute(true);
  }

  choose(fi: number, oi: number | null): void {
    this.chosen[fi] = oi;
    this.compute(true);
  }

  sortBy(c: CxColumn<T>): void {
    if (this.sortKey === c.key) {
      this.sortDir = -this.sortDir;
    } else {
      this.sortKey = c.key;
      this.sortDir = -1;
    }
    this.compute(true);
  }

  setSize(n: number): void {
    this.size = Number(n) || this.pageSize;
    this.sizeSet = true;
    this.compute(true);
  }

  go(p: number): void {
    this.pageIndex = Math.max(0, Math.min(this.pages - 1, p));
    this.slice();
  }

  private compute(toFirst: boolean): void {
    const q = this.query.trim().toLowerCase();
    let rows = [...(this.rows ?? [])];
    (this.filters ?? []).forEach((f, fi) => {
      const oi = this.chosen[fi];
      if (oi !== null && oi !== undefined && f.options[oi]) {
        rows = rows.filter(r => f.options[oi].test(r));
      }
    });
    if (q && this.search) {
      rows = rows.filter(r => this.search!(r, q));
    }
    const col = this.columns.find(c => c.key === this.sortKey);
    if (col?.sort) {
      const val = typeof col.sort === 'function' ? col.sort : (r: T) => (r as any)?.[col.key];
      const dir = this.sortDir;
      rows = rows.map((r, i) => ({ r, i, v: val(r) })).sort((a, b) => {
        const an = a.v === null || a.v === undefined || a.v === '';
        const bn = b.v === null || b.v === undefined || b.v === '';
        if (an || bn) {
          return an && bn ? a.i - b.i : an ? 1 : -1; // nulls last, either way
        }
        const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), undefined, { numeric: true });
        return c ? c * dir : a.i - b.i;
      }).map(x => x.r);
    }
    this.shown = rows;
    if (toFirst) {
      this.pageIndex = 0;
    }
    this.slice();
  }

  private slice(): void {
    this.pages = Math.max(1, Math.ceil(this.shown.length / this.size));
    this.pageIndex = Math.min(this.pageIndex, this.pages - 1);
    this.from = this.pageIndex * this.size;
    this.to = Math.min(this.shown.length, this.from + this.size);
    this.page = this.shown.slice(this.from, this.to);
    // 1 … 4 5 [6] 7 8 … 20
    const n = this.pages;
    const cur = this.pageIndex;
    const want = new Set([0, n - 1, cur - 2, cur - 1, cur, cur + 1, cur + 2].filter(p => p >= 0 && p < n));
    const list: (number | null)[] = [];
    [...want].sort((a, b) => a - b).forEach((p, i, arr) => {
      if (i && p - arr[i - 1] > 1) {
        list.push(null);
      }
      list.push(p);
    });
    this.pageList = list;
  }
}
