import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { Observable } from 'rxjs';
import { PROFILE } from '@app/chain/profiles';
import { FreebankApiService, FbLoaded, fbLoaded } from '../freebank-api.service';
import { FB_PAGE_IMPORTS } from '../freebank-kit';
import { FreebankTxInfo } from '../freebank.interfaces';

/** each credit family (by transaction version, freebank primitives/transaction.h) in a few words */
const FAMILIES: Record<string, { title: string; sub: string; page: string | null }> = {
  bill: { title: 'Bill of exchange', sub: 'issue, endorse, discount, retire, claim or recourse of a bill (version 11)', page: '/bills' },
  house: { title: 'Discount house', sub: 'a house\'s registration, pledges, attestations, mint and redemption (version 12)', page: '/houses' },
  note: { title: 'House notes', sub: 'notes of a house: transfers, demands, token mints and burns (version 13)', page: '/houses' },
  deposit: { title: 'Term deposit', sub: 'a deposit at a house, or its repayment (version 14)', page: '/houses' },
  pool: { title: 'Note pool', sub: 'a note/ECX pool: liquidity and swaps (version 15)', page: '/pools' },
  settle: { title: 'Settlement', sub: 'a netting round between houses (version 16)', page: '/houses' },
  oracle: { title: 'Gold oracle', sub: 'a gold-price submission, or an oracle\'s bond (version 17)', page: '/gold' },
};
/** the peg and protocol outputs a transaction may carry (chains/FREEBANK-API.md), in a few words */
const PEG_KINDS: Record<string, string> = {
  'deposit': 'Deposit from eCash', 'stray': 'Deposit record outside a coinbase', 'withdrawal': 'Withdrawal to eCash',
  'bundle': 'Withdrawal bundle', 'refund-request': 'Withdrawal refund request', 'bundle-hash': 'Bundle commitment',
  'bundle-paid': 'Bundle paid on eCash', 'bundle-failed': 'Bundle failed on eCash', 'prev-blocks': 'Previous blocks',
  'block-version': 'Block version', 'witness-commitment': 'Witness commitment', 'unreadable': 'Unreadable output',
};
/** the keys of a credit object that name the operation rather than carry its fields */
const META = new Set(['fields', 'op', 'op_name', 'opName', 'name', 'family', 'kind', 'error']);

/**
 * The transaction page's FreeBank panel (GET /api/v1/freebank/tx/:txid): the credit family of the transaction (by its
 * version: a bill, a house, notes, a deposit, a pool, a settlement, the oracle) or an asset genesis, and its decoded
 * operation as a table of its fields (credit.fields, linked where they name a house, a bill, a block, a transaction).
 */
@Component({
  selector: 'app-freebank-tx-panel',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS],
  styleUrls: ['../../../l2/full/l2-panel.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`.op-name { font-family: monospace; font-size: 0.8rem; color: var(--transparent-fg); } .fam { font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }`],
  template: `
  @if (view$ | async; as v) {
    @if (v.data; as t) {
      @if (t.family || t.assetGenesis || t.peg?.length || t.error) {
        <div class="title-row">
          <h2 class="p-title">{{ t.assetGenesis ? 'Asset genesis' : t.family ? fam(t.family).title : 'Peg and protocol outputs' }}</h2>
          @if (t.family || t.assetGenesis) {<span class="pill accent fam">{{ t.assetGenesis ? 'asset' : t.family }}</span>}
          @if (opName(t); as o) {<span class="op-name">{{ o }}</span>}
          <span class="p-sub">{{ t.assetGenesis ? 'the creation of an asset on ' + profile.name + ' (version 10)' : t.family ? fam(t.family).sub : 'deposits from eCash, withdrawals to it and the block\'s own commitments' }}</span>
          @if (!t.confirmed) {<span class="pill">unconfirmed</span>}
        </div>
        <div class="box p-box">
          @if (t.asset; as a) {
            <app-fb-fields [data]="a"></app-fb-fields>
          } @else if (t.family) {
          @if (fields(t); as fs) {
            @if (hasKeys(fs)) {
              <app-fb-fields [data]="fs"></app-fb-fields>
            } @else {
              <p class="muted mb-0">The operation's fields are not decoded here yet.
                @if (fam(t.family).page; as pg) {See <a [routerLink]="[pg]">{{ pg.slice(1) }}</a>.}</p>
            }
          }
          }
          @if (t.peg?.length) {
            <h3 class="mt-2">{{ t.family || t.assetGenesis ? 'Peg and protocol outputs' : '' }}</h3>
            @for (p of t.peg; track $index) {
              <div class="mb-2"><span class="pill">{{ pegTitle(p.kind) }}</span> <span class="muted">output {{ p.vout }}</span>
                @if (hasKeys(pegFields(p))) {<app-fb-fields [data]="pegFields(p)"></app-fb-fields>}</div>
            }
          }
          @if (t.error) {<p class="neg mb-0 mt-2">{{ t.error }}</p>}
        </div>
        <br>
      }
    }
  }`,
})
export class FreebankTxPanelComponent implements OnChanges {
  @Input() txid: string;
  profile = PROFILE;
  view$: Observable<FbLoaded<FreebankTxInfo>>;

  constructor(private api: FreebankApiService) {}

  ngOnChanges(): void {
    if (this.txid) {
      this.view$ = fbLoaded(this.api.tx$<FreebankTxInfo>(this.txid));
    }
  }

  fam(f: string | null): { title: string; sub: string; page: string | null } {
    return FAMILIES[String(f)] ?? { title: 'Credit operation', sub: '', page: null };
  }

  opName(t: FreebankTxInfo): string | null {
    const c = t.credit as any;
    const n = c?.op_name ?? c?.opName ?? c?.name ?? null;
    const op = c?.op;
    return n ? String(n).replace(/_/g, ' ') + (op !== undefined && op !== null ? ` (op ${op})` : '') : (op !== undefined && op !== null ? `op ${op}` : null);
  }

  /** the operation's fields: credit.fields, else credit's own scalar keys */
  fields(t: FreebankTxInfo): Record<string, unknown> {
    const c = t.credit;
    if (!c) {
      return {};
    }
    if (c.fields && typeof c.fields === 'object') {
      return c.fields;
    }
    return Object.fromEntries(Object.entries(c).filter(([k]) => !META.has(k)));
  }

  pegTitle(kind: string): string {
    return PEG_KINDS[kind] ?? kind;
  }

  /** a peg output's fields, without its kind and output index (shown in its title) */
  pegFields(p: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'kind' && k !== 'vout'));
  }

  hasKeys(o: Record<string, unknown>): boolean {
    return Object.keys(o).length > 0;
  }
}
