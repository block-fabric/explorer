import { ChangeDetectionStrategy, Component, Injectable, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, map, of, shareReplay, switchMap, take } from 'rxjs';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2Content, L2Input, L2Output } from '@app/chain/l2/l2.interfaces';

/*
 * Assets and names as the explorers show them (BitAssets, BitNames): a badge with the plain name when the backend
 * knows it (revealed on chain or a candidate that hashes to it), else the short hash; and the per-asset summaries of a
 * transaction and of an address. Plain Angular interpolation only. (No import of l2-common: it imports this file.)
 */

export interface Labels {
  /** asset hash -> plain name (BitAssets) */
  assets: Map<string, string>;
  /** name hash -> plain name (BitNames) */
  names: Map<string, string>;
}

/** The plain names of the chain's assets and names (GET feature/assets, feature/names), fetched once */
@Injectable({ providedIn: 'root' })
export class L2LabelService {
  readonly labels$: Observable<Labels>;

  constructor(api: L2ApiService) {
    const list = (path: string) => api.feature$<any>(path).pipe(
      map(r => new Map<string, string>((r?.items ?? []).filter((x: any) => x?.id && x?.name).map((x: any) => [String(x.id), String(x.name)]))),
      catchError(() => of(new Map<string, string>())),
    );
    this.labels$ = api.features$.pipe(
      take(1),
      switchMap(f => (f.includes('assets') ? list('assets') : of(new Map<string, string>())).pipe(
        switchMap(assets => (f.includes('names') ? list('names') : of(new Map<string, string>())).pipe(map(names => ({ assets, names })))),
      )),
      shareReplay(1),
    );
  }
}

/** What an id names: sats ("00"), a BitAsset ("01"‖hash or the hash), its control coin ("02"‖hash), an LP pair */
export interface AssetRef {
  kind: 'sats' | 'asset' | 'control' | 'lp' | 'name' | 'unknown';
  hash: string | null;
  pair: [string, string] | null;
}

export function assetRef(id: string | null | undefined, kind: 'asset' | 'name' = 'asset'): AssetRef {
  const s = String(id ?? '').toLowerCase();
  if (s === '' || s === '00') {
    return { kind: 'sats', hash: null, pair: null };
  }
  const pair = s.split(/[:-]/);
  if (pair.length === 2 && pair.every(p => /^(00|0[12][0-9a-f]{64})$/.test(p))) {
    return { kind: 'lp', hash: null, pair: [pair[0], pair[1]] };
  }
  if (/^01[0-9a-f]{64}$/.test(s)) {
    return { kind: 'asset', hash: s.slice(2), pair: null };
  }
  if (/^02[0-9a-f]{64}$/.test(s)) {
    return { kind: 'control', hash: s.slice(2), pair: null };
  }
  if (/^[0-9a-f]{64}$/.test(s)) {
    return { kind, hash: s, pair: null };
  }
  return { kind: 'unknown', hash: s, pair: null };
}

function hue(s: string): number {
  let h = 0;
  for (const c of s.slice(0, 8)) {
    h = (h * 31 + c.charCodeAt(0)) % 360;
  }
  return h;
}

/** An asset (or a name) with its plain name or short hash, a letter in a colour of its own, linking to its page */
@Component({
  selector: 'app-l2-asset',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; max-width: 100%; }
    .ab { display: inline-flex; align-items: center; gap: 5px; min-width: 0; color: inherit; text-decoration: none; }
    a.ab .t { color: var(--chain-accent, var(--title-fg)); }
    a.ab:hover .t { text-decoration: underline; }
    .dot { flex: 0 0 auto; width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #11131f; font-weight: 800; font-size: 9px; }
    .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t.h { font-family: monospace; font-weight: normal; font-size: 0.8rem; }
    .k { color: var(--transparent-fg); font-size: 0.75rem; white-space: nowrap; }
  `],
  template: `
    @if (labels$ | async; as l) {
      @switch (ref.kind) {
        @case ('sats') {<span class="ab" title="sats"><span class="dot" style="background: #f5b83d">₿</span><span class="t">sats</span></span>}
        @case ('lp') {
          <a class="ab" [routerLink]="['/pools', ref.pair![0] + '-' + ref.pair![1]]" [title]="'AMM LP token ' + ref.pair![0] + ' / ' + ref.pair![1]">
            <span class="k">LP</span><span class="t">{{ label(l, ref.pair![0]) }}/{{ label(l, ref.pair![1]) }}</span>
          </a>
        }
        @default {
          <a class="ab" [routerLink]="[ref.kind === 'name' ? '/names' : '/assets', ref.hash]" [title]="title(l)">
            <span class="dot" [style.background]="color">{{ initial(l) }}</span>
            <span class="t" [class.h]="!known(l)">{{ text(l) }}</span>
            @if (ref.kind === 'control') {<span class="k">control</span>}
          </a>
        }
      }
    }`,
})
export class L2AssetComponent implements OnChanges {
  /** a hash, an AssetId (00, 01‖hash, 02‖hash) or an LP pair (a0:a1, a0-a1) */
  @Input() id: string | null | undefined;
  /** a bare hash names an asset (BitAssets) or a name (BitNames) */
  @Input() kind: 'asset' | 'name' = 'asset';
  ref: AssetRef = { kind: 'sats', hash: null, pair: null };
  raw = '';
  color = '#9aa4b2';
  labels$: Observable<Labels>;

  constructor(labels: L2LabelService) {
    this.labels$ = labels.labels$;
  }

  ngOnChanges(): void {
    this.ref = assetRef(this.id, this.kind);
    this.raw = String(this.id ?? '');
    this.color = `hsl(${hue(this.ref.hash ?? this.raw)}, 60%, 68%)`;
  }

  private nameOf(l: Labels): string | null {
    const h = this.ref.hash;
    if (!h) {
      return null;
    }
    return (this.ref.kind === 'name' ? l.names.get(h) : l.assets.get(h)) ?? null;
  }

  known(l: Labels): boolean {
    return !!this.nameOf(l);
  }

  text(l: Labels): string {
    const h = this.ref.hash ?? this.raw;
    return this.nameOf(l) ?? (h.length > 14 ? h.slice(0, 6) + '…' + h.slice(-4) : h);
  }

  initial(l: Labels): string {
    return (this.nameOf(l) ?? this.ref.hash ?? '?').charAt(0).toUpperCase();
  }

  title(l: Labels): string {
    const n = this.nameOf(l);
    return (n ? n + '\n' : '') + (this.ref.kind === 'control' ? 'control coin of ' : '') + (this.ref.hash ?? this.raw);
  }

  /** an AssetId's name in an LP pair */
  label(l: Labels, assetId: string): string {
    const r = assetRef(assetId);
    if (r.kind === 'sats') {
      return 'sats';
    }
    return (r.hash && l.assets.get(r.hash)) ?? (r.hash ?? assetId).slice(0, 6) + '…';
  }
}

/** The asset an output holds, as a key for summaries ('' for sats), and its amount */
export function assetOf(c: L2Content | null, value: number | null): { key: string; kind: 'asset' | 'name'; amount: number; what: string } | null {
  if (!c) {
    return null;
  }
  switch (c.type) {
    case 'bitasset':
      return c.assetId ? { key: '01' + c.assetId, kind: 'asset', amount: Number(c.amount ?? 0), what: 'units' } : null;
    case 'bitassetControl':
      return c.assetId ? { key: '02' + c.assetId, kind: 'asset', amount: 1, what: 'control coin' } : null;
    case 'ammLpToken':
      return c.assetId ? { key: c.assetId, kind: 'asset', amount: Number(c.amount ?? 0), what: 'LP tokens' } : null;
    case 'bitname':
      return c.name ? { key: c.name, kind: 'name', amount: 1, what: 'name' } : null;
    default:
      return null;
  }
}

interface AssetRow {
  key: string;
  kind: 'asset' | 'name';
  what: string;
  in: number;
  out: number;
  utxos: number;
}

function summarize(entries: { c: L2Content | null; v: number | null; side: 'in' | 'out' }[]): AssetRow[] {
  const rows = new Map<string, AssetRow>();
  for (const e of entries) {
    const a = assetOf(e.c, e.v);
    if (!a) {
      continue;
    }
    const r = rows.get(a.key) ?? { key: a.key, kind: a.kind, what: a.what, in: 0, out: 0, utxos: 0 };
    r[e.side] += a.amount;
    r.utxos++;
    rows.set(a.key, r);
  }
  return [...rows.values()];
}

/** What a transaction does with assets and names: per asset, the amount its inputs spent and its outputs hold */
@Component({
  selector: 'app-l2-tx-assets',
  standalone: true,
  imports: [CommonModule, L2AssetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    table { width: 100%; font-size: 0.85rem; margin: 0; }
    th { color: var(--transparent-fg); font-weight: normal; font-size: 0.75rem; padding: 4px 10px 4px 0; }
    td { padding: 4px 10px 4px 0; }
    .r { text-align: right; } .pos { color: #3bd16f; } .neg { color: #ff6b6b; } .muted { color: var(--transparent-fg); font-size: 0.8rem; }
  `],
  template: `
    @if (rows.length) {
      <table>
        <thead><tr><th>Asset</th><th class="r">Spent</th><th class="r">Created</th><th class="r">Change</th></tr></thead>
        <tbody>
          @for (r of rows; track r.key) {
            <tr>
              <td><app-l2-asset [id]="r.key" [kind]="r.kind"></app-l2-asset> <span class="muted">{{ r.what }}</span></td>
              <td class="r">{{ r.in | number }}</td>
              <td class="r">{{ r.out | number }}</td>
              <td class="r" [class.pos]="r.out > r.in" [class.neg]="r.out < r.in">{{ r.out > r.in ? '+' : r.out < r.in ? '−' : '' }}{{ abs(r.out - r.in) | number }}</td>
            </tr>
          }
        </tbody>
      </table>
    }`,
})
export class L2TxAssetsComponent {
  rows: AssetRow[] = [];
  @Input() set tx(t: { inputs: L2Input[]; outputs: L2Output[] } | null) {
    this.rows = t ? summarize([
      ...t.inputs.map(i => ({ c: i.content, v: i.value, side: 'in' as const })),
      ...t.outputs.map(o => ({ c: o.content, v: o.value, side: 'out' as const })),
    ]) : [];
  }

  abs(n: number): number {
    return Math.abs(n);
  }
}

/** An address's assets and names: per asset, what its unspent outputs hold */
@Component({
  selector: 'app-l2-address-assets',
  standalone: true,
  imports: [CommonModule, L2AssetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    table { width: 100%; font-size: 0.85rem; margin: 0; }
    th { color: var(--transparent-fg); font-weight: normal; font-size: 0.75rem; padding: 4px 10px 4px 0; }
    td { padding: 4px 10px 4px 0; } .r { text-align: right; } .muted { color: var(--transparent-fg); font-size: 0.8rem; }
  `],
  template: `
    @if (rows.length) {
      <table>
        <thead><tr><th>Asset</th><th class="r">Balance</th><th class="r">Unspent outputs</th></tr></thead>
        <tbody>
          @for (r of rows; track r.key) {
            <tr>
              <td><app-l2-asset [id]="r.key" [kind]="r.kind"></app-l2-asset> <span class="muted">{{ r.what }}</span></td>
              <td class="r">{{ r.out | number }}</td>
              <td class="r">{{ r.utxos | number }}</td>
            </tr>
          }
        </tbody>
      </table>
    }`,
})
export class L2AddressAssetsComponent {
  rows: AssetRow[] = [];
  @Input() set utxos(u: { content: L2Content; value: number }[] | null) {
    this.rows = summarize((u ?? []).map(x => ({ c: x.content, v: x.value, side: 'out' as const })));
  }
}

/** Whether a transaction or a set of outputs holds any asset or name (to show the summaries' headings) */
export function hasAssets(contents: (L2Content | null)[]): boolean {
  return contents.some(c => !!assetOf(c, null));
}
