import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService, loaded } from '@app/chain/l2/l2-api.service';
import { L2Tx, Loaded } from '@app/chain/l2/l2.interfaces';
import { L2_PAGE_IMPORTS, shortId } from '@app/chain/l2/l2-common';
import { L2TxAssetsComponent, hasAssets } from '@app/chain/l2/features/asset-badge';
import { L2TxMarketComponent } from '@app/chain/l2/features/market';

/** /tx/:txid: status, inputs and outputs, fee, a market tx's trade (Truthcoin), TxData, zSide's shielded bundle, signers */
@Component({
  selector: 'app-l2-tx',
  standalone: true,
  imports: [...L2_PAGE_IMPORTS, L2TxAssetsComponent, L2TxMarketComponent],
  styleUrls: ['../../components/module-page.scss', './l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <h1>Transaction</h1>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Transaction" [id]="txid" [height]="400"></app-l2-state>
      @if (v.data; as tx) {
        <div class="sub"><span class="id">{{ tx.txid }}</span> <app-clipboard [text]="tx.txid"></app-clipboard></div>
        <div class="grid2">
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Status</th><td>
                @if (tx.status.confirmed) {
                  <span class="status ok">confirmed</span> in block <a [routerLink]="['/block', $any(tx.status).hash]">{{ $any(tx.status).height | number }}</a>
                } @else {
                  <span class="status wait">unconfirmed</span>
                }
              </td></tr>
              @if (tx.status.confirmed && $any(tx.status).time) {
                <tr><th>Time</th><td><app-timestamp [unixTime]="$any(tx.status).time"></app-timestamp></td></tr>
              }
              @if (tx.status.confirmed) {<tr><th>Position</th><td>#{{ tx.index }} in its block</td></tr>}
              <tr><th>{{ tx.market ? 'Miner fee' : 'Fee' }}</th><td><app-l2-amount [sats]="tx.fee"></app-l2-amount></td></tr>
              @if (tx.market && tx.market.cost !== null && tx.market.applied) {
                <tr><th>{{ tx.market.cost < 0 ? 'From the market' : 'Into the market' }}</th><td><app-l2-amount [sats]="tx.market.cost < 0 ? -tx.market.cost : tx.market.cost"></app-l2-amount></td></tr>
              }
              <tr><th>Size</th><td>@if (tx.size !== null && tx.size !== undefined) {<span>{{ tx.size | number }} bytes</span>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Inputs / outputs</th><td>{{ tx.inputs.length }} / {{ tx.outputs.length }}</td></tr>
            </tbody></table>
          </div>
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Signers</th><td>
                @for (s of tx.signers; track $index) {
                  <div><span class="muted">input {{ $index }} </span><a [routerLink]="['/address', s]" class="mono">{{ s }}</a></div>
                } @empty {<span class="muted">none</span>}
              </td></tr>
              @if (tx.data) {<tr><th>Data</th><td><span class="pill on">{{ tx.data.type }}</span></td></tr>}
              @if (tx.shielded) {<tr><th>Shielded</th><td><span class="pill on">Orchard bundle</span></td></tr>}
            </tbody></table>
          </div>
        </div>

        @if (tx.market) {
          <h2>Market</h2>
          <div class="box"><app-l2-tx-market [tx]="tx"></app-l2-tx-market></div>
        }

        <h2>Inputs and outputs</h2>
        <div class="tx-card"><app-l2-tx-io [tx]="tx"></app-l2-tx-io></div>

        @if (hasAssets(tx)) {
          <h2>Assets</h2>
          <div class="box"><app-l2-tx-assets [tx]="tx"></app-l2-tx-assets></div>
        }

        @if (tx.data; as data) {
          <h2>Data: {{ data.type }}</h2>
          <div class="box"><app-l2-value [value]="data" [skip]="['type']"></app-l2-value></div>
        }

        @if (tx.shielded; as sh) {
          <h2>Shielded (Orchard)</h2>
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Actions</th><td>{{ sh.actions | number }}</td></tr>
              <tr><th>Value balance</th><td><app-l2-amount [sats]="sh.valueBalance" [signed]="true"></app-l2-amount>
                <span class="muted"> · {{ sh.valueBalance < 0 ? 'into the shielded pool' : sh.valueBalance > 0 ? 'out of the shielded pool' : 'within the pool' }}</span></td></tr>
              <tr><th>Flags</th><td>{{ sh.flags }}
                <span class="muted"> · spends {{ flag(sh.flags, 1) }}, outputs {{ flag(sh.flags, 2) }}</span></td></tr>
            </tbody></table>
          </div>
        }
      }
    }
  </div>`,
})
export class L2TxPage implements OnInit {
  txid: string | null = null;
  view$: Observable<Loaded<L2Tx>>;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  /** the tx moves assets or names (BitAssets, BitNames): their summary shows */
  hasAssets(tx: L2Tx): boolean {
    return hasAssets([...tx.inputs.map(i => i.content), ...tx.outputs.map(o => o.content)]);
  }

  /** an Orchard bundle flag: 1 spends, 2 outputs */
  flag(flags: number, bit: number): string {
    return (Number(flags) & bit) ? 'enabled' : 'disabled';
  }

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('txid') ?? '')),
      tap(txid => {
        this.txid = txid;
        this.seo.setTitle('Transaction ' + shortId(txid));
      }),
      switchMap(txid => loaded(this.api.tx$(txid))),
    );
  }
}
