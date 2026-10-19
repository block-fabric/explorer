import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription, catchError, of } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { ChainTxInfo } from '@app/chain/chain.interfaces';
import { describeActivity } from '@app/chain/modules/bitassets/activity-text';
import { MODULE, PROFILE, explorerUrl, profileBySlot, sideBlockPath } from '@app/chain/profiles';

/**
 * The transaction page's drivechain box.
 *   Chains: what the transaction did for a sidechain: a deposit (M5), a withdrawal (M6) or a BMM bid (M8), from the
 *   drivechain index.
 *   A sidechain: what its module decoded (describeTx: a name registered, a swap, a vote, a bond...), as a list of the
 *   decoded fields.
 */
@Component({
  selector: 'app-chain-tx-panel',
  template: `
    <ng-container *ngIf="info || ops?.length || tokenOps?.length">
      <div class="box ct-box" [style.--sc]="color">
        <!-- Chains -->
        <ng-container *ngIf="info as i">
          <div *ngIf="i.deposit as d" class="ct-row">
            <span class="ct-tag">M5</span>
            <span class="ct-main">Deposit of <b><app-amount [satoshis]="d.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount></b> into
              <app-sidechain-chip [slot]="d.slot" [name]="d.name" path=""></app-sidechain-chip></span>
            <span class="ct-sub">credited on the sidechain to
              <a *ngIf="sideUrl(d.slot, '/address/' + destAddress(d.destination)) as u; else plainDest" [href]="u" class="mono">{{ destAddress(d.destination) }}</a>
              <ng-template #plainDest><span class="mono">{{ destAddress(d.destination) }}</span></ng-template>
              · in block {{ i.height | number }}</span>
          </div>
          <div *ngIf="i.withdrawal as w" class="ct-row">
            <span class="ct-tag">M6</span>
            <span class="ct-main">Withdrawal of <b><app-amount [satoshis]="w.amount" digitsInfo="1.2-8" [noFiat]="true"></app-amount></b> from
              <app-sidechain-chip [slot]="w.slot" [name]="w.name" path=""></app-sidechain-chip></span>
            <span class="ct-sub">{{ w.payouts.length }} payout{{ w.payouts.length === 1 ? '' : 's' }} · bundle <span class="mono">{{ w.bundle.slice(0, 16) }}…</span> paid in block {{ i.height | number }} after the miners' vote</span>
          </div>
          <div *ngIf="i.bmmRequest as r" class="ct-row">
            <span class="ct-tag">M8</span>
            <span class="ct-main">BMM bid of <b>{{ r.bid | number }} sats</b> for a
              <app-sidechain-chip [slot]="r.slot" [name]="r.name" path=""></app-sidechain-chip> block</span>
            <span class="ct-sub">
              <a *ngIf="sideUrl(r.slot, sideBlockPath(r.slot, r.sideBlock)) as u; else plainSb" [href]="u" class="mono">{{ r.sideBlock.slice(0, 16) }}…</a>
              <ng-template #plainSb><span class="mono">{{ r.sideBlock.slice(0, 16) }}…</span></ng-template>
              · <span [class.pos]="r.accepted" [class.neg]="!r.accepted">{{ r.accepted ? 'accepted (M7) by the miner of block ' + (i.height | number) : 'not accepted: the miner of block ' + (i.height | number) + ' took the fee and committed to another block' }}</span>
            </span>
          </div>
        </ng-container>

        <!-- chains with a token ledger: what the transaction did, in words, with the real amounts -->
        <div class="ct-row" *ngFor="let e of tokenOps">
          <span class="ct-tag">{{ profile.name }}</span>
          <span class="ct-main"><b>{{ title(e.kind) }}</b> · <span [innerHTML]="describe(e)"></span></span>
          <span class="ct-sub">
            <a *ngIf="e.pool" [routerLink]="['/pool' | relativeUrl, e.pool]">pool {{ e.labels?.a || e.labels?.in }}/{{ e.labels?.b || e.labels?.out }}</a>
            <a *ngIf="e.auction" [routerLink]="['/auction' | relativeUrl, e.auction]">the auction</a>
            <ng-container *ngFor="let kv of assetLinks(e)"> · <a [routerLink]="['/asset' | relativeUrl, kv[1]]">{{ kv[0] }}</a></ng-container>
          </span>
        </div>

        <!-- a sidechain: the module's decoding (operations the token ledger does not already describe) -->
        <ng-container *ngIf="ops?.length">
          <div class="ct-row" *ngFor="let op of shownOps()">
            <span class="ct-tag">{{ profile.name }}</span>
            <span class="ct-main"><b>{{ title(op.kind) }}</b> <span *ngIf="op.error" class="neg"> (could not decode: {{ op.error }})</span></span>
            <div class="ct-fields">
              <ng-container *ngFor="let f of fields(op)">
                <span class="k">{{ f.k }}</span><span class="v" [class.mono]="f.mono" [title]="f.v">{{ f.v }}</span>
              </ng-container>
            </div>
          </div>
        </ng-container>
      </div>
      <br>
    </ng-container>
  `,
  styles: [`
    .ct-box { padding: 12px 16px; border-left: 3px solid var(--sc); }
    .ct-row + .ct-row { margin-top: 10px; padding-top: 10px; border-top: 1px solid #ffffff12; }
    .ct-tag { display: inline-block; font-size: 0.72rem; font-weight: 700; padding: 0 6px; border-radius: 4px; margin-right: 8px;
      color: var(--sc); border: 1px solid color-mix(in srgb, var(--sc) 55%, transparent); vertical-align: middle; }
    .ct-main { font-size: 1rem; }
    .ct-sub { display: block; font-size: 0.8rem; color: var(--transparent-fg); margin-top: 3px; }
    .ct-fields { display: grid; grid-template-columns: max-content 1fr; gap: 2px 14px; font-size: 0.82rem; margin-top: 6px; }
    .k { color: var(--transparent-fg); }
    .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: monospace; }
    .pos { color: #3bd16f; } .neg { color: #ff6b6b; }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainTxPanelComponent implements OnChanges, OnDestroy {
  sideBlockPath = sideBlockPath;
  @Input() txid: string;

  profile = PROFILE;
  info: ChainTxInfo | null = null;
  ops: any[] | null = null;
  tokenOps: any[] | null = null;
  describe = describeActivity;
  color = PROFILE.color;
  private sub: Subscription;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    this.info = null;
    this.ops = null;
    if (!this.txid) { return; }
    if (PROFILE.mainchain) {
      this.sub = this.api.tx$(this.txid).subscribe((i) => {
        this.info = i && (i.deposit || i.withdrawal || i.bmmRequest) ? i : null;
        const slot = i?.deposit?.slot ?? i?.withdrawal?.slot ?? i?.bmmRequest?.slot;
        this.color = slot !== undefined ? (profileBySlot(slot)?.color ?? PROFILE.color) : PROFILE.color;
        this.cd.markForCheck();
      });
    } else {
      this.sub = this.api.feature$<any>('tx/' + this.txid).pipe(catchError(() => of(null))).subscribe((d) => {
        this.ops = d?.ops ?? null;
        this.cd.markForCheck();
      });
      this.tokenOps = null;
      if (MODULE.tokens) {
        this.tokenSub?.unsubscribe();
        this.tokenSub = this.api.feature$<any[]>('tx-ops/' + this.txid).pipe(catchError(() => of([]))).subscribe((t) => {
          this.tokenOps = t?.length ? t : null;
          this.cd.markForCheck();
        });
      }
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.tokenSub?.unsubscribe();
  }

  private tokenSub: Subscription;
  private static TOKEN_KINDS = new Set(['transfer', 'reserve', 'register', 'mint', 'update', 'burn', 'swap', 'add-liquidity', 'remove-liquidity',
    'create-auction', 'bid', 'collect', 'release', 'route', 'register-oracle', 'attest', 'create-oracle-contract', 'settle-oracle-contract']);

  /** the decoded operations, without the token ones the ledger already put in words */
  shownOps(): any[] {
    return this.tokenOps?.length ? (this.ops ?? []).filter(o => !ChainTxPanelComponent.TOKEN_KINDS.has(o.kind)) : (this.ops ?? []);
  }

  /** the assets an operation concerns, CHN left out: [label, id] */
  assetLinks(e: any): [string, string][] {
    const seen = new Set<string>();
    const out: [string, string][] = [];
    for (const [role, id] of Object.entries(e.ids ?? {}) as [string, string][]) {
      if (/^0+$/.test(id) || seen.has(id)) { continue; }
      seen.add(id);
      out.push([e.labels?.[role] ?? id.slice(0, 8), id]);
    }
    return out;
  }

  sideUrl(slot: number, path: string): string | null {
    const p = profileBySlot(slot);
    return p ? explorerUrl(p.id, path) : null;
  }

  /** s<slot>_<address>_<checksum> -> address */
  destAddress(dest: string): string {
    const m = /^s\d+_(.+)_[0-9a-f]{6}$/.exec(dest || '');
    return m ? m[1] : dest;
  }

  title(kind: string): string {
    return (kind || '').replace(/-/g, ' ').replace(/^./, c => c.toUpperCase());
  }

  /** the decoded fields of an operation, flattened for display */
  fields(op: any): { k: string; v: string; mono: boolean }[] {
    const out: { k: string; v: string; mono: boolean }[] = [];
    const walk = (prefix: string, v: any) => {
      if (v === null || v === undefined || ['kind', 'error'].includes(prefix)) { return; }
      if (typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, x] of Object.entries(v)) { walk(prefix ? `${prefix}.${k}` : k, x); }
        return;
      }
      const s = Array.isArray(v) ? (v.length ? v.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(', ') : '') : String(v);
      if (s === '') { return; }
      out.push({ k: prefix.replace(/([A-Z])/g, ' $1').toLowerCase(), v: s, mono: /^[0-9a-f]{20,}$/.test(s) });
    };
    walk('', op);
    return out.slice(0, 24);
  }
}
