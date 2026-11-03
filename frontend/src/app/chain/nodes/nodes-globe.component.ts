import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, ViewChild, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { hostName } from './nodes.component';

/** a node of the table (nodes.component.ts build()), with its location (the backend's DB-IP lookup) */
export interface GlobeNode {
  address: string; short: string; rdns: string | null; up: boolean;
  agent: { node: string }; chain: string; height: number | null; behind: number | null; latency: number | null;
  uptime: number; lastSeen: number;
  geo: { lat: number; lon: number; city: string | null; country: string | null } | null;
  /** who holds its address's network */
  asn?: { number: number; org: string } | null;
  /** what its colour stands for, if not its client (the console: its chain) */
  group?: string;
}

interface Place { key: string; lat: number; lng: number; name: string; nodes: GlobeNode[]; color: string }
interface Arc { a: Place; b: Place }

// Natural Earth's 1:50m countries (world-atlas): Europe's coasts and islands as they are (1:110m mangles them)
const LAND = '/resources/world/countries-50m.json';
const MAX_ARCS = 400;

/** text for an HTML label: a node's user agent and host name are anyone's to write */
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string));
}

function ago(t: number): string {
  const s = Math.max(0, Date.now() / 1000 - t);
  return s < 90 ? 'now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

/**
 * The reachable nodes on a globe (/nodes, above the table): one point per place (nodes in the same city share it), in
 * the colour of the version most of them run, and an arc between two places where a node at one named a node at the
 * other in its getaddr answer (the backend's links: who knows of whom, not who is connected). Hover a point for its
 * nodes, as the table shows them. globe.gl (three.js), loaded with the page.
 */
@Component({
  selector: 'app-nodes-globe',
  standalone: true,
  template: `<div #host class="globe-host" [class.locked]="locked" [style.height.px]="narrow ? Math.min(height, 330) : height"></div>
    @if (touch && !failed) {<button type="button" class="globe-lock" (click)="setLocked(!locked)">{{ locked ? 'Tap to explore' : 'Done' }}</button>}
    @if (failed) {<div class="globe-failed">The map needs WebGL, which this browser does not offer.</div>}`,
  styles: [`
    :host { display: block; position: relative; }
    .globe-host { width: 100%; height: 460px; cursor: grab; }
    .globe-host:active { cursor: grabbing; }
    .globe-failed { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--cx-ink-3); font-size: 0.85rem; }
    .globe-host.locked { cursor: default; }
    .globe-host.locked ::ng-deep canvas { pointer-events: none; touch-action: pan-y !important; }
    .globe-lock { position: absolute; right: 10px; bottom: 10px; z-index: 2; border: 1px solid #ffffff33; background: rgba(13,17,28,0.85); color: #fff;
      font-size: 0.75rem; padding: 5px 12px; border-radius: 99px; backdrop-filter: blur(4px); }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodesGlobeComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() nodes: GlobeNode[] = [];
  @Input() links: [string, string][] = [];
  /** a client's colour (the Versions card's), by its name and version */
  @Input() colors: Record<string, string> = {};
  @Input() accent = '#5aa6ff';
  /** the globe's height in px (the nodes page: 460) */
  @Input() height = 460;
  @ViewChild('host', { static: true }) host: ElementRef<HTMLDivElement>;

  failed = false;
  Math = Math;
  /** a phone's screen: a shorter globe */
  narrow = false;
  /** a touch screen: the globe starts locked (turning by itself, the page scrolling over it) until "Tap to explore" */
  touch = false;
  locked = false;
  private globe: any = null;
  private resize: ResizeObserver | null = null;
  private shown = '';
  private destroyed = false;

  constructor(private zone: NgZone, private cd: ChangeDetectorRef, @Inject(PLATFORM_ID) private platformId: object) {
    if (isPlatformBrowser(platformId)) {
      this.narrow = window.matchMedia('(max-width: 767px)').matches;
      this.touch = window.matchMedia('(pointer: coarse)').matches;
      this.locked = this.touch;
    }
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    // outside Angular: the globe renders every frame, which must not run change detection
    this.zone.runOutsideAngular(() => { void this.create(); });
  }

  ngOnChanges(): void {
    this.update();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.resize?.disconnect();
    try {
      this.globe?._destructor();
    } catch { /* already gone */ }
    this.globe = null;
  }

  private async create(): Promise<void> {
    try {
      const [{ default: Globe }, three, topo, land] = await Promise.all([
        import('globe.gl'), import('three'), import('topojson-client'), fetch(LAND).then(r => r.json()).catch(() => null),
      ]);
      if (this.destroyed) {
        return;
      }
      const el = this.host.nativeElement;
      const countries = land ? (topo.feature(land, land.objects.countries) as any).features : [];
      const globe = new Globe(el, { animateIn: true })
        .width(el.clientWidth).height(el.clientHeight)
        .backgroundColor('rgba(0,0,0,0)')
        .globeMaterial(new three.MeshPhongMaterial({ color: '#070b17', emissive: '#03050b', shininess: 4 }))
        .showGraticules(true)
        .showAtmosphere(true).atmosphereColor(this.accent).atmosphereAltitude(0.16)
        .polygonsData(countries).polygonAltitude(0.004).polygonCapColor(() => '#2a3550').polygonSideColor(() => 'rgba(0,0,0,0)')
        .polygonStrokeColor(() => 'rgba(255,255,255,0.28)')
        .pointLat('lat').pointLng('lng').pointColor('color')
        .pointAltitude((p: Place) => 0.015 + 0.02 * Math.log2(p.nodes.length + 1))
        .pointRadius((p: Place) => 0.32 + 0.12 * Math.sqrt(p.nodes.length))
        .pointLabel((p: Place) => this.card(p))
        .onPointHover((p: Place | null) => { globe.controls().autoRotate = !p; el.style.cursor = p ? 'pointer' : ''; })
        .ringLat('lat').ringLng('lng').ringColor((p: Place) => (t: number) => this.alpha(p.color, 1 - t))
        .ringMaxRadius(2.2).ringPropagationSpeed(0.9).ringRepeatPeriod(2400)
        // (functions: an accessor's string names a property of the datum itself, not a path)
        .arcStartLat((l: Arc) => l.a.lat).arcStartLng((l: Arc) => l.a.lng).arcEndLat((l: Arc) => l.b.lat).arcEndLng((l: Arc) => l.b.lng)
        .arcColor((l: Arc) => [this.alpha(l.a.color, 0.55), this.alpha(l.b.color, 0.55)])
        .arcStroke(0.25).arcAltitudeAutoScale(0.35)
        .arcDashLength(0.35).arcDashGap(0.25).arcDashInitialGap(() => Math.random()).arcDashAnimateTime(5000);
      const controls = globe.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.45;
      // zoom with the wheel or a pinch, from close to a region to the whole globe small
      controls.enableZoom = true;
      controls.zoomSpeed = 0.6;
      controls.minDistance = 130;
      controls.maxDistance = 520;
      controls.enabled = !this.locked;
      this.globe = globe;
      this.resize = new ResizeObserver(() => globe.width(el.clientWidth).height(el.clientHeight));
      this.resize.observe(el);
      this.shown = '';
      this.update();
    } catch {
      this.zone.run(() => { this.failed = true; this.cd.markForCheck(); });
    }
  }

  /** lock the globe (a touch screen: the page scrolls over it) or let it be turned, zoomed and its points tapped */
  setLocked(locked: boolean): void {
    this.locked = locked;
    if (this.globe) {
      this.globe.controls().enabled = !locked;
      this.globe.controls().autoRotate = locked;
    }
  }

  /** the nodes by place, the links between places; set again only when they changed (each poll gives new objects) */
  private update(): void {
    if (!this.globe) {
      return;
    }
    const byPlace = new Map<string, Place>();
    for (const n of this.nodes) {
      if (!n.up || !n.geo) {
        continue;
      }
      const key = `${n.geo.lat.toFixed(1)},${n.geo.lon.toFixed(1)}`;
      let p = byPlace.get(key);
      if (!p) {
        p = { key, lat: n.geo.lat, lng: n.geo.lon, name: [n.geo.city, n.geo.country].filter(Boolean).join(', ') || 'Unknown place', nodes: [], color: '' };
        byPlace.set(key, p);
      }
      p.nodes.push(n);
    }
    const placeOf = new Map<string, Place>();
    for (const p of byPlace.values()) {
      const count = new Map<string, number>();
      p.nodes.forEach(n => count.set(n.group ?? n.agent.node, (count.get(n.group ?? n.agent.node) ?? 0) + 1));
      const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      p.color = this.colors[top] ?? this.accent;
      p.nodes.forEach(n => placeOf.set(n.address, p));
    }
    const arcs = new Map<string, Arc>();
    for (const [x, y] of this.links) {
      const a = placeOf.get(x);
      const b = placeOf.get(y);
      if (a && b && a !== b && arcs.size < MAX_ARCS) {
        arcs.set(a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`, { a, b });
      }
    }
    const places = [...byPlace.values()];
    const sig = JSON.stringify([places.map(p => [p.key, p.color, p.nodes.map(n => [n.address, n.height, n.latency])]), [...arcs.keys()]]);
    if (sig === this.shown) {
      return;
    }
    const first = !this.shown;
    this.shown = sig;
    this.globe.pointsData(places).ringsData(places).arcsData([...arcs.values()]);
    if (first && places.length) {
      // face where most nodes are
      const lat = places.reduce((s, p) => s + p.lat * p.nodes.length, 0) / places.reduce((s, p) => s + p.nodes.length, 0);
      const lng = places.reduce((s, p) => s + p.lng * p.nodes.length, 0) / places.reduce((s, p) => s + p.nodes.length, 0);
      this.globe.pointOfView({ lat: Math.max(-50, Math.min(55, lat)), lng, altitude: 1.65 }, 0);
    }
  }

  /** a place's nodes, as the table shows them */
  private card(p: Place): string {
    const rows = p.nodes.slice(0, 6).map(n => `
      <div style="padding:6px 0;border-top:1px solid #ffffff1a">
        <div style="font-family:var(--cx-mono, monospace);font-size:12px;color:#fff">${esc(n.short)}</div>
        ${n.rdns ? `<div style="font-size:10.5px;color:#ffffff80;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.rdns)}</div>` : ''}
        ${n.asn ? `<div style="font-size:10.5px;color:#ffffff99">${esc(hostName(n.asn))} <span style="color:#ffffff60">AS${esc(n.asn.number)}</span></div>` : ''}
        <div style="font-size:11.5px;color:#ffffffcc;margin-top:2px">
          <span style="color:${esc(this.colors[n.group ?? n.agent.node] ?? this.accent)}">●</span> ${n.group ? esc(n.group) + ' · ' : ''}${esc(n.agent.node)}${n.chain && n.chain !== 'No blocks' ? ' · ' + esc(n.chain) : ''}
        </div>
        <div style="font-size:11px;color:#ffffff99;margin-top:1px">
          height ${n.height !== null ? n.height.toLocaleString() : '–'}${n.behind ? ` <span style="color:#ff9b6b">−${n.behind}</span>` : ''}
          · ${n.latency !== null ? n.latency + ' ms' : '–'} · up ${Math.round(n.uptime * 100)}% · ${ago(n.lastSeen)}
        </div>
      </div>`).join('');
    const more = p.nodes.length > 6 ? `<div style="font-size:11px;color:#ffffff80;padding-top:4px">+${p.nodes.length - 6} more here</div>` : '';
    return `<div style="background:rgba(17,19,31,0.96);border:1px solid #ffffff26;border-radius:8px;padding:8px 12px;min-width:220px;max-width:300px;box-shadow:0 6px 24px #0008">
      <div style="font-size:12px;font-weight:600;color:#fff;padding-bottom:6px">${esc(p.name)} <span style="font-weight:400;color:#ffffff80">· ${p.nodes.length} node${p.nodes.length === 1 ? '' : 's'}</span></div>${rows}${more}</div>`;
  }

  /** #rrggbb with an alpha */
  private alpha(hex: string, a: number): string {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) {
      return hex;
    }
    const v = parseInt(m[1], 16);
    return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  }
}
