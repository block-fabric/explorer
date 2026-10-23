import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { PROFILE } from '@app/chain/profiles';
import { SidechainLabelComponent } from '@app/chain/components/sidechain-label/sidechain-label.component';
import { ECASH_GOLD, ECASH_MARK_PATHS, ECASH_MARK_VIEWBOX } from '@app/chain/marks';
import { FreebankApiService, FbLoaded } from './freebank-api.service';
import { Bill } from './freebank.interfaces';
import * as F from './freebank-format';

/*
 * The building blocks of FreeBank's pages: request states, page heads with their sibling tabs, links to the eCash
 * explorer, a decoded operation's fields, and the bills table. Everything from the chain goes through interpolation and
 * property bindings (never [innerHTML]).
 */

/** A request's loading, not found and failed states */
@Component({
  selector: 'app-fb-state',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.unavail { padding: 18px; border-radius: 8px; background: var(--box-bg); color: var(--transparent-fg); }`],
  template: `
    @if (state?.loading) {
      <div class="skeleton-loader" [style.height.px]="height"></div>
    } @else if (state?.error; as e) {
      @if (e.status === 404) {
        <div class="alert alert-warning">{{ what }} not found{{ id ? ': ' : '' }}<span class="text-break">{{ id }}</span></div>
      } @else if (e.status === 400) {
        <div class="alert alert-warning">Not a valid {{ what.toLowerCase() }}{{ id ? ': ' : '' }}<span class="text-break">{{ id }}</span></div>
      } @else {
        <div class="unavail">{{ what }} is not available: {{ e.message }}.</div>
      }
    }`,
})
export class FbStateComponent {
  @Input() state: FbLoaded<any> | null;
  @Input() what = 'Data';
  @Input() id: string | number | null = null;
  @Input() height = 200;
}

export interface FbTab { path: string; title: string }

export const CREDIT_TABS: FbTab[] = [
  { path: '/houses', title: 'Discount houses' }, { path: '/bills', title: 'Bills' }, { path: '/loanbook', title: 'Loan book' },
];
export const MARKET_TABS: FbTab[] = [
  { path: '/gold', title: 'Gold fix and oracles' }, { path: '/pools', title: 'Note pools' }, { path: '/assets', title: 'Assets' },
];
export const PEG_TABS: FbTab[] = [{ path: '/peg', title: 'The peg' }, { path: '/bmm', title: 'BMM on eCash' }];

/** A page's head: the chain's mark, title, a line under it, the sibling pages' tabs */
@Component({
  selector: 'app-fb-head',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', './freebank-page.scss'],
  template: `
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="28" height="28" class="cmark"></app-svg-images> {{ title }}<ng-content></ng-content></h1>
    @if (sub) {<div class="sub">{{ sub }}</div>}
    @if (tabs?.length) {
      <div class="ftabs">@for (t of tabs; track t.path) {<a [routerLink]="[t.path]" [class.on]="t.path === active">{{ t.title }}</a>}</div>
    }`,
})
export class FbHeadComponent {
  @Input() title = '';
  @Input() sub: string | null = null;
  @Input() tabs: FbTab[] | null = null;
  @Input() active = '';
  profile = PROFILE;
}

/** A link to the eCash explorer (block by hash or height, tx, address), with eCash's mark; plain text when there is none */
@Component({
  selector: 'app-fb-ecash',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.mono { font-family: monospace; } :host { white-space: nowrap; } .m { width: 1.05em; height: 1.05em; vertical-align: -0.18em; margin-right: 0.3em; }`],
  template: `@if (mark) {<svg class="m" [attr.viewBox]="viewBox" aria-hidden="true" focusable="false">@for (d of paths; track $index) {<path [attr.d]="d" [attr.fill]="gold"></path>}</svg>}@if (base$ | async; as base) {<a [href]="base + '/' + kind + '/' + id" [title]="'On the eCash explorer: ' + kind + ' ' + id" [class.mono]="mono">{{ text ?? id }}</a>} @else {<span [class.mono]="mono" [title]="id">{{ text ?? id }}</span>}`,
})
export class FbEcashLinkComponent {
  @Input() kind: 'block' | 'tx' | 'address' = 'block';
  @Input() id: string | number = '';
  @Input() text: string | null = null;
  @Input() mark = true;
  @Input() mono = false;
  base$: Observable<string | null>;
  paths = ECASH_MARK_PATHS;
  viewBox = ECASH_MARK_VIEWBOX;
  gold = ECASH_GOLD;

  constructor(api: FreebankApiService) {
    this.base$ = api.mainchain$;
  }
}

/** a field of a decoded operation or record, as the table shows it */
interface FbField {
  key: string;
  label: string;
  type: 'house' | 'bill' | 'pool' | 'block' | 'tx' | 'outpoint' | 'address' | 'sats' | 'units' | 'bps' | 'hex' | 'text';
  value: any;
}

/**
 * A flat key/value object (a credit operation's fields: GET /api/v1/freebank/tx/:txid credit.fields) as a table, with
 * friendly labels and links by the key's shape: house_id, bill_id, pool_id, *_height, *txid, outpoints, addresses,
 * *_sats (as ECX), *units, *bps
 */
@Component({
  selector: 'app-fb-fields',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../l2/full/l2-panel.scss'],
  template: `
    <table class="table table-borderless table-striped mb-0"><tbody>
      @for (f of fields; track f.key) {
        <tr><td class="td-width" [title]="f.key">{{ f.label }}</td><td>
          @switch (f.type) {
            @case ('house') {<a [routerLink]="['/house', f.value]">house {{ f.value }}</a>}
            @case ('bill') {<a [routerLink]="['/bill', f.value]">bill {{ f.value }}</a>}
            @case ('pool') {<a [routerLink]="['/pool', f.value]">pool {{ f.value }}</a>}
            @case ('block') {<a [routerLink]="['/block', f.value]">{{ f.value | number }}</a>}
            @case ('tx') {<a [routerLink]="['/tx', f.value]" class="mono">{{ f.value }}</a>}
            @case ('outpoint') {<a [routerLink]="['/tx', f.value[0]]" [fragment]="'vout=' + f.value[1]" class="mono">{{ f.value[0] }}:{{ f.value[1] }}</a>}
            @case ('address') {<a [routerLink]="['/address', f.value]" class="mono">{{ f.value }}</a>}
            @case ('sats') {<span>{{ fx.sats(f.value) }} ECX</span> <span class="muted">({{ f.value | number }} sats)</span>}
            @case ('units') {<span>{{ fx.num(f.value) }} <span class="muted">note units</span></span>}
            @case ('bps') {<span>{{ fx.bps(f.value) }}</span>}
            @case ('hex') {<span class="mono">{{ f.value }}</span>}
            @default {<span>{{ f.value }}</span>}
          }
        </td></tr>
      } @empty {<tr><td class="muted">No field decoded.</td></tr>}
    </tbody></table>`,
})
export class FbFieldsComponent implements OnChanges {
  @Input() data: Record<string, unknown> | null | undefined;
  fields: FbField[] = [];
  fx = F;

  ngOnChanges(): void {
    this.fields = Object.entries(this.data ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => this.field(k, v));
  }

  private field(key: string, v: unknown): FbField {
    const label = F.label(key);
    const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
    const s = typeof v === 'string' ? v : null;
    if (key === 'house_id' && n !== null) {
      return { key, label, type: 'house', value: n };
    }
    if (key === 'bill_id' && n !== null && n < 2 ** 32) {
      return { key, label, type: 'bill', value: n };
    }
    if (key === 'pool_id' && n !== null) {
      return { key, label, type: 'pool', value: n };
    }
    if (/(^|_)height$/.test(key) && n !== null && n > 0) {
      return { key, label, type: 'block', value: n };
    }
    // a peg output's eCash side (ecashTxid, ecashBlock, prevMainBlock): hashes on eCash, not links here
    if (/^(ecash|prevMain)/.test(key) && s) {
      return { key, label, type: 'hex', value: s };
    }
    // a peg output's amounts (sats)
    if (/^(amount|treasuryValue|ecashFee|total|value)$/.test(key) && n !== null) {
      return { key, label, type: 'sats', value: n };
    }
    if (/txid$/.test(key) && s && /^[0-9a-f]{64}$/i.test(s)) {
      return { key, label, type: 'tx', value: s };
    }
    if (s && F.outpoint(s)) {
      return { key, label, type: 'outpoint', value: F.outpoint(s) };
    }
    if (/(^|_)(address|destination)$/.test(key) && s) {
      return { key, label, type: 'address', value: s };
    }
    if (/_sats$/.test(key) && n !== null) {
      return { key, label, type: 'sats', value: n };
    }
    if (/units$/.test(key) && n !== null) {
      return { key, label, type: 'units', value: n };
    }
    if (/bps$/.test(key) && n !== null) {
      return { key, label, type: 'bps', value: n };
    }
    if (s && /^[0-9a-f]{40,}$/i.test(s)) {
      return { key, label, type: 'hex', value: s };
    }
    if (typeof v === 'boolean') {
      return { key, label, type: 'text', value: v ? 'yes' : 'no' };
    }
    if (typeof v === 'object') {
      return { key, label, type: 'text', value: JSON.stringify(v) };
    }
    return { key, label, type: 'text', value: String(v) };
  }
}

/** Bills: id, status, face and escrow, maturity against the tip, holder, the house that holds it */
@Component({
  selector: 'app-fb-bills',
  standalone: true,
  imports: [CommonModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss', './freebank-page.scss'],
  template: `
    <table class="table table-borderless table-sm">
      <thead><tr><th>Bill</th><th>Status</th><th class="r">Face</th><th class="r">Escrow</th><th>Issued</th><th>Maturity</th>
        <th class="d-none d-md-table-cell">Holder</th><th>Held by</th><th class="d-none d-lg-table-cell">Endorsed</th></tr></thead>
      <tbody>
        @for (b of bills; track b.id) {
          <tr>
            <td class="nowrap"><a [routerLink]="['/bill', b.id]">#{{ b.id }}</a></td>
            <td><span class="pill" [ngClass]="fx.billTone(b.status)">{{ fx.billStatus(b.status) }}</span></td>
            <td class="r nowrap">{{ fx.ecx(b.amount) }} <span class="muted">ECX</span></td>
            <td class="r nowrap">{{ fx.ecx(b.escrow) }}</td>
            <td><a [routerLink]="['/block', b.issued_height]">{{ b.issued_height | number }}</a></td>
            <td class="nowrap"><a [routerLink]="['/block', b.maturity_height]">{{ b.maturity_height | number }}</a>
              @if (fx.billTerm(b, tip); as t) {@if (t.label) {<div class="hint" [class.neg]="t.tone === 'bad'">{{ t.label }}</div>}}</td>
            <td class="d-none d-md-table-cell mono" [title]="b.holder_pubkey">{{ fx.shortId(b.holder_pubkey, 6) }}</td>
            <td>@if (b.owner_house_id) {<a [routerLink]="['/house', b.owner_house_id]">house {{ b.owner_house_id }}</a>} @else {<span class="muted">–</span>}</td>
            <td class="d-none d-lg-table-cell">{{ b.endorsements?.length || 0 }}</td>
          </tr>
        } @empty {<tr><td colspan="9" class="empty">{{ empty }}</td></tr>}
      </tbody>
    </table>`,
})
export class FbBillsTableComponent {
  @Input() bills: Bill[] = [];
  @Input() tip: number | null = null;
  @Input() empty = 'No bill.';
  fx = F;
}

export const FB_PAGE_IMPORTS = [
  CommonModule, RouterModule, SharedModule, SidechainLabelComponent, FbStateComponent, FbHeadComponent, FbEcashLinkComponent,
  FbFieldsComponent, FbBillsTableComponent,
];
