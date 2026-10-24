import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, map } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { StateService } from '@app/services/state.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { L2Content, L2OutPoint, L2Spent, L2TxSummary, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2AssetComponent } from '@app/chain/l2/features/asset-badge';
import { ChainTableComponent, CxCellDirective } from '@app/chain/components/chain-table/chain-table.component';

/*
 * The building blocks of the sidechain explorers' pages. Everything from the chain is shown through Angular
 * interpolation and property bindings (never [innerHTML]).
 */

/** "abc…xyz": a long id for a narrow cell */
export function shortId(s: string | null | undefined, keep = 8): string {
  const t = String(s ?? '');
  return t.length > keep * 2 + 1 ? t.slice(0, keep) + '…' + t.slice(-keep) : t;
}

/** An amount of sats: in sats, or in ECX (1e8 sats) when the footer's selector says so */
@Component({
  selector: 'app-l2-amount',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.u { opacity: 0.6; font-size: 0.85em; } .pos { color: #3bd16f; } .neg { color: #ff6b6b; } :host { white-space: nowrap; } :host(.wrap) { white-space: normal; overflow-wrap: anywhere; }`],
  template: `@if (sats === null || sats === undefined) {<span class="u">–</span>} @else {<span [class.pos]="signed && sats > 0" [class.neg]="signed && sats < 0" [attr.title]="compact && abs >= compactFrom ? (abs | number) + ' sats' : null">{{ signed && sats > 0 ? '+' : (sats < 0 ? '−' : '') }}@if ((mode$ | async) === 'btc') {<span>{{ abs / 100000000 | number:(compact ? '1.0-2' : '1.0-8') }}</span><span class="u ms-1">ECX</span>} @else if (compact && abs >= compactFrom) {<span>{{ abs / 100000000 | number:'1.0-2' }}</span><span class="u ms-1">ECX</span>} @else {<span>{{ abs | number }}</span><span class="u ms-1">sats</span>}</span>}`,
})
export class L2AmountComponent {
  @Input() sats: number | null | undefined;
  /** show + for a positive amount, in colour */
  @Input() signed = false;
  /** a narrow cell (KPI tiles): from 1 ECX up, in ECX with two decimals (the exact sats in the tooltip) */
  @Input() compact = false;
  compactFrom = 100000000;
  mode$: Observable<string>;

  constructor(stateService: StateService) {
    this.mode$ = stateService.viewAmountMode$;
  }

  get abs(): number {
    return Math.abs(Number(this.sats) || 0);
  }
}

/** A request's loading, not found, failed and "index still being built" states */
@Component({
  selector: 'app-l2-state',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state?.loading) {
      <div class="skeleton-loader" [style.height.px]="height"></div>
    } @else if (state?.error; as e) {
      @if (e.building) {
        <div class="alert alert-info">The index is still being built: this page will be available once the explorer has caught up with the sidechain. Try again in a few minutes.</div>
      } @else if (e.status === 404) {
        <div class="alert alert-warning">{{ what }} not found{{ id ? ': ' : '' }}<span class="text-break">{{ id }}</span></div>
      } @else if (e.status === 400) {
        <div class="alert alert-warning">Not a valid {{ what.toLowerCase() }} id{{ id ? ': ' : '' }}<span class="text-break">{{ id }}</span></div>
      } @else {
        <div class="alert alert-warning">{{ what }} is not available: {{ e.message }}</div>
      }
    }`,
})
export class L2StateComponent {
  @Input() state: Loaded<any> | null;
  @Input() what = 'Data';
  @Input() id: string | null = null;
  @Input() height = 200;
}

/** A link to the eCash explorer (block, tx, address), plain text when there is none */
@Component({
  selector: 'app-l2-main-link',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (base$ | async; as base) {<a [href]="base + '/' + kind + '/' + id" [title]="'On the eCash explorer: ' + id" class="mono">{{ text ?? (short ? shortId(id) : id) }}</a>} @else {<span class="mono" [title]="id">{{ text ?? (short ? shortId(id) : id) }}</span>}`,
  styles: [`.mono { font-family: monospace; word-break: break-all; }`],
})
export class L2MainLinkComponent {
  @Input() kind: 'block' | 'tx' | 'address' = 'tx';
  @Input() id: string;
  @Input() text: string | null = null;
  @Input() short = false;
  base$: Observable<string | null>;
  shortId = shortId;

  constructor(api: L2ApiService) {
    this.base$ = api.mainchain$;
  }
}

/** A sidechain outpoint: a link to its transaction (regular), its eCash deposit (deposit), else its label */
@Component({
  selector: 'app-l2-outpoint',
  standalone: true,
  imports: [CommonModule, RouterModule, L2MainLinkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.mono { font-family: monospace; word-break: break-all; }`],
  template: `
    @if (op?.kind === 'regular' && op?.txid) {
      <a [routerLink]="['/tx', op.txid]" class="mono" [title]="op.txid + ':' + op.vout">{{ op.label || (shortId(op.txid) + ':' + op.vout) }}</a>
    } @else if (op?.kind === 'deposit' && op?.txid) {
      <app-l2-main-link kind="tx" [id]="op.txid" [text]="op.label"></app-l2-main-link>
    } @else {
      <span class="mono" [title]="op?.txid || ''">{{ op?.label }}</span>
    }`,
})
export class L2OutpointComponent {
  @Input() op: L2OutPoint | null;
  shortId = shortId;
}

/** Where an output went: the transaction that spent it, or the withdrawal bundle that paid it out */
@Component({
  selector: 'app-l2-spent',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.mono { font-family: monospace; } .muted { color: var(--transparent-fg); }`],
  template: `
    @if (!spent) {
      <span class="muted">unspent</span>
    } @else if (spent.kind === 'bundle') {
      <span class="muted">withdrawn in a bundle at <a [routerLink]="['/block', spent.height]">{{ spent.height }}</a></span>
    } @else if (spent.txid) {
      <span class="muted">spent in </span><a [routerLink]="['/tx', spent.txid]" class="mono" [title]="spent.txid">{{ shortId(spent.txid) }}{{ spent.vin !== null ? ':' + spent.vin : '' }}</a>
    } @else {
      <span class="muted">spent at <a [routerLink]="['/block', spent.height]">{{ spent.height }}</a></span>
    }`,
})
export class L2SpentComponent {
  @Input() spent: L2Spent | null;
  shortId = shortId;
}

const CONTENT_NAMES: Record<string, string> = {
  value: 'Value', withdrawal: 'Withdrawal', bitname: 'BitName', bitnameReservation: 'BitName reservation',
  bitasset: 'BitAsset', bitassetControl: 'BitAsset control', bitassetReservation: 'BitAsset reservation',
  ammLpToken: 'AMM LP token', dutchAuctionReceipt: 'Dutch auction receipt', marketFunds: 'Market funds', swapPending: 'Swap pending', other: 'Other',
};

/**
 * Any JSON the node gives (TxData, feature items, content we do not know): primitives as text, objects as key/value
 * tables, arrays of objects as tables, nested up to a few levels, then as JSON text
 */
@Component({
  selector: 'app-l2-value',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline; }
    .mono { font-family: monospace; font-size: 0.8rem; word-break: break-all; }
    .muted { color: var(--transparent-fg); }
    table.kv { margin: 0; font-size: 0.82rem; width: 100%; }
    table.kv > tbody > tr > th { color: var(--transparent-fg); font-weight: normal; white-space: nowrap; padding: 2px 12px 2px 0; vertical-align: top; width: 1%; }
    table.kv > tbody > tr > td { padding: 2px 0; vertical-align: top; }
    table.grid { margin: 0; font-size: 0.8rem; width: 100%; }
    table.grid th { color: var(--transparent-fg); font-weight: normal; white-space: nowrap; padding: 2px 10px 2px 0; }
    table.grid td { padding: 2px 10px 2px 0; vertical-align: top; }
    .nest { border-left: 2px solid #ffffff14; padding-left: 8px; }
  `],
  template: `
    @switch (shape) {
      @case ('none') {<span class="muted">–</span>}
      @case ('bool') {<span>{{ value ? 'yes' : 'no' }}</span>}
      @case ('number') {<span>{{ value }}</span>}
      @case ('text') {<span [class.mono]="isLong(value)">{{ value }}</span>}
      @case ('empty') {<span class="muted">{{ isArray(value) ? 'none' : 'empty' }}</span>}
      @case ('list') {<span class="mono">{{ listText() }}</span>}
      @case ('json') {<code class="mono">{{ json() }}</code>}
      @case ('table') {
        <div class="nest">
          <table class="grid">
            <thead><tr>@for (k of columns(); track k) {<th>{{ label(k) }}</th>}</tr></thead>
            <tbody>
              @for (row of value; track $index) {
                <tr>@for (k of columns(); track k) {<td><app-l2-value [value]="row?.[k]" [depth]="depth + 1"></app-l2-value></td>}</tr>
              }
            </tbody>
          </table>
        </div>
      }
      @case ('array') {
        <div class="nest">
          <table class="kv"><tbody>
            @for (v of value; track $index) {
              <tr><th>{{ $index }}</th><td><app-l2-value [value]="v" [depth]="depth + 1"></app-l2-value></td></tr>
            }
          </tbody></table>
        </div>
      }
      @case ('object') {
        <div [class.nest]="depth > 0">
          <table class="kv"><tbody>
            @for (k of keys(); track k) {
              <tr><th>{{ label(k) }}</th><td><app-l2-value [value]="value[k]" [depth]="depth + 1"></app-l2-value></td></tr>
            }
          </tbody></table>
        </div>
      }
    }`,
})
export class L2ValueComponent {
  @Input() value: any;
  @Input() depth = 0;
  /** keys left out of an object (e.g. one shown elsewhere) */
  @Input() skip: string[] = [];

  get shape(): string {
    const v = this.value;
    if (v === null || v === undefined) {
      return 'none';
    }
    if (typeof v === 'boolean') {
      return 'bool';
    }
    if (typeof v === 'number' || typeof v === 'bigint') {
      return 'number';
    }
    if (typeof v !== 'object') {
      return 'text';
    }
    if (this.depth > 4) {
      return 'json';
    }
    if (Array.isArray(v)) {
      if (!v.length) {
        return 'empty';
      }
      if (v.every(x => x === null || typeof x !== 'object')) {
        return 'list';
      }
      if (v.every(x => x && typeof x === 'object' && !Array.isArray(x)) && this.columns().length <= 8) {
        return 'table';
      }
      return 'array';
    }
    return this.keys().length ? 'object' : 'empty';
  }

  isArray(v: any): boolean {
    return Array.isArray(v);
  }

  isLong(v: any): boolean {
    return String(v).length > 32;
  }

  keys(): string[] {
    return Object.keys(this.value ?? {}).filter(k => !this.skip.includes(k));
  }

  columns(): string[] {
    const out: string[] = [];
    for (const row of this.value as any[]) {
      for (const k of Object.keys(row ?? {})) {
        if (!out.includes(k)) {
          out.push(k);
        }
      }
    }
    return out;
  }

  listText(): string {
    return (this.value as any[]).map(x => x === null ? 'null' : String(x)).join(', ');
  }

  json(): string {
    try {
      return JSON.stringify(this.value);
    } catch (e) {
      return String(this.value);
    }
  }

  /** a field name as words: name_hash, nameHash -> name hash */
  label(k: string): string {
    return humanize(k);
  }
}

export function humanize(k: string): string {
  return String(k).replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** What an output holds: sats, a withdrawal to eCash, a name, an asset, market funds... */
@Component({
  selector: 'app-l2-content',
  standalone: true,
  imports: [CommonModule, RouterModule, L2AmountComponent, L2MainLinkComponent, L2ValueComponent, L2AssetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .pill { display: inline-block; font-size: 0.7rem; padding: 0 7px; border-radius: 10px; background: #ffffff14; margin-right: 4px; white-space: nowrap; }
    .pill.w { background: color-mix(in srgb, #f5b83d 30%, transparent); }
    .pill.a { background: color-mix(in srgb, var(--chain-accent, #E6A849) 30%, transparent); }
    .muted { color: var(--transparent-fg); font-size: 0.85em; }
    .mono { font-family: monospace; font-size: 0.8rem; word-break: break-all; }
  `],
  template: `
    @if (!c) {
      <app-l2-amount [sats]="value"></app-l2-amount>
    } @else {
      @switch (c.type) {
        @case ('value') {<app-l2-amount [sats]="c.value ?? value"></app-l2-amount>}
        @case ('withdrawal') {
          <span class="pill w">withdrawal</span><app-l2-amount [sats]="c.value ?? value"></app-l2-amount>
          @if (c.mainAddress) {<span class="muted"> to </span><app-l2-main-link kind="address" [id]="c.mainAddress" [short]="true"></app-l2-main-link>}
          @if (c.mainFee !== undefined && c.mainFee !== null) {<span class="muted"> · eCash fee </span><app-l2-amount [sats]="c.mainFee"></app-l2-amount>}
        }
        @case ('marketFunds') {
          <span class="pill a">market funds</span><app-l2-amount [sats]="c.value ?? c.amount ?? value"></app-l2-amount>
        }
        @default {
          <span class="pill a">{{ typeName(c.type) }}</span>
          @if (c.amount !== undefined && c.amount !== null) {<span class="me-1">{{ c.amount | number }}</span>}
          @if (c.name) {
            @if (c.type === 'bitname') {<app-l2-asset class="me-1" [id]="c.name" kind="name"></app-l2-asset>} @else {<span class="mono me-1">{{ c.name }}</span>}
          }
          @if (c.assetId) {
            @if (c.type === 'dutchAuctionReceipt') {<span class="muted">auction </span><a [routerLink]="['/auctions', c.assetId]" class="mono" [title]="c.assetId">{{ shortId(c.assetId) }}</a>}
            @else {<app-l2-asset [id]="c.assetId"></app-l2-asset>}
          }
          @if (c.value) {<span class="muted"> · </span><app-l2-amount [sats]="c.value"></app-l2-amount>}
          @if (c.type === 'other' && c.raw !== undefined) {<div><app-l2-value [value]="c.raw" [depth]="1"></app-l2-value></div>}
        }
      }
    }`,
})
export class L2ContentComponent {
  @Input() c: L2Content | null;
  /** the output's or input's sats, when the content has none */
  @Input() value: number | null = null;
  shortId = shortId;

  typeName(t: string): string {
    return CONTENT_NAMES[t] ?? humanize(t);
  }
}

/** A transaction's inputs and outputs, side by side */
@Component({
  selector: 'app-l2-tx-io',
  standalone: true,
  imports: [CommonModule, RouterModule, L2ContentComponent, L2OutpointComponent, L2SpentComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .io { display: grid; grid-template-columns: 1fr 24px 1fr; gap: 6px; align-items: start; }
    @media (max-width: 800px) { .io { grid-template-columns: 1fr; } .arrow { transform: rotate(90deg); justify-self: center; } }
    .arrow { color: var(--transparent-fg); text-align: center; padding-top: 10px; font-size: 1.1rem; }
    .row-io { background: var(--bg); border-radius: 6px; padding: 6px 10px; margin-bottom: 4px; font-size: 0.84rem; overflow-wrap: anywhere; }
    .head { display: flex; justify-content: space-between; gap: 8px; }
    .mono { font-family: monospace; font-size: 0.8rem; word-break: break-all; }
    .muted { color: var(--transparent-fg); font-size: 0.8rem; }
    .none { color: var(--transparent-fg); font-size: 0.84rem; padding: 6px 10px; }
  `],
  template: `
    <div class="io">
      <div>
        @for (i of tx.inputs; track $index) {
          <div class="row-io">
            <div class="head">
              <app-l2-outpoint [op]="i.outpoint"></app-l2-outpoint>
              <app-l2-content [c]="i.content" [value]="i.value"></app-l2-content>
            </div>
            @if (i.address) {<div><a [routerLink]="['/address', i.address]" class="mono">{{ i.address }}</a></div>}
          </div>
        } @empty {
          <div class="none">{{ emptyInputs }}</div>
        }
      </div>
      <div class="arrow">&rarr;</div>
      <div>
        @for (o of tx.outputs; track o.vout) {
          <div class="row-io">
            <div class="head">
              <span><span class="muted">#{{ o.vout }} </span><a [routerLink]="['/address', o.address]" class="mono">{{ o.address }}</a></span>
              <app-l2-content [c]="o.content" [value]="o.value"></app-l2-content>
            </div>
            @if (o.memo) {<div class="muted">memo <span class="mono">{{ o.memo }}</span></div>}
            @if (showSpent) {<div class="muted"><app-l2-spent [spent]="o.spent"></app-l2-spent></div>}
          </div>
        } @empty {
          <div class="none">no outputs</div>
        }
      </div>
    </div>`,
})
export class L2TxIoComponent {
  @Input() tx: Pick<L2TxSummary, 'inputs' | 'outputs'>;
  @Input() showSpent = true;
  @Input() emptyInputs = 'no inputs';
}

export const L2_COMMON = [
  L2AmountComponent, L2StateComponent, L2MainLinkComponent, L2OutpointComponent, L2SpentComponent, L2ValueComponent,
  L2ContentComponent, L2TxIoComponent,
] as const;

/** the pages' imports (with the explorers' data table) */
export const L2_PAGE_IMPORTS = [CommonModule, RouterModule, SharedModule, ...L2_COMMON, ChainTableComponent, CxCellDirective];
