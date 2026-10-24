import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FlushApiService, FlushLoaded, flushLoaded } from '../flush-api.service';
import { FLUSH_PAGE_IMPORTS } from '../flush-kit';
import * as F from '../flush-format';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

/** an output of an asset transaction: what it carries */
interface TxOutput { n: number; carries: string; id?: string; amount?: number }

/** GET /api/v1/flush/tx/:txid (chains/FLUSH-API.md) */
export interface FlushTxInfo {
  txid: string;
  confirmed: boolean;
  asset: { operation: Record<string, any> | null; outputs: TxOutput[]; error: string | null } | null;
  peg: any[] | null;
  stake: any[] | null;
}

/** an operation's field as the panel shows it */
interface OpField {
  key: string;
  label: string;
  type: 'asset' | 'amount' | 'pool' | 'pools' | 'address' | 'hex' | 'text' | 'path';
  value: any;
  /** an amount's asset id (its units) */
  asset?: string | null;
}

const ECX = '0'.repeat(64);
/** what each operation (decodeassettx's name) means, in a few words */
const OPS: Record<string, string> = {
  reserve: 'Reserve a ticker (revealed by its registration)', register: 'Register an asset', mint: 'Mint more of an asset', burn: 'Burn an asset',
  retire: 'Retire an asset', transfer: 'Move assets', swap: 'Swap (an order of the block\'s batch, through the pair\'s default pool)',
  swap_route: 'Swap along a route (an order of the batch, through the pairs\' default pools)', swap_pools: 'Swap through named pools (an order of the batch)',
  add_liquidity: 'Add liquidity to a pair\'s default pool', remove_liquidity: 'Take liquidity out of a pool', create_pool: 'Create a pool',
  pool_deposit: 'Deposit into a pool', pool_withdraw: 'Withdraw from a pool', launch_token: 'Launch a token on a bonding curve',
  claim_launch: 'Claim a launch\'s creator fees (and allocation)', open_position: 'Open a concentrated-liquidity position',
  change_position: 'Change a position (add, remove, collect, close)', place_order: 'Place a limit order in a book', settle_order: 'Settle an order (collect or cancel)',
  create_auction: 'Start a Dutch auction', bid: 'Bid in an auction', collect: 'Collect an auction\'s proceeds',
  register_oracle: 'Register an oracle (its key)', attest: 'An oracle\'s attestation of an event', publish_oracle: 'An oracle\'s attestation of an event',
  create_oracle_contract: 'Lock coins in an oracle contract', settle_oracle_contract: 'Settle an oracle contract', set_logo: 'Set an asset\'s logo',
  set_display_name: 'Set an asset\'s display name', register_with_logo: 'Register an asset with its logo',
};
/** the asset field an amount field counts in */
const AMOUNT_OF: Record<string, string> = {
  amount_in: 'asset_in', amount_out: 'asset_out', min_out: 'asset_out', amount_a: 'asset_a', amount_b: 'asset_b', amount: 'asset', supply: 'asset',
  first_buy: 'ECX', min_buy: 'ECX', max_buy: 'ECX', sell_amount: 'sell', buy_amount: 'buy', min_a: 'asset_a', min_b: 'asset_b',
};
const ASSET_KEYS = new Set(['asset', 'asset_in', 'asset_out', 'asset_a', 'asset_b', 'token', 'base', 'quote', 'sell', 'buy']);
const ADDRESS_KEYS = new Set(['creator', 'address', 'to', 'chn_to', 'ecx_to', 'refund', 'refund_address', 'payee', 'owner']);
const POOL_KEYS = new Set(['pool']);

/**
 * The transaction page's Flush panel (GET /api/v1/flush/tx/:txid): what its asset marker does (decodeassettx: assets
 * with their tickers and amounts, swaps and routes with their pools, liquidity, launches and claims, positions and
 * orders, auctions and bids, oracles, logos and display names) and what each output carries; its peg markers
 * (a withdrawal to eCash, a refund, a bundle's commitment) and stake markers (a bond, an unbond, evidence, the validator
 * pool).
 */
@Component({
  selector: 'app-flush-tx-panel',
  standalone: true,
  imports: [...FLUSH_PAGE_IMPORTS],
  styleUrls: ['../../../l2/full/l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.op-name { font-family: monospace; font-size: 0.8rem; color: var(--transparent-fg); } .err { color: #ff6b6b; }`],
  template: `
  @if (view$ | async; as v) {
    @if (v.data; as t) {
      @if (t.asset; as a) {
        <div class="title-row">
          <h2 class="p-title">{{ opTitle(a.operation) }}</h2>
          <span class="op-name">{{ a.operation?.name }} (kind {{ a.operation?.kind }})</span>
          @if (a.error) {<span class="pill warn" [title]="'The node refuses this marker: ' + a.error">{{ a.error }}</span>}
        </div>
        @if (fields(a.operation).length || a.outputs.length) {
        <div class="box p-box">
          @if (fields(a.operation); as fs) {
            @if (fs.length) {
              <table class="table table-borderless table-striped mb-0"><tbody>
                @for (f of fs; track f.key) {
                  <tr><td class="td-width">{{ f.label }}</td><td>
                    @switch (f.type) {
                      @case ('asset') {<app-flush-asset [id]="f.value" [showName]="true"></app-flush-asset>}
                      @case ('amount') {<app-flush-asset [id]="f.asset" [units]="f.value"></app-flush-asset>}
                      @case ('pool') {<a [routerLink]="['/pool', f.value]" class="mono">{{ f.value }}</a>}
                      @case ('pools') {@for (p of f.value; track $index) {<a [routerLink]="['/pool', p]" class="mono me-2">{{ fx.shortId(p, 8) }}</a>}}
                      @case ('path') {@for (p of f.value; track $index) {@if ($index) {<span class="muted"> → </span>}<app-flush-asset [id]="p"></app-flush-asset>}}
                      @case ('address') {<app-flush-addr [address]="f.value" [short]="false"></app-flush-addr>}
                      @case ('hex') {<span class="mono">{{ f.value }}</span>}
                      @default {<span>{{ f.value }}</span>}
                    }
                  </td></tr>
                }
              </tbody></table>
            }
          }
          @if (a.outputs.length) {
            <h5 class="p-h5">Outputs</h5>
            <app-chain-table [rows]="a.outputs" [columns]="outputCols" [filters]="outputFilters(a.outputs)" sort="n" [asc]="true" [pageSize]="25" [trackBy]="trackOutput">
              <ng-template cxCell="n" let-o>#{{ o.n }}</ng-template>
              <ng-template cxCell="carries" let-o><span class="pill" [class.on]="o.carries === 'asset'">{{ carries(o.carries) }}</span></ng-template>
              <ng-template cxCell="what" let-o>@if (o.id && o.carries !== 'reservation') {<app-flush-asset [id]="o.id" [units]="o.carries === 'asset' || o.carries === 'lp' ? o.amount : null"></app-flush-asset>} @else if (o.carries === 'result') {<span class="muted">what the order or operation pays out, at the end of its block</span>}</ng-template>
            </app-chain-table>
          }
        </div>
        }
        <br>
      }
      @if (t.peg?.length) {
        <div class="title-row"><h2 class="p-title">Peg</h2><span class="p-sub">between {{ profile.name }} and eCash</span></div>
        <div class="box p-box">
          @for (p of t.peg; track $index) {
            <section>
              @switch (p.kind) {
                @case ('withdrawal') {
                  <div><b>Withdrawal to eCash</b> of <app-amount [satoshis]="p.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount>
                    @if (!p.valid) {<span class="pill warn ms-1" title="Its fee is not below its value, or its destination is not standard">not valid</span>}</div>
                  <table class="table table-borderless table-sm p-table mb-0"><tbody>
                    <tr><td class="td-width">To (on eCash)</td><td>@if (p.mainAddress) {<app-flush-ecash kind="address" [id]="p.mainAddress" [mark]="false"></app-flush-ecash>} @else {<span class="mono">{{ p.mainScript }}</span>}</td></tr>
                    <tr><td>eCash fee</td><td><app-amount [satoshis]="p.mainFee" digitsInfo="1.2-8" [noFiat]="true"></app-amount> <span class="muted">(output #{{ p.vout }} holds {{ p.value | number }} sats)</span></td></tr>
                    <tr><td>Refund to</td><td>@if (p.refundAddress) {<app-flush-addr [address]="p.refundAddress" [short]="false"></app-flush-addr>} @else {<span class="mono">{{ p.refundKeyHash }}</span>}</td></tr>
                  </tbody></table>
                  <div class="muted small mt-1">It waits in the next withdrawal bundle: <a routerLink="/peg">the peg</a>.</div>
                }
                @case ('refund') {<div><b>Refund</b> of the withdrawal <a [routerLink]="['/tx', p.withdrawal.txid]" class="mono">{{ fx.shortId(p.withdrawal.txid) }}:{{ p.withdrawal.vout }}</a>, taken back before it was bundled</div>}
                @case ('bundle') {<div><b>Withdrawal bundle</b> committed by this coinbase: <span class="mono">{{ p.hash }}</span> · <a routerLink="/peg">its votes on eCash</a></div>}
                @default {<div><b>{{ p.kind }}</b></div>}
              }
            </section>
          }
        </div>
        <br>
      }
      @if (t.stake?.length) {
        <div class="title-row"><h2 class="p-title">Stake</h2><span class="p-sub">validators' bonds and the chain's security</span></div>
        <div class="box p-box">
          @for (s of t.stake; track $index) {
            <section>
              @switch (s.kind) {
                @case ('bond') {
                  <div><b>Bond</b> of <app-amount [satoshis]="s.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount> to validator <a [routerLink]="['/validator', s.pubkey]" class="mono">{{ fx.shortId(s.pubkey, 10) }}</a>
                    @if (s.signed) {<span class="pill ms-1" title="With its key's proof of possession (a first bond)">with proof</span>}</div>
                  <div class="muted small">owner (may unbond, is paid what is unbonded): @if (s.ownerAddress) {<app-flush-addr [address]="s.ownerAddress"></app-flush-addr>} @else {<span class="mono">{{ s.owner }}</span>}</div>
                }
                @case ('unbond') {<div><b>Unbond</b> @if (s.all) {all that is bonded} @else {<app-amount [satoshis]="s.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount>} from validator <a [routerLink]="['/validator', s.pubkey]" class="mono">{{ fx.shortId(s.pubkey, 10) }}</a> <span class="muted">(sequence {{ s.sequence }}; paid after the unbonding anchors)</span></div>}
                @case ('evidence') {<div><b>Evidence</b>: a leader signed two blocks for one slot:
                  @for (h of s.headers; track h.hash) {<a [routerLink]="['/block', h.hash]" class="mono ms-2">{{ fx.shortId(h.hash) }}</a>}
                  <div class="muted small">The validator is banned for good once this is in a block.</div></div>}
                @case ('validatorPool') {<div><b>Validator pool</b>: <app-amount [satoshis]="s.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount> of this block's fees into the epoch's pool, shared by stake</div>}
                @case ('validatorShares') {<div><b>Validators' shares</b>: {{ s.count }} shares of the pool paid by this peg step</div>}
                @default {<div><b>{{ s.kind }}</b></div>}
              }
            </section>
          }
        </div>
        <br>
      }
    }
  }`,
})
export class FlushTxPanelComponent implements OnChanges {
  @Input() txid: string;
  profile = PROFILE;
  fx = F;
  view$: Observable<FlushLoaded<FlushTxInfo>>;
  outputCols: CxColumn<TxOutput>[] = [
    { key: 'n', label: 'Output', sort: o => o.n },
    { key: 'carries', label: 'Carries', sort: o => o.carries },
    { key: 'what', label: 'What' },
  ];
  trackOutput = (o: TxOutput) => o.n;
  private filtersFor: { outputs: TxOutput[]; filters: CxFilter<TxOutput>[] } | null = null;

  constructor(private api: FlushApiService) {}

  ngOnChanges(): void {
    if (this.txid) {
      this.view$ = flushLoaded(this.api.tx$<FlushTxInfo>(this.txid));
    }
  }

  opTitle(op: Record<string, any> | null): string {
    const n = String(op?.name ?? '');
    return OPS[n] ?? (n && n !== 'operation' ? n.replace(/_/g, ' ') : 'Asset operation');
  }

  /** chips of what the outputs carry (kept per list of outputs, so the table keeps its choice) */
  outputFilters(outputs: TxOutput[]): CxFilter<TxOutput>[] {
    if (this.filtersFor?.outputs !== outputs) {
      const kinds = [...new Set(outputs.map(o => o.carries))];
      this.filtersFor = { outputs, filters: kinds.length > 1 ? [{ label: 'Carries', options: kinds.map(k => ({ label: this.carries(k), test: (o: TxOutput) => o.carries === k })) }] : [] };
    }
    return this.filtersFor.filters;
  }

  carries(c: string): string {
    return ({ result: 'result', asset: 'asset', control: 'control coin', reservation: 'ticker reservation', lp: 'liquidity shares', receipt: 'receipt',
      position: 'position', order: 'order' } as Record<string, string>)[c] ?? c;
  }

  fields(op: Record<string, any> | null): OpField[] {
    if (!op) {
      return [];
    }
    const out: OpField[] = [];
    for (const [k, v] of Object.entries(op)) {
      if (k === 'kind' || k === 'name' || v === null || v === undefined) {
        continue;
      }
      const label = k.replace(/_/g, ' ');
      if (ASSET_KEYS.has(k) && typeof v === 'string' && F.isId(v)) {
        out.push({ key: k, label, type: 'asset', value: v });
      } else if (k in AMOUNT_OF && (typeof v === 'number' || /^\d+$/.test(String(v)))) {
        const ref = AMOUNT_OF[k];
        const asset = ref === 'ECX' ? ECX : (typeof op[ref] === 'string' && F.isId(op[ref]) ? op[ref] : (k === 'min_out' && Array.isArray(op['path']) ? op['path'][op['path'].length - 1] : null));
        out.push(asset ? { key: k, label, type: 'amount', value: v, asset } : { key: k, label: label + ' (units)', type: 'text', value: String(v) });
      } else if (POOL_KEYS.has(k) && typeof v === 'string' && F.isId(v)) {
        out.push({ key: k, label, type: 'pool', value: v });
      } else if (k === 'pools' && Array.isArray(v)) {
        out.push({ key: k, label, type: 'pools', value: v.filter(x => F.isId(String(x))) });
      } else if (k === 'path' && Array.isArray(v)) {
        out.push({ key: k, label, type: 'path', value: v.map(String) });
      } else if (ADDRESS_KEYS.has(k) && typeof v === 'string') {
        out.push({ key: k, label, type: 'address', value: v });
      } else if (typeof v === 'string' && /^[0-9a-f]{40,}$/i.test(v)) {
        out.push({ key: k, label, type: 'hex', value: v });
      } else if (typeof v === 'object') {
        out.push({ key: k, label, type: 'text', value: JSON.stringify(v) });
      } else {
        out.push({ key: k, label, type: 'text', value: typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v) });
      }
    }
    return out;
  }
}
