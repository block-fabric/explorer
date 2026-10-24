import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SharedModule } from '@app/shared/shared.module';
import { SeoService } from '@app/services/seo.service';
import { PROFILE } from '@app/chain/profiles';
import { ChainApiService } from '@app/chain/chain-api.service';
import { CREDIT_TABS, FB_PAGE_IMPORTS } from '../freebank-kit';
import * as F from '../freebank-format';

const STYLES = ['../../../components/module-page.scss', '../../../l2/pages/l2-page.scss', '../freebank-page.scss'];

/** GET /api/v1/freebank/activity's items (backend chain/modules/freebank/activity.ts) */
export type ActivityFamily = 'bill' | 'house' | 'note' | 'deposit' | 'pool' | 'settle' | 'oracle' | 'asset';
export interface ActivityItem {
  txid: string;
  height: number;
  time: number;
  index: number;
  family: ActivityFamily;
  op: number | null;
  opName: string;
  fields: Record<string, any>;
  error: string | null;
}
interface ActivityPage {
  items: ActivityItem[];
  next: string | null;
  index: { low: number | null; high: number | null; tip: number; complete: boolean };
}

export const FAMILY_LABEL: Record<ActivityFamily, string> = {
  house: 'House', note: 'Note', bill: 'Bill', deposit: 'Term deposit', pool: 'Pool', settle: 'Settlement', oracle: 'Oracle', asset: 'Asset',
};
const FAMILIES: ActivityFamily[] = ['house', 'note', 'bill', 'deposit', 'pool', 'settle', 'oracle', 'asset'];

/** A sentence in parts: words, and the houses, bills and pools it names as links */
type Part = { t: string; link?: (string | number)[] };

const ecx = (s: unknown): string => `${F.sats(s as number)} ECX`;
const units = (n: unknown): string => `${F.num(n as number)} note units`;
const house = (id: unknown): Part => ({ t: `house ${id}`, link: ['/house', id as number] });
const bill = (id: unknown): Part => ({ t: `bill ${id}`, link: ['/bill', id as number] });
const pool = (id: unknown): Part => ({ t: `pool ${id}`, link: ['/pool', id as number] });
const w = (t: string): Part => ({ t });

/** What a credit operation did, in words (fields: chains/FREEBANK-API.md, per family and op) */
export function describe(it: ActivityItem): { title: string; parts: Part[] } {
  const f = it.fields ?? {};
  const H = house(f.house_id);
  switch (`${it.family}:${it.opName}`) {
    case 'house:register': case 'house:register_mo':
      return { title: 'House registered', parts: [w(`${f.classid ?? ''} · ${f.house_type ? F.houseType(f.house_type) + ' · ' : ''}tier ${f.tier}, ${f.threshold} of ${f.partners} partners sign, pledge ${ecx(f.pledge_sats)}`)] };
    case 'house:attest':
      return { title: 'Reserve attestation', parts: [H, w(` attested reserves of ${ecx(f.reserves_sats)} (as of block ${F.num(f.as_of_height)})`)] };
    case 'house:topup': return { title: 'Escrow top-up', parts: [H, w(`: partner ${f.partner_index} added to its pledge`)] };
    case 'house:exit': return { title: 'Partner exit', parts: [H, w(`: partner ${f.partner_index} leaves`)] };
    case 'house:reclaim': return { title: 'Pledge reclaimed', parts: [H, w(`: partner ${f.partner_index} took its pledge back`)] };
    case 'house:admit': return { title: 'House admitted', parts: [H] };
    case 'house:winddown': return { title: 'Wind-down', parts: [H, w(' winds down')] };
    case 'house:defer': return { title: 'Option clause', parts: [H, w(' suspended its redemptions')] };
    case 'house:renew': return { title: 'House renewed', parts: [H] };
    case 'house:release': return { title: 'Escrow released', parts: [H] };
    case 'house:close': return { title: 'House closed', parts: [H] };
    case 'house:member_add': return { title: 'Members added', parts: [H, w(`: ${F.num(f.members)} members added`)] };
    case 'house:member_remove': return { title: 'Members removed', parts: [H, w(`: ${F.num(f.members)} members removed`)] };
    case 'house:member_purge': return { title: 'Members purged', parts: [H, w(`: ${F.num(f.members)} members purged`)] };
    case 'note:mint': return { title: 'Notes minted', parts: [H, w(` minted ${units(f.units)}`)] };
    case 'note:transfer': return { title: 'Note transfer', parts: [w(`${units(f.units)} of `), H, w(` to ${F.num(f.outputs)} outputs`)] };
    case 'note:lock': return { title: 'Notes locked', parts: [w(`${units(f.units)} of `), H, w(' locked')] };
    case 'note:unlock': return { title: 'Notes unlocked', parts: [w(`${units(f.units)} of `), H, w(' unlocked')] };
    case 'note:demand': return { title: 'Notes demanded', parts: [w(`${units(f.units)} presented for payment at `), H] };
    case 'note:protest': return { title: 'Note protest', parts: [w(`${units(f.units)} of `), H, w(' protested: not paid')] };
    case 'note:redeem': return { title: 'Notes redeemed', parts: [w('Notes redeemed at '), H] };
    case 'note:claim': return { title: 'Note claim', parts: [w('A note holder claims on '), H] };
    case 'note:token_keyset': return { title: 'Token keyset', parts: [H, w(` posted a keyset of ${F.num(f.keys)} keys`)] };
    case 'note:token_post': return { title: 'Tokens posted', parts: [H, w(` posted ${F.num(f.issued)} tokens (${units(f.issued_units)})`)] };
    case 'note:token_claim': return { title: 'Token claim', parts: [w(`${F.num(f.tokens)} tokens (${units(f.claimed_units)}) claimed on `), H] };
    case 'note:token_collect': return { title: 'Token claims collected', parts: [H, w(` paid ${F.num(f.claims)} claims`)] };
    case 'bill:issue': return { title: 'Bill issued', parts: [w(`Face ${ecx(f.face_sats)}, matures at block ${F.num(f.maturity_height)} with ${F.num(f.grace_blocks)} blocks of grace`)] };
    case 'bill:endorse': return { title: 'Bill endorsed', parts: [bill(f.bill_id), w(` endorsed to ${F.shortId(f.to_pubkey, 6)}`)] };
    case 'bill:retire': return { title: 'Bill paid', parts: [bill(f.bill_id), w(' paid by its acceptor')] };
    case 'bill:claim': return { title: 'Escrow claimed', parts: [w('The holder of '), bill(f.bill_id), w(' claimed its escrow')] };
    case 'bill:recourse': return { title: 'Recourse', parts: [w('Recourse on '), bill(f.bill_id)] };
    case 'bill:discount': return { title: 'Bill discounted', parts: [H, w(' discounted '), bill(f.bill_id), w(` (face ${ecx(f.face_sats)}) for ${units(f.price_units)}`)] };
    case 'bill:hretire': case 'bill:hretire_notes': case 'bill:hretire_escrow':
      return { title: 'Bill paid to a house', parts: [bill(f.bill_id), w(` (face ${ecx(f.face_sats)}) paid to `), H, ...(f.units_burned ? [w(`, ${units(f.units_burned)} retired`)] : [])] };
    case 'bill:hclaim': case 'bill:hclaim_escrow':
      return { title: 'House claimed an escrow', parts: [H, w(' claimed the escrow of '), bill(f.bill_id), w(` (face ${ecx(f.face_sats)})`)] };
    case 'deposit:originate': return { title: 'Term deposit', parts: [w(`${units(f.principal_units)} deposited at `), H] };
    case 'deposit:transfer': return { title: 'Deposit transferred', parts: [w(`${units(f.principal_units)} at `), H, w(`, ${F.bps(f.rate_bps)}, matures at block ${F.num(f.maturity_height)}`)] };
    case 'deposit:demand': return { title: 'Deposit demanded', parts: [w(`${units(f.principal_units)} at `), H, w(' presented for payment')] };
    case 'deposit:protest': return { title: 'Deposit protest', parts: [w(`${units(f.principal_units)} at `), H, w(' protested: not paid')] };
    case 'deposit:discharge': return { title: 'Deposit paid', parts: [w('A matured deposit paid out by '), H] };
    case 'deposit:withdraw': return { title: 'Deposit withdrawn', parts: [w('A deposit withdrawn from '), H] };
    case 'deposit:claim': return { title: 'Deposit claimed', parts: [w('A deposit claimed on '), H] };
    case 'pool:create': return { title: 'Pool created', parts: [pool(f.pool_id), w(` of `), H, w(`: ${units(f.note_units)} and ${ecx(f.ecx_sats)}, fee ${F.bps(f.fee_bps)}`)] };
    case 'pool:add_liq': return { title: 'Liquidity added', parts: [pool(f.pool_id), w(`: ${units(f.note_units)} and ${ecx(f.ecx_sats)}`)] };
    case 'pool:remove_liq': return { title: 'Liquidity removed', parts: [pool(f.pool_id), w(`: ${units(f.note_units_out)} and ${ecx(f.ecx_sats_out)} out`)] };
    case 'pool:swap': return { title: 'Swap', parts: [pool(f.pool_id), w(f.direction === 'notes_for_ecx'
      ? `: ${units(f.amount_in)} for ${ecx(f.amount_out)}` : `: ${ecx(f.amount_in)} for ${units(f.amount_out)}`)] };
    case 'pool:retire': return { title: 'Pool retired', parts: [pool(f.pool_id)] };
    case 'settle:exchange': return { title: 'Note exchange', parts: [house(f.house_a_id), w(' and '), house(f.house_b_id),
      w(` exchanged notes (${F.num(f.house_a_notes_units)} and ${F.num(f.house_b_notes_units)} units)${f.residual_sats ? `, ${ecx(f.residual_sats)} to settle` : ''}`)] };
    case 'settle:net': return { title: 'Netting round', parts: [w(`${F.num(f.houses)} houses, ${units(f.total_retired_units)} retired, ${ecx(f.paid_sats)} paid`)] };
    case 'oracle:bond': return { title: 'Oracle bonded', parts: [w(`Submitter ${f.submitter_id} bonded for block ${F.num(f.target_height)}`)] };
    case 'oracle:submit': return { title: 'Gold price', parts: [w(`Submitter ${f.submitter_id}: ${F.num(f.price_mg)} mg of gold per 1,000 ECX for block ${F.num(f.target_height)}`)] };
    case 'asset:genesis': return { title: 'Asset created', parts: [w(`${f.ticker || 'An asset'}${f.headline ? ': ' + f.headline : ''}`)] };
  }
  const title = F.label(it.opName);
  return { title: `${FAMILY_LABEL[it.family] ?? it.family} ${title.toLowerCase()}`, parts: f.house_id !== undefined ? [H] : f.bill_id !== undefined ? [bill(f.bill_id)] : [] };
}

/**
 * FreeBank's credit history, newest first (GET /api/v1/freebank/activity): every credit operation and asset genesis, by
 * family, or those of one house or one bill; more on demand
 */
@Component({
  selector: 'app-fb-activity',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .what { min-width: 280px; }
    .what .t { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 500; }
    .what .t .pill { font-weight: 400; min-width: 4.6rem; justify-content: center; }
    .what .s { font-size: 0.82rem; color: var(--cx-ink-2); margin-top: 3px; line-height: 1.45; overflow-wrap: anywhere; }
    .when { font-size: 0.78rem; color: var(--cx-ink-3); }
    .err { color: #ff6b6b; }`],
  template: `
    @if (chips) {
      <div class="filters">
        <div class="chips">
          <button class="chip" [class.on]="!family" (click)="setFamily(null)">All</button>
          @for (fm of families; track fm) {<button class="chip" [class.on]="fm === family" (click)="setFamily(fm)">{{ label[fm] }}</button>}
        </div>
      </div>
    }
    <div class="box">
      @if (failed) {
        <div class="unavail">The credit history is not available right now.</div>
      } @else if (!items) {
        <div class="skeleton-loader" [style.height.px]="160"></div>
      } @else {
        <table class="table table-borderless table-sm">
          <thead><tr><th>What happened</th><th class="r">Block</th><th class="d-none d-sm-table-cell">Transaction</th></tr></thead>
          <tbody>
            @for (it of items; track it.txid) {
              @let d = describe(it);
              <tr>
                <td class="what">
                  <div class="t"><span class="pill on">{{ label[it.family] ?? it.family }}</span><a [routerLink]="['/tx', it.txid]">{{ d.title }}</a></div>
                  <div class="s">@for (p of d.parts; track $index) {@if (p.link) {<a [routerLink]="p.link">{{ p.t }}</a>} @else {<span>{{ p.t }}</span>}}
                    @if (it.error) {<span class="err ms-1">· {{ it.error }}</span>}</div>
                </td>
                <td class="r nowrap"><a [routerLink]="['/block', it.height]">{{ it.height | number }}</a>
                  <div class="when"><app-time kind="since" [time]="it.time" [fastRender]="true"></app-time></div></td>
                <td class="d-none d-sm-table-cell"><a [routerLink]="['/tx', it.txid]" class="mono">{{ fx.shortId(it.txid, 8) }}</a></td>
              </tr>
            } @empty {<tr><td colspan="3" class="empty">{{ empty }}</td></tr>}
          </tbody>
        </table>
        @if (items.length || (status && !status.complete)) {
          <div class="pager">
            @if (status && !status.complete) {
              <span class="me-auto">Still reading the chain's history: blocks {{ status.low | number }} to {{ status.high | number }} so far, older activity to come.</span>
            }
            @if (items.length) {<span>{{ items.length | number }} {{ items.length === 1 ? 'operation' : 'operations' }}, newest first</span>}
            @if (next) {<button class="btn btn-sm" [disabled]="loading" (click)="more()">{{ loading ? 'Loading…' : 'Older →' }}</button>}
          </div>
        }
      }
    </div>`,
})
export class FbActivityComponent implements OnChanges {
  /** the family chips (the whole history); off for one house's or one bill's */
  @Input() chips = false;
  @Input() house: number | null = null;
  @Input() bill: number | null = null;
  @Input() limit = 50;
  @Input() empty = 'No credit activity yet.';
  label = FAMILY_LABEL;
  families = FAMILIES;
  describe = describe;
  fx = F;
  family: ActivityFamily | null = null;
  items: ActivityItem[] | null = null;
  next: string | null = null;
  status: ActivityPage['index'] | null = null;
  loading = false;
  failed = false;
  private seq = 0;

  constructor(private api: ChainApiService, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.load(false);
  }

  setFamily(f: ActivityFamily | null): void {
    this.family = f;
    this.load(false);
  }

  more(): void {
    this.load(true);
  }

  private load(append: boolean): void {
    const seq = ++this.seq;
    if (!append) {
      this.items = null;
      this.next = null;
    }
    this.loading = true;
    this.failed = false;
    this.api.get<ActivityPage>('freebank/activity', {
      family: this.family, house: this.house, bill: this.bill, limit: this.limit, before: append ? this.next : null,
    }).subscribe({
      next: page => {
        if (seq !== this.seq) {
          return;
        }
        this.items = append ? [...(this.items ?? []), ...page.items] : page.items;
        this.next = page.next;
        this.status = page.index;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: () => {
        if (seq !== this.seq) {
          return;
        }
        this.failed = !append;
        this.loading = false;
        this.cd.markForCheck();
      },
    });
  }
}

/** /activity: FreeBank's credit history, by family */
@Component({
  selector: 'app-freebank-activity-page',
  standalone: true,
  imports: [...FB_PAGE_IMPORTS, FbActivityComponent],
  styleUrls: STYLES,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-fb-head title="Credit activity" sub="Every credit operation on the chain, newest first: houses registering and attesting their reserves, notes minted, moved and redeemed, bills issued, endorsed, discounted and paid, term deposits, pools and settlements between houses" [tabs]="tabs" active="/activity"></app-fb-head>
    <app-fb-activity [chips]="true"></app-fb-activity>
  </div>`,
})
export class FreebankActivityPage implements OnInit {
  tabs = CREDIT_TABS;

  constructor(private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle(`${PROFILE.name}: credit activity`);
  }
}
