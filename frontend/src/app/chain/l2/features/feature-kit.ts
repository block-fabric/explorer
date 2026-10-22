import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS } from '@app/chain/l2/l2-common';
import { L2FeaturePage, L2_FEATURE_PAGES, featurePage } from '@app/chain/l2/l2-nav';
import { L2AddressAssetsComponent, L2AssetComponent, L2TxAssetsComponent } from '@app/chain/l2/features/asset-badge';

/*
 * The building blocks of the chains' own feature pages (chain/modules/<chain>/*.page.ts): the page head with its
 * sibling tabs, a small SVG chart, and the request state of a feature that only some chains have. Chain data is shown
 * by interpolation only (chart tooltips are SVG <title> text).
 */

/** The head of a feature page: mark, title, about line, tabs to the feature's other pages, note */
@Component({
  selector: 'app-l2-feature-head',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss'],
  styles: [`
    :host { display: block; }
    .tabs a.btn-tab { padding: 6px 12px; color: var(--transparent-fg); border-bottom: 2px solid transparent; text-decoration: none; }
    .tabs a.btn-tab.on { color: var(--fg); border-bottom-color: var(--chain-accent, var(--title-fg)); }
    .note { font-size: 0.8rem; color: var(--transparent-fg); max-width: 900px; }
    .sub .id { font-family: monospace; font-size: 0.9rem; word-break: break-all; color: var(--fg); }
  `],
  template: `
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="28" height="28" class="cmark"></app-svg-images> {{ title || page.title }}</h1>
    @if (id) {
      <div class="sub"><span class="id">{{ id }}</span> <app-clipboard [text]="id"></app-clipboard> · <a [routerLink]="['/' + page.path]">all {{ page.title.toLowerCase() }}</a></div>
    } @else {
      <div class="sub">{{ page.about }}</div>
    }
    @if (!id && siblings.length > 1) {
      <div class="tabs">
        @for (s of siblings; track s.path) {<a class="btn-tab" [class.on]="s.path === page.path" [routerLink]="['/' + s.path]">{{ s.title }}</a>}
      </div>
    }
    @if (page.note) {<p class="note">{{ page.note }}</p>}`,
})
export class L2FeatureHeadComponent implements OnChanges {
  /** the feature page's path (l2-nav.ts) */
  @Input() path = '';
  /** an item's page: its id under the title */
  @Input() id: string | null = null;
  /** a title of the item's own (a name, a market's title) */
  @Input() title: string | null = null;
  profile = PROFILE;
  page: L2FeaturePage = L2_FEATURE_PAGES[0];
  siblings: L2FeaturePage[] = [];

  ngOnChanges(): void {
    this.page = featurePage(this.path) ?? L2_FEATURE_PAGES[0];
    this.siblings = L2_FEATURE_PAGES.filter(p => p.feature === this.page.feature);
  }
}

/** A feature's data as a template state, or 'unavailable' when this chain has not the feature */
export function featureData$<T>(api: L2ApiService, feature: string, request: () => Observable<T>): Observable<Loaded<T> | 'unavailable'> {
  return api.features$.pipe(
    map(f => f.includes(feature)),
    distinctUntilChanged(),
    switchMap(on => on ? loaded(request()) : of('unavailable' as const)),
  );
}

export interface ChartSeries {
  name: string;
  color?: string;
  /** [x, y] */
  points: [number, number][];
}

const PALETTE = ['var(--chain-accent, #8f7cff)', '#5aa6ff', '#f26b9c', '#7bd88f', '#f5b83d', '#c9a0ff', '#ff8a3d', '#2ec4b6'];
const W = 600;

/**
 * A small SVG chart of one or more series over block heights: lines, steps or bars. Axis labels are HTML next to
 * the plot; each point's tooltip is an SVG <title> (text, never markup).
 */
@Component({
  selector: 'app-l2-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; }
    .wrap { display: grid; grid-template-columns: 64px 1fr; gap: 6px; }
    .ya { display: flex; flex-direction: column; justify-content: space-between; text-align: right; font-size: 0.7rem; color: var(--transparent-fg); }
    svg { width: 100%; display: block; overflow: visible; }
    .xa { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--transparent-fg); margin-left: 70px; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.75rem; margin-top: 6px; margin-left: 70px; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
    .empty { color: var(--transparent-fg); font-size: 0.85rem; margin: 0; }
    .hit { fill: transparent; } .hit:hover { fill: #ffffff30; }
  `],
  template: `
    @if (drawn.length) {
      <div class="wrap">
        <div class="ya" [style.height.px]="height"><span>{{ fmt(maxY) }}</span><span>{{ fmt((maxY + minY) / 2) }}</span><span>{{ fmt(minY) }}</span></div>
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + height" preserveAspectRatio="none" [style.height.px]="height">
          <line x1="0" [attr.y1]="height - 1" [attr.x2]="w" [attr.y2]="height - 1" stroke="#ffffff22" vector-effect="non-scaling-stroke"/>
          <line x1="0" y1="1" [attr.x2]="w" y2="1" stroke="#ffffff10" vector-effect="non-scaling-stroke"/>
          @for (s of drawn; track $index) {
            @if (kind === 'bar') {
              @for (b of s.bars; track $index) {
                <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="s.color" fill-opacity="0.8"><title>{{ b.tip }}</title></rect>
              }
            } @else {
              @if (drawn.length === 1) {<path [attr.d]="s.area" [attr.fill]="s.color" fill-opacity="0.12"/>}
              <path [attr.d]="s.path" fill="none" [attr.stroke]="s.color" stroke-width="2" vector-effect="non-scaling-stroke"/>
              @for (d of s.dots; track $index) {
                <rect class="hit" [attr.x]="d.x - 3" y="0" width="6" [attr.height]="height"><title>{{ d.tip }}</title></rect>
              }
            }
          }
        </svg>
      </div>
      <div class="xa"><span>{{ xPrefix }}{{ minX | number }}</span><span>{{ xPrefix }}{{ maxX | number }}</span></div>
      @if (drawn.length > 1 || legend) {
        <div class="legend">@for (s of drawn; track $index) {<span><i [style.background]="s.color"></i>{{ s.name }}</span>}</div>
      }
    } @else {
      <p class="empty">{{ emptyText }}</p>
    }`,
})
export class L2ChartComponent implements OnChanges {
  @Input() series: ChartSeries[] = [];
  @Input() kind: 'line' | 'step' | 'bar' = 'line';
  @Input() height = 200;
  /** y values as a percentage (0..1 -> %) */
  @Input() percent = false;
  @Input() unit = '';
  @Input() xPrefix = 'block ';
  @Input() legend = false;
  /** y axis from zero */
  @Input() zero = true;
  @Input() emptyText = 'Not enough data yet.';
  w = W;
  drawn: { name: string; color: string; path: string; area: string; dots: { x: number; tip: string }[]; bars: { x: number; y: number; w: number; h: number; tip: string }[] }[] = [];
  minX = 0;
  maxX = 1;
  minY = 0;
  maxY = 1;

  ngOnChanges(): void {
    const series = (this.series ?? []).map(s => ({ ...s, points: (s.points ?? []).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])) }))
      .filter(s => s.points.length >= (this.kind === 'bar' ? 1 : 2));
    if (!series.length) {
      this.drawn = [];
      return;
    }
    const all = series.flatMap(s => s.points);
    this.minX = Math.min(...all.map(p => p[0]));
    this.maxX = Math.max(...all.map(p => p[0]));
    this.minY = this.zero ? Math.min(0, ...all.map(p => p[1])) : Math.min(...all.map(p => p[1]));
    this.maxY = Math.max(...all.map(p => p[1]));
    if (this.maxY === this.minY) {
      this.maxY = this.minY + (Math.abs(this.minY) || 1);
    }
    const spanX = this.maxX - this.minX || 1;
    const H = this.height;
    // bars: one slot per step of x, the bar filling its slot
    const slots = this.kind === 'bar' ? Math.round(spanX / this.step(all.map(p => p[0]))) + 1 : 1;
    const bw = this.kind === 'bar' ? W / slots : 0;
    const X = (x: number) => (W - bw) * (x - this.minX) / spanX;
    const Y = (y: number) => H - 2 - (H - 4) * (y - this.minY) / (this.maxY - this.minY);
    this.drawn = series.map((s, i) => {
      const color = s.color ?? PALETTE[i % PALETTE.length];
      const pts = [...s.points].sort((a, b) => a[0] - b[0]);
      let d = `M${X(pts[0][0])},${Y(pts[0][1])}`;
      for (let k = 1; k < pts.length; k++) {
        d += this.kind === 'step' ? ` H${X(pts[k][0])} V${Y(pts[k][1])}` : ` L${X(pts[k][0])},${Y(pts[k][1])}`;
      }
      const tip = (p: [number, number]) => `${s.name ? s.name + ': ' : ''}${this.fmt(p[1])} at ${this.xPrefix}${p[0].toLocaleString()}`;
      return {
        name: s.name, color, path: d, area: `${d} V${H} H${X(pts[0][0])} Z`,
        dots: pts.map(p => ({ x: X(p[0]), tip: tip(p) })),
        bars: this.kind === 'bar' ? pts.map(p => ({ x: X(p[0]), y: Math.min(Y(p[1]), Y(0)), w: Math.max(1, bw - 1), h: Math.max(0.5, Math.abs(Y(0) - Y(p[1]))), tip: tip(p) })) : [],
      };
    });
  }

  /** the smallest gap between x values (the bars' width) */
  private step(xs: number[]): number {
    const v = [...new Set(xs)].sort((a, b) => a - b);
    let g = Infinity;
    for (let k = 1; k < v.length; k++) {
      g = Math.min(g, v[k] - v[k - 1]);
    }
    return Number.isFinite(g) && g > 0 ? g : 1;
  }

  fmt(v: number): string {
    if (this.percent) {
      return (v * 100).toFixed(1) + '%';
    }
    const a = Math.abs(v);
    const s = a >= 1e9 ? (v / 1e9).toFixed(2) + 'G' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(1) + 'k'
      : a >= 100 ? Math.round(v).toLocaleString() : Number(v.toPrecision(4)).toString();
    return s + (this.unit ? ' ' + this.unit : '');
  }
}

/** The imports of a chain's feature page */
export const FEATURE_PAGE_IMPORTS = [
  ...L2_PAGE_IMPORTS, L2FeatureHeadComponent, L2ChartComponent, L2AssetComponent, L2TxAssetsComponent, L2AddressAssetsComponent,
];

/** "a few words": an activity or event kind for a table cell */
export function kindLabel(k: string): string {
  return String(k ?? '').replace(/-/g, ' ');
}
