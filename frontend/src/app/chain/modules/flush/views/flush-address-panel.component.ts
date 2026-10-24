import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, map } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FlushApiService, FlushLoaded, flushLoaded } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS } from '../flush-kit';
import { Holding, Holdings, Position } from '../flush.interfaces';
import * as F from '../flush-format';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

/** A position the address holds (GET market/positions/{id}): its range, amounts, fees, in range or not */
@Component({
  selector: 'app-flush-position',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`:host { display: block; font-size: 0.8rem; color: var(--transparent-fg); } .pos { color: #3bd16f; }`],
  template: `
    @if (view$ | async; as v) {
      @if (v.data; as p) {
        <span>{{ fx.price(p.price_lower) }} to {{ fx.price(p.price_upper) }} {{ p.asset_b }} per {{ p.asset_a }}</span>
        · <span [class.pos]="p.in_range">{{ p.in_range ? 'in range' : 'out of range' }}</span>
        · {{ fx.amount(p.amount_a) }} {{ p.asset_a }} + {{ fx.amount(p.amount_b) }} {{ p.asset_b }}
        · fees owed {{ fx.amount(p.fees_a) }} {{ p.asset_a }} + {{ fx.amount(p.fees_b) }} {{ p.asset_b }}
        · <a [routerLink]="['/pool', p.pool]">its pool</a>
      }
    }`,
})
export class FlushPositionComponent implements OnChanges {
  @Input() id: string;
  fx = F;
  view$: Observable<FlushLoaded<Position>>;

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    this.view$ = flushLoaded(this.api.market$<Position>('positions/' + this.api.seg(this.id)));
  }
}

/**
 * The address page's Flush panel (GET market/addresses/{address}/holdings, the public API's market index): the assets,
 * liquidity shares, concentrated positions and open orders the address holds, with their value in ECX.
 */
@Component({
  selector: 'app-flush-address-panel',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS, FlushPositionComponent],
  styleUrls: ['../../../l2/full/l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (view$ | async; as v) {
    @if (v.data; as h) {
      @if (h.items.length) {
        <div class="title-row">
          <h2 class="p-title">Holdings</h2>
          <span class="p-sub">assets, liquidity, positions and orders on {{ profile.name }} · worth {{ fx.amount(total(h.items), 4) }} ECX at the pools' prices</span>
        </div>
        <div class="box p-box">
          <app-chain-table [rows]="h.items" [columns]="cols" [filters]="kinds" [search]="matches" searchPlaceholder="Ticker or id" sort="value" [pageSize]="25">
            <ng-template cxCell="kind" let-x><span class="pill" [class.on]="x.kind === 'asset'">{{ kindLabel(x.kind) }}</span></ng-template>
            <ng-template cxCell="what" let-x>
              @switch (x.kind) {
                @case ('lp') {<a [routerLink]="['/pool', x.asset_id]">{{ x.ticker }} pool shares</a>}
                @case ('position') {<span>{{ x.ticker }} position</span><span class="mono muted ms-1">{{ fx.shortId(x.asset_id, 6) }}</span><app-flush-position [id]="x.asset_id"></app-flush-position>}
                @case ('order') {<span>{{ x.ticker }} order</span><span class="mono muted ms-1">{{ fx.shortId(x.asset_id, 6) }}</span>}
                @default {<app-flush-token [ticker]="x.ticker" [id]="x.asset_id"></app-flush-token>}
              }
            </ng-template>
            <ng-template cxCell="amount" let-x>{{ fx.amount(x.amount) }}</ng-template>
            <ng-template cxCell="value" let-x>{{ x.value_ecx ? fx.amount(x.value_ecx, 4) + ' ECX' : '–' }}</ng-template>
          </app-chain-table>
        </div>
        <br>
      }
    }
  }`,
})
export class FlushAddressPanelComponent implements OnChanges {
  @Input() address: string;
  profile = PROFILE;
  fx = F;
  view$: Observable<FlushLoaded<Holdings>>;
  cols: CxColumn<Holding>[] = [
    { key: 'kind', label: 'Kind', sort: x => x.kind },
    { key: 'what', label: 'What', sort: x => x.ticker },
    { key: 'amount', label: 'Amount', align: 'right', sort: x => Number(x.amount), nowrap: true },
    { key: 'value', label: 'Value', align: 'right', sort: x => Number(x.value_ecx) || 0, nowrap: true },
  ];
  kinds: CxFilter<Holding>[] = [{ label: 'Kind', options: ['asset', 'lp', 'position', 'order'].map(k => ({ label: this.kindLabel(k), test: (x: Holding) => x.kind === k })) }];
  matches = (x: Holding, q: string) => `${x.ticker ?? ''} ${x.asset_id ?? ''}`.toLowerCase().includes(q);

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    if (this.address) {
      this.view$ = flushLoaded(this.api.market$<Holdings>(`addresses/${this.api.seg(this.address)}/holdings`).pipe(map(h => ({ ...h, items: h?.items ?? [] }))));
    }
  }

  total(items: Holding[]): number {
    return items.reduce((s, x) => s + (Number(x.value_ecx) || 0), 0);
  }

  kindLabel(k: string): string {
    return ({ asset: 'asset', lp: 'liquidity', position: 'position', order: 'order' } as Record<string, string>)[k] ?? k;
  }
}
