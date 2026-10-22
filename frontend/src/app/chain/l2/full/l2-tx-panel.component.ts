import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable, catchError, map, of, startWith, switchMap, takeWhile, timer } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { L2ApiService, l2Error } from '@app/chain/l2/l2-api.service';
import { L2Input, L2Output, L2Tx, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';
import { L2TxAssetsComponent, hasAssets } from '@app/chain/l2/features/asset-badge';

/**
 * The transaction page's sidechain panel (CHAIN_UI 'full'), under upstream's transaction header: what upstream's
 * Bitcoin-shaped view cannot say (GET /api/v1/l2/tx/:txid): the inputs that are deposits from eCash (with their eCash
 * deposit transaction), what the outputs hold besides sats (withdrawals to eCash addresses, names, assets with their
 * ticker, market funds, swaps), the assets moved, the TxData decoded, zSide's shielded bundle, and the signers.
 */
@Component({
  selector: 'app-l2-tx-panel',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, L2TxAssetsComponent],
  styleUrls: ['./l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (view$ | async; as v) {
    @if (v.data; as tx) {
      <div class="title-row"><h2 class="p-title">On {{ profile.name }}</h2><span class="p-sub">deposits, output contents, data and signers, from the sidechain index</span></div>
      <div class="box p-box">
        @if (deposits(tx).length) {
          <section>
            <h5 class="p-h5 mt-0">Deposits from <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label></h5>
            <table class="table table-borderless table-sm p-table mb-0">
              <thead><tr><th>Input</th><th>eCash deposit transaction</th><th class="text-end">Amount</th></tr></thead>
              <tbody>
                @for (d of deposits(tx); track d.i) {
                  <tr>
                    <td>#{{ d.i }}</td>
                    <td>@if (d.input.outpoint.txid) {<app-l2-main-link kind="tx" [id]="d.input.outpoint.txid" [short]="true"></app-l2-main-link><span class="muted">:{{ d.input.outpoint.vout }}</span>} @else {<span class="mono">{{ d.input.outpoint.label }}</span>}</td>
                    <td class="text-end"><app-l2-content [c]="d.input.content" [value]="d.input.value"></app-l2-content></td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
        @if (special(tx).length) {
          <section>
            <h5 class="p-h5 mt-0">What the outputs hold</h5>
            <table class="table table-borderless table-sm p-table mb-0">
              <thead><tr><th>Output</th><th>Content</th><th class="d-none d-md-table-cell">Address</th></tr></thead>
              <tbody>
                @for (o of special(tx); track o.vout) {
                  <tr>
                    <td>#{{ o.vout }}</td>
                    <td><app-l2-content [c]="o.content" [value]="o.value"></app-l2-content>@if (o.memo) {<div class="muted small">memo <span class="mono">{{ o.memo }}</span></div>}</td>
                    <td class="addr d-none d-md-table-cell"><a [routerLink]="['/address' | relativeUrl, o.address]" class="mono" [title]="o.address">{{ o.address }}</a></td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }
        @if (hasAssets(tx)) {
          <section>
            <h5 class="p-h5 mt-0">Assets and names moved</h5>
            <app-l2-tx-assets [tx]="tx"></app-l2-tx-assets>
          </section>
        }
        @if (tx.data; as data) {
          <section>
            <h5 class="p-h5 mt-0">Data <span class="pill accent">{{ data.type }}</span></h5>
            <app-l2-value [value]="data" [skip]="['type']"></app-l2-value>
          </section>
        }
        @if (tx.shielded; as sh) {
          <section>
            <h5 class="p-h5 mt-0">Shielded (Orchard)</h5>
            <table class="table table-borderless table-sm p-table mb-0"><tbody>
              <tr><td class="td-width">Actions</td><td>{{ sh.actions | number }}</td></tr>
              <tr><td class="td-width">Value balance</td><td><app-l2-amount [sats]="sh.valueBalance" [signed]="true"></app-l2-amount>
                <span class="muted"> · {{ sh.valueBalance < 0 ? 'into the shielded pool' : sh.valueBalance > 0 ? 'out of the shielded pool' : 'within the pool' }}</span></td></tr>
              <tr><td class="td-width">Flags</td><td>{{ sh.flags }} <span class="muted"> · spends {{ flag(sh.flags, 1) }}, outputs {{ flag(sh.flags, 2) }}</span></td></tr>
            </tbody></table>
          </section>
        }
        <section>
          <h5 class="p-h5 mt-0">Signers</h5>
          @for (s of tx.signers; track $index) {
            <div><span class="muted">input {{ $index }} </span><a [routerLink]="['/address' | relativeUrl, s]" class="mono">{{ s }}</a></div>
          } @empty {
            <div class="muted">{{ tx.inputs.length ? 'none' : 'none (no inputs)' }}</div>
          }
        </section>
      </div>
      <br>
    }
  }`,
})
export class L2TxPanelComponent implements OnChanges {
  @Input() txid: string;

  profile = PROFILE;
  view$: Observable<Loaded<L2Tx>>;
  shortId = shortId;
  private depositCache = new WeakMap<L2Tx, { i: number; input: L2Input }[]>();
  private specialCache = new WeakMap<L2Tx, L2Output[]>();

  constructor(private api: L2ApiService) {}

  ngOnChanges(): void {
    if (!this.txid) {
      return;
    }
    // an unconfirmed transaction the index has not seen yet: ask again a few times
    let tries = 0;
    this.view$ = timer(0, 10000).pipe(
      switchMap(() => this.api.tx$(this.txid).pipe(
        map(data => ({ loading: false, data }) as Loaded<L2Tx>),
        catchError(e => of({ loading: false, error: l2Error(e) } as Loaded<L2Tx>)),
      )),
      takeWhile(v => !!v.error && v.error.status === 404 && tries++ < 6, true),
      startWith({ loading: true } as Loaded<L2Tx>),
    );
  }

  /** the inputs that spend a deposit from eCash */
  deposits(tx: L2Tx): { i: number; input: L2Input }[] {
    let d = this.depositCache.get(tx);
    if (!d) {
      d = tx.inputs.map((input, i) => ({ i, input })).filter(x => x.input.outpoint?.kind === 'deposit');
      this.depositCache.set(tx, d);
    }
    return d;
  }

  /** the outputs that hold more than plain sats */
  special(tx: L2Tx): L2Output[] {
    let o = this.specialCache.get(tx);
    if (!o) {
      o = tx.outputs.filter(x => x.content && x.content.type !== 'value');
      this.specialCache.set(tx, o);
    }
    return o;
  }

  hasAssets(tx: L2Tx): boolean {
    return hasAssets([...tx.inputs.map(i => i.content), ...tx.outputs.map(o => o.content)]);
  }

  /** an Orchard bundle flag: 1 spends, 2 outputs */
  flag(flags: number, bit: number): string {
    return (Number(flags) & bit) ? 'enabled' : 'disabled';
  }
}
