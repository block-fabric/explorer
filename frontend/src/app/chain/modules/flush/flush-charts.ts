import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Book, Candle, CurveParams, PoolTicks } from './flush.interfaces';
import * as F from './flush-format';

/*
 * Flush's charts in plain SVG: candles with volume, a launch's bonding curve, a concentrated pool's liquidity by
 * tick, a book's depth. Axis labels are HTML beside the plot; each mark's tooltip is an SVG <title> (text, never markup).
 */

const W = 800;
const UP = '#3bd16f';
const DOWN = '#ff6b6b';
const STYLES = `
  :host { display: block; }
  .wrap { display: grid; grid-template-columns: 74px 1fr; gap: 6px; }
  .ya { display: flex; flex-direction: column; justify-content: space-between; text-align: right; font-size: 0.7rem; color: var(--transparent-fg); white-space: nowrap; }
  svg { width: 100%; display: block; overflow: visible; }
  .xa { display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--transparent-fg); margin-left: 80px; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 0.75rem; margin: 6px 0 0 80px; color: var(--transparent-fg); }
  .legend b { color: var(--fg); font-weight: 600; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
  .empty { color: var(--transparent-fg); font-size: 0.85rem; margin: 0; padding: 20px 0; }
  .hit { fill: transparent; } .hit:hover { fill: #ffffff14; }
`;

/** Candles (OHLC) over time with their volume underneath */
@Component({
  selector: 'app-flush-candles',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES],
  template: `
    @if (bars.length) {
      <div class="wrap">
        <div class="ya" [style.height.px]="height * 0.74"><span>{{ fx.price(maxY) }}</span><span>{{ fx.price((maxY + minY) / 2) }}</span><span>{{ fx.price(minY) }}</span></div>
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + height" preserveAspectRatio="none" [style.height.px]="height">
          <line x1="0" [attr.y1]="priceH" [attr.x2]="w" [attr.y2]="priceH" stroke="#ffffff1a" vector-effect="non-scaling-stroke"/>
          @for (b of bars; track b.t) {
            <line [attr.x1]="b.x" [attr.x2]="b.x" [attr.y1]="b.yh" [attr.y2]="b.yl" [attr.stroke]="b.color" stroke-width="1" vector-effect="non-scaling-stroke"/>
            <rect [attr.x]="b.x - b.bw / 2" [attr.y]="b.yb" [attr.width]="b.bw" [attr.height]="b.hb" [attr.fill]="b.color"/>
            <rect [attr.x]="b.x - b.bw / 2" [attr.y]="height - b.vh" [attr.width]="b.bw" [attr.height]="b.vh" [attr.fill]="b.color" fill-opacity="0.35"/>
            <rect class="hit" [attr.x]="b.x - step / 2" y="0" [attr.width]="step" [attr.height]="height"><title>{{ b.tip }}</title></rect>
          }
        </svg>
      </div>
      <div class="xa"><span>{{ first * 1000 | date:'MMM d, HH:mm' }}</span><span>{{ last * 1000 | date:'MMM d, HH:mm' }}</span></div>
      <div class="legend"><span>{{ unit }}</span><span>volume underneath: <b>{{ fx.compact(volume) }}</b> {{ volumeUnit }} over {{ bars.length }} candles</span></div>
    } @else {
      <p class="empty">{{ emptyText }}</p>
    }`,
})
export class FlushCandlesComponent implements OnChanges {
  @Input() candles: Candle[] = [];
  @Input() height = 260;
  @Input() unit = '';
  @Input() volumeUnit = 'ECX';
  @Input() emptyText = 'No trade in this window yet.';
  fx = F;
  w = W;
  bars: { t: number; x: number; bw: number; yh: number; yl: number; yb: number; hb: number; vh: number; color: string; tip: string }[] = [];
  minY = 0;
  maxY = 1;
  step = 1;
  first = 0;
  last = 0;
  volume = 0;
  priceH = 0;

  ngOnChanges(): void {
    const cs = (this.candles ?? []).filter(c => [c.o, c.h, c.l, c.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
    if (!cs.length) {
      this.bars = [];
      return;
    }
    let lo = Math.min(...cs.map(c => c.l));
    let hi = Math.max(...cs.map(c => c.h));
    if (hi === lo) {
      hi = hi * 1.01 || 1;
      lo = lo * 0.99;
    }
    const pad = (hi - lo) * 0.05;
    this.minY = Math.max(0, lo - pad);
    this.maxY = hi + pad;
    const H = this.height;
    this.priceH = H * 0.74;
    const volH = H * 0.2;
    const maxV = Math.max(...cs.map(c => c.v || 0)) || 1;
    this.step = W / cs.length;
    const bw = Math.max(1, this.step * 0.68);
    const Y = (p: number) => this.priceH - 2 - (this.priceH - 4) * (p - this.minY) / (this.maxY - this.minY);
    this.first = cs[0].t;
    this.last = cs[cs.length - 1].t;
    this.volume = cs.reduce((s, c) => s + (c.v || 0), 0);
    this.bars = cs.map((c, i) => {
      const up = c.c >= c.o;
      const yo = Y(c.o);
      const yc = Y(c.c);
      return {
        t: c.t, x: (i + 0.5) * this.step, bw, yh: Y(c.h), yl: Y(c.l), yb: Math.min(yo, yc), hb: Math.max(0.8, Math.abs(yo - yc)),
        vh: Math.max(0.5, volH * (c.v || 0) / maxV), color: up ? UP : DOWN,
        tip: `${new Date(c.t * 1000).toLocaleString()}\nopen ${F.price(c.o)} · high ${F.price(c.h)} · low ${F.price(c.l)} · close ${F.price(c.c)}`
          + `\nvolume ${F.amount(c.v)} ${this.volumeUnit}` + (c.n !== undefined ? ` · ${c.n} trades` : ''),
      };
    });
  }
}

/**
 * A launch's bonding curve (backbone-flush doc/layers.md "Launches"): a constant product of virtual reserves,
 * x·y = k with x the ECX (from V = G/2 to V + G) and y the tokens (from Tv = 9/8·S to yE = 3/8·S): selling the curve's
 * 3/4·S raises exactly G. With s tokens sold, the price is k/(Tv − s)² ECX per token and the ECX raised k/(Tv − s) − V.
 */
@Component({
  selector: 'app-flush-curve',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES],
  template: `
    @if (path) {
      <div class="wrap">
        <div class="ya" [style.height.px]="height"><span>{{ fx.price(maxY) }}</span><span>{{ fx.price(maxY / 2) }}</span><span>0</span></div>
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + height" preserveAspectRatio="none" [style.height.px]="height" role="img" [attr.aria-label]="'Bonding curve: ' + fx.pct(progress, 1) + ' of the way to graduation'">
          <line x1="0" [attr.y1]="height - 1" [attr.x2]="w" [attr.y2]="height - 1" stroke="#ffffff22" vector-effect="non-scaling-stroke"/>
          <path [attr.d]="soldArea" fill="var(--chain-accent, #7d94ab)" fill-opacity="0.28"/>
          <path [attr.d]="path" fill="none" stroke="var(--chain-accent, #7d94ab)" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
          <line [attr.x1]="xNow" [attr.x2]="xNow" y1="0" [attr.y2]="height" stroke="var(--fg)" stroke-dasharray="4 4" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
          <line [attr.x1]="0" [attr.x2]="w" [attr.y1]="yNow" [attr.y2]="yNow" stroke="var(--fg)" stroke-opacity="0.35" stroke-dasharray="2 4" stroke-width="1" vector-effect="non-scaling-stroke"/>
          @for (h of hits; track h.x) {<rect class="hit" [attr.x]="h.x" y="0" [attr.width]="h.w" [attr.height]="height"><title>{{ h.tip }}</title></rect>}
        </svg>
      </div>
      <div class="xa"><span>0 tokens sold</span><span>{{ fx.compact(sale / 2) }}</span><span>{{ fx.compact(sale) }} sold: graduation</span></div>
      <div class="legend">
        <span><i style="background: var(--chain-accent, #7d94ab)"></i>sold so far: <b>{{ fx.compact(sold) }}</b> tokens for <b>{{ fx.amount(raised, 2) }}</b> of {{ graduation | number }} ECX ({{ fx.pct(progress, 1) }})</span>
        <span>price now <b>{{ fx.price(priceNow) }}</b> ECX</span>
        <span>start <b>{{ fx.price(priceStart) }}</b> → at graduation <b>{{ fx.price(priceEnd) }}</b> ECX (×{{ (priceEnd / priceStart) | number:'1.0-1' }})</span>
        <span>market value of the supply at graduation <b>{{ fx.compact(priceEnd * supply) }}</b> ECX</span>
      </div>
    } @else {
      <p class="empty">The curve's parameters are not known.</p>
    }`,
})
export class FlushCurveComponent implements OnChanges {
  @Input() curve: CurveParams | null = null;
  /** tokens the curve has sold (the whole sale once graduated) */
  @Input() sold = 0;
  @Input() height = 240;
  fx = F;
  w = W;
  path = '';
  soldArea = '';
  hits: { x: number; w: number; tip: string }[] = [];
  maxY = 1;
  xNow = 0;
  yNow = 0;
  sale = 0;
  supply = 0;
  graduation = 500;
  raised = 0;
  progress = 0;
  priceNow = 0;
  priceStart = 0;
  priceEnd = 0;

  ngOnChanges(): void {
    const c = this.curve;
    const V = Number(c?.virtual_ecx);
    const Tv = Number(c?.virtual_tokens);
    const S = Number(c?.sale_supply);
    if (!(V > 0 && Tv > 0 && S > 0 && S < Tv)) {
      this.path = '';
      return;
    }
    const k = V * Tv;
    const price = (s: number) => k / ((Tv - s) * (Tv - s));
    const raised = (s: number) => k / (Tv - s) - V;
    this.sale = S;
    this.supply = Number(c?.supply) || S * 4 / 3;
    this.graduation = Number(c?.graduation_ecx) || raised(S);
    const sold = Math.max(0, Math.min(S, Number(this.sold) || 0));
    this.priceStart = price(0);
    this.priceEnd = price(S);
    this.priceNow = price(sold);
    this.raised = raised(sold);
    this.progress = 100 * this.raised / this.graduation;
    this.maxY = this.priceEnd * 1.06;
    const H = this.height;
    const X = (s: number) => W * s / S;
    const Y = (p: number) => H - 1 - (H - 4) * p / this.maxY;
    const N = 160;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const s = S * i / N;
      pts.push(`${X(s).toFixed(2)},${Y(price(s)).toFixed(2)}`);
    }
    this.path = 'M' + pts.join(' L');
    const until = Math.round(N * sold / S);
    const area: string[] = [];
    for (let i = 0; i <= until; i++) {
      const s = S * i / N;
      area.push(`${X(s).toFixed(2)},${Y(price(s)).toFixed(2)}`);
    }
    area.push(`${X(sold).toFixed(2)},${Y(price(sold)).toFixed(2)}`);
    this.soldArea = `M0,${H} L` + area.join(' L') + ` L${X(sold).toFixed(2)},${H} Z`;
    this.xNow = X(sold);
    this.yNow = Y(this.priceNow);
    const cols = 20;
    this.hits = Array.from({ length: cols }, (_, i) => {
      const s = S * (i + 0.5) / cols;
      return { x: W * i / cols, w: W / cols,
        tip: `${F.compact(s)} tokens sold: ${F.price(price(s))} ECX per token, ${F.amount(raised(s), 2)} ECX raised (${F.pct(100 * raised(s) / this.graduation, 1)})` };
    });
  }
}

/** A concentrated pool's liquidity by price range (its ticks), and where its price is */
@Component({
  selector: 'app-flush-ticks',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES],
  template: `
    @if (bars.length) {
      <div class="wrap">
        <div class="ya" [style.height.px]="height"><span>{{ fx.compact(maxL) }}</span><span>{{ fx.compact(maxL / 2) }}</span><span>0</span></div>
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + height" preserveAspectRatio="none" [style.height.px]="height">
          <line x1="0" [attr.y1]="height - 1" [attr.x2]="w" [attr.y2]="height - 1" stroke="#ffffff22" vector-effect="non-scaling-stroke"/>
          @for (b of bars; track b.x) {
            <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.bw" [attr.height]="b.h" [attr.fill]="b.active ? 'var(--chain-accent, #7d94ab)' : '#7f8ba0'" [attr.fill-opacity]="b.active ? 0.85 : 0.55"><title>{{ b.tip }}</title></rect>
          }
          <line [attr.x1]="xNow" [attr.x2]="xNow" y1="0" [attr.y2]="height" stroke="var(--fg)" stroke-dasharray="4 4" stroke-width="1.2" vector-effect="non-scaling-stroke"><title>{{ nowTip }}</title></line>
        </svg>
      </div>
      <div class="xa"><span>{{ fx.price(pLeft) }}</span><span>{{ fx.price(pRight) }}</span></div>
      <div class="legend"><span><i style="background: var(--chain-accent, #7d94ab)"></i>in range now</span><span>price now <b>{{ fx.price(pNow) }}</b> {{ unit }} (tick {{ tickNow }})</span><span>tick spacing {{ spacing }}</span><span>liquidity in range {{ fx.compact(lNow) }}</span></div>
    } @else {
      <p class="empty">No position provides liquidity in this pool.</p>
    }`,
})
export class FlushTicksComponent implements OnChanges {
  @Input() ticks: PoolTicks | null = null;
  @Input() unit = '';
  @Input() height = 200;
  fx = F;
  w = W;
  bars: { x: number; y: number; bw: number; h: number; active: boolean; tip: string }[] = [];
  maxL = 1;
  xNow = 0;
  pLeft = 0;
  pRight = 0;
  pNow = 0;
  tickNow = 0;
  lNow = 0;
  spacing = 1;
  nowTip = '';

  ngOnChanges(): void {
    const t = this.ticks;
    const items = [...(t?.items ?? [])].sort((a, b) => a.tick - b.tick);
    if (!t || items.length < 2) {
      this.bars = [];
      return;
    }
    const big = (s: string) => {
      try {
        return Number(BigInt(s));
      } catch {
        return Number(s) || 0;
      }
    };
    this.tickNow = t.tick;
    this.spacing = t.tick_spacing;
    this.lNow = big(t.liquidity);
    const ranges: { t0: number; t1: number; p0: number; p1: number; L: number }[] = [];
    let L = 0;
    for (let i = 0; i < items.length - 1; i++) {
      L += big(items[i].liquidity_net);
      ranges.push({ t0: items[i].tick, t1: items[i + 1].tick, p0: items[i].price, p1: items[i + 1].price, L });
    }
    const span = items[items.length - 1].tick - items[0].tick;
    const pad = Math.max(t.tick_spacing, span * 0.08);
    const lo = Math.min(items[0].tick, t.tick) - pad;
    const hi = Math.max(items[items.length - 1].tick, t.tick) + pad;
    const X = (tk: number) => W * (tk - lo) / (hi - lo);
    this.maxL = Math.max(1, ...ranges.map(r => r.L));
    const H = this.height;
    // a tick's price is 1.0001^tick in units; the API's prices are in whole units: scale by the first tick's
    const unitScale = items[0].price / Math.pow(1.0001, items[0].tick);
    const at = (tk: number) => unitScale * Math.pow(1.0001, tk);
    this.pLeft = at(lo);
    this.pRight = at(hi);
    this.pNow = at(t.tick);
    this.xNow = X(t.tick);
    this.nowTip = `price now ${F.price(this.pNow)} ${this.unit} (tick ${t.tick})`;
    this.bars = ranges.filter(r => r.L > 0).map(r => ({
      x: X(r.t0), bw: Math.max(1, X(r.t1) - X(r.t0) - 1), y: H - 1 - (H - 4) * r.L / this.maxL, h: (H - 4) * r.L / this.maxL,
      active: t.tick >= r.t0 && t.tick < r.t1,
      tip: `${F.price(r.p0)} to ${F.price(r.p1)} ${this.unit} (ticks ${r.t0} to ${r.t1}): liquidity ${F.compact(r.L)}`,
    }));
  }
}

/** A book's depth: the bids' and asks' cumulative amounts by price */
@Component({
  selector: 'app-flush-depth',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES],
  template: `
    @if (bidPath || askPath) {
      <div class="wrap">
        <div class="ya" [style.height.px]="height"><span>{{ fx.compact(maxY) }}</span><span>{{ fx.compact(maxY / 2) }}</span><span>0</span></div>
        <svg [attr.viewBox]="'0 0 ' + w + ' ' + height" preserveAspectRatio="none" [style.height.px]="height">
          <line x1="0" [attr.y1]="height - 1" [attr.x2]="w" [attr.y2]="height - 1" stroke="#ffffff22" vector-effect="non-scaling-stroke"/>
          @if (bidPath) {<path [attr.d]="bidPath" [attr.fill]="up" fill-opacity="0.25" [attr.stroke]="up" stroke-width="2" vector-effect="non-scaling-stroke"/>}
          @if (askPath) {<path [attr.d]="askPath" [attr.fill]="down" fill-opacity="0.25" [attr.stroke]="down" stroke-width="2" vector-effect="non-scaling-stroke"/>}
          @for (h of hits; track $index) {<rect class="hit" [attr.x]="h.x - 4" y="0" width="8" [attr.height]="height"><title>{{ h.tip }}</title></rect>}
        </svg>
      </div>
      <div class="xa"><span>{{ fx.price(minX) }}</span><span>{{ fx.price(maxX) }}</span></div>
      <div class="legend"><span><i [style.background]="up"></i>bids (buy {{ book?.base }})</span><span><i [style.background]="down"></i>asks (sell {{ book?.base }})</span><span>price in {{ book?.quote }} per {{ book?.base }}; amounts in {{ book?.base }}</span></div>
    } @else {
      <p class="empty">The book has no open order.</p>
    }`,
})
export class FlushDepthComponent implements OnChanges {
  @Input() book: Book | null = null;
  @Input() height = 200;
  fx = F;
  w = W;
  up = UP;
  down = DOWN;
  bidPath = '';
  askPath = '';
  hits: { x: number; tip: string }[] = [];
  minX = 0;
  maxX = 1;
  maxY = 1;

  ngOnChanges(): void {
    const b = this.book;
    const bids = [...(b?.bids ?? [])].sort((x, y) => y.price - x.price);
    const asks = [...(b?.asks ?? [])].sort((x, y) => x.price - y.price);
    if (!bids.length && !asks.length) {
      this.bidPath = this.askPath = '';
      return;
    }
    const cum = (ls: { price: number; amount: number }[]) => {
      let t = 0;
      return ls.map(l => ({ price: l.price, total: (t += l.amount) }));
    };
    const cb = cum(bids);
    const ca = cum(asks);
    const prices = [...bids, ...asks].map(l => l.price);
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
    lo = Math.max(0, lo - pad);
    hi = hi + pad;
    this.minX = lo;
    this.maxX = hi;
    this.maxY = Math.max(1e-12, ...cb.map(x => x.total), ...ca.map(x => x.total)) * 1.08;
    const H = this.height;
    const X = (p: number) => W * (p - lo) / (hi - lo);
    const Y = (v: number) => H - 1 - (H - 4) * v / this.maxY;
    if (cb.length) {
      let d = `M${X(cb[0].price)},${H} V${Y(cb[0].total)}`;
      for (let i = 1; i < cb.length; i++) {
        d += ` H${X(cb[i].price)} V${Y(cb[i].total)}`;
      }
      d += ` H0 V${H} Z`;
      this.bidPath = d;
    } else {
      this.bidPath = '';
    }
    if (ca.length) {
      let d = `M${X(ca[0].price)},${H} V${Y(ca[0].total)}`;
      for (let i = 1; i < ca.length; i++) {
        d += ` H${X(ca[i].price)} V${Y(ca[i].total)}`;
      }
      d += ` H${W} V${H} Z`;
      this.askPath = d;
    } else {
      this.askPath = '';
    }
    this.hits = [
      ...cb.map(l => ({ x: X(l.price), tip: `bids at ${F.price(l.price)} or more: ${F.amount(l.total)} ${b?.base}` })),
      ...ca.map(l => ({ x: X(l.price), tip: `asks at ${F.price(l.price)} or less: ${F.amount(l.total)} ${b?.base}` })),
    ];
  }
}

export const FLUSH_CHARTS = [FlushCandlesComponent, FlushCurveComponent, FlushTicksComponent, FlushDepthComponent];
