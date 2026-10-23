import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, map, of, startWith } from 'rxjs';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2Market, L2Positions, L2Tx, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';

/*
 * Truthcoin's markets on the transaction and address pages (lean pages and the full UI's panels): what a market tx
 * paid into a market or received from it, its miner fee and the payouts the chain's state made for it; an address's
 * positions and Votecoin. chains/L2-API.md `market`, GET l2/address/:address/positions.
 */

const STYLES = `
:host { display: block; }
.kv { width: 100%; margin: 0; font-size: 0.88rem;
  th { color: var(--transparent-fg); font-weight: normal; white-space: nowrap; padding: 4px 16px 4px 0; vertical-align: top; width: 1%; }
  td { padding: 4px 0; vertical-align: top; overflow-wrap: anywhere; } }
.muted { color: var(--transparent-fg); }
.small { font-size: 0.8rem; }
.mono { font-family: monospace; font-size: 0.85rem; word-break: break-all; }
.pill { display: inline-block; font-size: 0.72rem; padding: 0 7px; border-radius: 10px; background: #ffffff14; white-space: nowrap; }
.pill.buy { background: color-mix(in srgb, #3bd16f 30%, transparent); }
.pill.sell { background: color-mix(in srgb, #ff6b6b 30%, transparent); }
.pill.amplify { background: color-mix(in srgb, #5aa6ff 30%, transparent); }
.pill.skipped { background: color-mix(in srgb, #f5b83d 30%, transparent); }
.big { font-size: 1.05rem; }
.table { font-size: 0.88rem; margin: 0; th { color: var(--transparent-fg); font-weight: normal; font-size: 0.8rem; } td, th { background: transparent; vertical-align: middle; } }
.sum { margin-top: 8px; font-size: 0.82rem; color: var(--transparent-fg); }
.text-end { text-align: right; }
`;

const PAYOUT_NAMES: Record<string, string> = { buyChange: 'change', sellChange: 'change', sellProceeds: 'proceeds' };

/** What a market tx did: shares, sats into or out of the market, the miner fee, the payouts */
@Component({
  selector: 'app-l2-tx-market',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES],
  template: `
  @if (tx?.market; as m) {
    <table class="kv"><tbody>
      <tr><th>Trade</th><td>
        <span [class]="m.applied === false ? 'pill skipped' : 'pill ' + m.action">{{ m.action }}</span>
        @if (m.action === 'amplify') {
          liquidity of market <a [routerLink]="['/markets' | relativeUrl, m.marketId]" class="mono">{{ m.marketId }}</a>
        } @else {
          {{ abs(m.shares) | number }} shares of outcome {{ m.outcome }} in market <a [routerLink]="['/markets' | relativeUrl, m.marketId]" class="mono">{{ m.marketId }}</a>
        }
        @if (m.applied === false) {<div class="muted small">Skipped by its block (over its limit): its inputs were not spent and it paid no fee.</div>}
        @if (m.applied === null) {<div class="muted small">Unconfirmed: what goes to the market and comes back is settled when a block applies it.</div>}
      </td></tr>
      @if (m.applied !== false) {
        @if (m.cost !== null) {
          <tr><th>{{ m.cost < 0 ? 'Received from the market' : 'Paid into the market' }}</th>
            <td class="big"><app-l2-amount [sats]="abs(m.cost)"></app-l2-amount>
              <span class="muted small">{{ m.cost < 0 ? ' · the net proceeds of the sale, out of the market’s treasury' : m.action === 'amplify' ? ' · added to its liquidity' : ' · the LMSR cost and the market’s trading fee' }}</span></td></tr>
        }
        <tr><th>Miner fee</th><td><app-l2-amount [sats]="tx.fee"></app-l2-amount></td></tr>
      }
      @if (m.limit !== null) {
        <tr><th>{{ m.action === 'sell' ? 'Min proceeds' : 'Max cost' }}</th><td><app-l2-amount [sats]="m.limit"></app-l2-amount>
          @if (m.action === 'buy') {<span class="muted small"> incl. the miner fee</span>}</td></tr>
      }
    </tbody></table>
    @if (m.payouts.length) {
      <table class="table table-borderless table-sm mt-2">
        <thead><tr><th>Paid back by the chain</th><th>Outpoint</th><th>To</th><th class="text-end">Amount</th><th class="d-none d-md-table-cell">Then</th></tr></thead>
        <tbody>
          @for (p of m.payouts; track p.vout) {
            <tr>
              <td>{{ payoutName(p.kind) }}</td>
              <td><app-l2-outpoint [op]="p.outpoint"></app-l2-outpoint></td>
              <td><a [routerLink]="['/address' | relativeUrl, p.address]" class="mono" [title]="p.address">{{ shortId(p.address, 10) }}</a></td>
              <td class="text-end"><app-l2-amount [sats]="p.value"></app-l2-amount></td>
              <td class="d-none d-md-table-cell"><app-l2-spent [spent]="p.spent"></app-l2-spent></td>
            </tr>
          }
        </tbody>
      </table>
    }
    @if (m.applied && m.cost !== null) {
      <div class="sum">Inputs <app-l2-amount [sats]="inputs(tx)"></app-l2-amount> =
        @if (outputs(tx)) {outputs <app-l2-amount [sats]="outputs(tx)"></app-l2-amount> + }
        paid back <app-l2-amount [sats]="paidBack(m)"></app-l2-amount>
        {{ m.cost < 0 ? '−' : '+' }} {{ m.cost < 0 ? 'received from' : 'paid into' }} the market <app-l2-amount [sats]="abs(m.cost)"></app-l2-amount>
        + miner fee <app-l2-amount [sats]="tx.fee"></app-l2-amount></div>
    }
  }`,
})
export class L2TxMarketComponent {
  @Input() tx: L2Tx | null;
  shortId = shortId;

  abs(n: number): number {
    return Math.abs(Number(n) || 0);
  }

  payoutName(kind: string): string {
    return PAYOUT_NAMES[kind] ?? kind;
  }

  inputs(tx: L2Tx): number {
    return tx.inputs.reduce((s, i) => s + (i.value ?? 0), 0);
  }

  outputs(tx: L2Tx): number {
    return tx.outputs.reduce((s, o) => s + o.value, 0);
  }

  paidBack(m: L2Market): number {
    return m.payouts.reduce((s, p) => s + p.value, 0);
  }
}

/** An address's positions in the markets (at their current prices) and its Votecoin */
@Component({
  selector: 'app-l2-positions',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [STYLES],
  template: `
  @if (view$ | async; as v) {
    @if (v.loading) {
      <div class="skeleton-loader" style="height: 60px"></div>
    } @else if (v.error) {
      <div class="muted small">Positions are not available: {{ v.error.message }}</div>
    } @else if (v.data; as p) {
      @if (p.positions.length) {
        <table class="table table-borderless table-sm">
          <thead><tr><th>Market</th><th>Outcome</th><th class="text-end">Shares</th><th class="text-end d-none d-md-table-cell">Price</th><th class="text-end">Value</th></tr></thead>
          <tbody>
            @for (x of p.positions; track $index) {
              <tr>
                <td><a [routerLink]="['/markets' | relativeUrl, x.marketId]">{{ x.title || x.marketId }}</a>@if (x.title) {<div class="mono muted small">{{ x.marketId }}</div>}</td>
                <td>{{ x.outcomeName || ('Outcome ' + x.outcome) }}</td>
                <td class="text-end">{{ x.shares | number }}</td>
                <td class="text-end d-none d-md-table-cell">@if (x.price !== null) {<span>{{ x.price | number:'1.0-4' }}</span>} @else {<span class="muted">–</span>}</td>
                <td class="text-end"><app-l2-amount [sats]="x.value"></app-l2-amount></td>
              </tr>
            }
          </tbody>
        </table>
        <div class="sum">Worth <app-l2-amount [sats]="p.value"></app-l2-amount> at the markets' current prices (a share pays its outcome's final price in sats).</div>
      } @else {
        <div class="muted small">No shares in any market.</div>
      }
      <table class="kv mt-2"><tbody>
        <tr><th>Votecoin</th><td>{{ p.votecoin | number:'1.0-8' }} <span class="muted small">· the oracle's reputation: its share of the votes</span></td></tr>
      </tbody></table>
    }
  }`,
})
export class L2PositionsComponent implements OnChanges {
  @Input() address: string;
  view$: Observable<Loaded<L2Positions>>;

  constructor(private api: L2ApiService) {}

  ngOnChanges(): void {
    if (!this.address) {
      return;
    }
    this.view$ = this.api.positions$(this.address).pipe(
      map(data => ({ loading: false, data }) as Loaded<L2Positions>),
      catchError(e => of({ loading: false, error: l2Error(e) } as Loaded<L2Positions>)),
      startWith({ loading: true } as Loaded<L2Positions>),
    );
  }
}
