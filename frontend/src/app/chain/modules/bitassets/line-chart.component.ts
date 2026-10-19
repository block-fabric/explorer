import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

/** A small SVG line chart: points [x, y], an optional second set of dots (bids), axis labels at the ends */
@Component({
  selector: 'app-mini-line-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`svg { width: 100%; height: 220px; display: block; overflow: visible; } text { fill: var(--transparent-fg); font-size: 11px; }`],
  template: `
    <svg viewBox="0 0 600 220" preserveAspectRatio="none" *ngIf="path; else empty">
      <line x1="70" y1="190" x2="595" y2="190" stroke="#ffffff22"/>
      <line x1="70" y1="10" x2="595" y2="10" stroke="#ffffff10"/>
      <path [attr.d]="area" fill="var(--chain-accent, #8f7cff)" fill-opacity="0.12"/>
      <path [attr.d]="path" fill="none" stroke="var(--chain-accent, #8f7cff)" stroke-width="2" vector-effect="non-scaling-stroke" [attr.stroke-dasharray]="step ? null : null"/>
      <circle *ngFor="let d of dotsXY" [attr.cx]="d[0]" [attr.cy]="d[1]" r="4" fill="#b5f27e"><title>{{ d[2] }}</title></circle>
      <text x="66" y="14" text-anchor="end">{{ fmt(maxY) }}</text>
      <text x="66" y="194" text-anchor="end">{{ fmt(minY) }}</text>
      <text x="70" y="210">{{ xLabel(minX) }}</text>
      <text x="595" y="210" text-anchor="end">{{ xLabel(maxX) }}</text>
    </svg>
    <ng-template #empty><p style="color: var(--transparent-fg); margin: 0">Not enough data yet.</p></ng-template>
  `,
})
export class MiniLineChartComponent implements OnChanges {
  @Input() points: [number, number][] = [];
  @Input() dots: [number, number, string][] = [];
  @Input() step = false;
  @Input() xPrefix = '';

  path = ''; area = ''; dotsXY: [number, number, string][] = [];
  minX = 0; maxX = 1; minY = 0; maxY = 1;

  ngOnChanges(): void {
    const pts = (this.points ?? []).filter(p => p[1] !== null && isFinite(p[1]));
    if (pts.length < 2) { this.path = ''; return; }
    const all = [...pts, ...(this.dots ?? []).map(d => [d[0], d[1]] as [number, number])];
    this.minX = Math.min(...all.map(p => p[0])); this.maxX = Math.max(...all.map(p => p[0]));
    this.minY = Math.min(...all.map(p => p[1])); this.maxY = Math.max(...all.map(p => p[1]));
    if (this.maxY === this.minY) { this.maxY = this.minY * 1.05 + 1e-12; this.minY = this.minY * 0.95; }
    if (this.maxX === this.minX) { this.maxX = this.minX + 1; }
    const X = (x: number) => 70 + 525 * (x - this.minX) / (this.maxX - this.minX);
    const Y = (y: number) => 190 - 180 * (y - this.minY) / (this.maxY - this.minY);
    let d = `M${X(pts[0][0])},${Y(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      d += this.step ? ` H${X(pts[i][0])} V${Y(pts[i][1])}` : ` L${X(pts[i][0])},${Y(pts[i][1])}`;
    }
    this.path = d;
    this.area = `${d} V190 H${X(pts[0][0])} Z`;
    this.dotsXY = (this.dots ?? []).map(p => [X(p[0]), Y(p[1]), p[2]]);
  }

  fmt(v: number): string {
    return Math.abs(v) >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : Number(v.toPrecision(4)).toString();
  }

  xLabel(x: number): string {
    return this.xPrefix + Math.round(x).toLocaleString();
  }
}
