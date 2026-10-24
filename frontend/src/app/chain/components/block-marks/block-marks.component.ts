import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Injector, Input, OnChanges, OnDestroy } from '@angular/core';
import { Observable, Subscription, combineLatest } from 'rxjs';
import { BlockMark, DrivechainLiveService } from '@app/chain/drivechain-live.service';
import { FREEBANK, PROFILE, PROFILES, slotColor, slotMarkId } from '@app/chain/profiles';
import { L2LiveService, L2Mark } from '@app/chain/l2/full/l2-live.service';
import { FlushAnchor, FlushBlockMark, FlushLiveService } from '@app/chain/modules/flush/flush-live.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { FreebankLiveService } from '@app/chain/modules/freebank/freebank-live.service';
import { FreebankApiService } from '@app/chain/modules/freebank/freebank-api.service';

/**
 * A block's drivechain marks, wherever blocks are shown:
 *   stripe  inside a block cube: one band per sidechain block it carried
 *   below   under a block cube: the miner, a mark per sidechain carried, deposits ↓ and withdrawals ↑
 *   inline  in a table row: the same as `below`, on one line
 *   miner   the miner alone (block and transaction pages)
 * On a sidechain explorer (chain/l2/full): the eCash block that carried the block by BMM, and the bid paid for it
 */
@Component({
  selector: 'app-chain-block-marks',
  template: `
    <!-- a sidechain block: the eCash block that carried it (BMM) -->
    <ng-container *ngIf="l2">
      <ng-container *ngIf="l2Mark !== undefined">
        <div *ngIf="mode === 'stripe'" class="stripe" [title]="l2Title">
          <span class="band" [style.background]="l2Mark?.mainBlock ? ecashColor : 'transparent'" [style.outline]="l2Mark?.mainBlock ? null : '1px dashed var(--transparent-fg)'"></span>
        </div>
        <ng-container *ngIf="mode !== 'stripe'">
          <ng-container *ngIf="l2Mark?.mainBlock as mb; else notCarried">
            <span *ngIf="mode === 'miner'" class="badge miner-badge" [title]="l2Title">BMM · <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> block
              <a *ngIf="mainBase$ | async as base; else plainMiner" [href]="base + '/block/' + mb.hash">{{ mb.height !== null && mb.height !== undefined ? (mb.height | number) : (mb.hash | slice:0:8) + '…' }}</a>
              <ng-template #plainMiner>{{ mb.height !== null && mb.height !== undefined ? (mb.height | number) : (mb.hash | slice:0:8) + '…' }}</ng-template>
              <span *ngIf="l2Mark?.bmm?.bid !== null && l2Mark?.bmm?.bid !== undefined"> · bid {{ l2Mark.bmm.bid | number }} sats</span>
            </span>
            <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'">
              <span class="icons">
                <a *ngIf="mainBase$ | async as base; else plainCarrier" class="carrier" [href]="base + '/block/' + mb.hash" [title]="l2Title">
                  <app-svg-images name="chain-mark" fill="ecash" [width]="px" [height]="px" [style.color]="ecashColor"></app-svg-images> {{ mb.height !== null && mb.height !== undefined ? (mb.height | number) : (mb.hash | slice:0:8) + '…' }}
                </a>
                <ng-template #plainCarrier><span class="carrier" [title]="l2Title"><app-svg-images name="chain-mark" fill="ecash" [width]="px" [height]="px" [style.color]="ecashColor"></app-svg-images> {{ mb.height !== null && mb.height !== undefined ? (mb.height | number) : (mb.hash | slice:0:8) + '…' }}</span></ng-template>
                <span *ngIf="l2Mark?.bmm?.contested" class="peg wd" title="Contested: other BMM requests for this slot in that eCash block">⚔</span>
                <span *ngIf="l2Mark?.deposits" class="peg dep" [title]="l2Mark.deposits + ' deposit(s) from eCash credited'">↓{{ l2Mark.deposits > 1 ? l2Mark.deposits : '' }}</span>
              </span>
            </div>
          </ng-container>
          <ng-template #notCarried>
            <span *ngIf="mode === 'miner'" class="badge miner-badge" title="No eCash block known to have carried this block (yet)">BMM · not carried yet</span>
            <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'"><span class="none" title="No eCash block known to have carried this block (yet)">–</span></div>
          </ng-template>
        </ng-container>
      </ng-container>
    </ng-container>

    <!-- Flush (chain/modules/flush): a block of stake or a BMM block, and its finality (GET /api/v1/flush/block/:hash) -->
    <ng-container *ngIf="flush && fMark">
      <div *ngIf="mode === 'stripe'" class="stripe" [title]="fTitle">
        <span class="band" [style.background]="fColor" [style.outline]="fMark.finality?.status === 'final' || fMark.finality?.status === 'anchored' ? null : '1px dashed var(--transparent-fg)'"></span>
      </div>
      <span *ngIf="mode === 'miner'" class="badge miner-badge" [title]="fTitle">
        <ng-container *ngIf="fMark.kind === 'pos'">Block of stake · slot {{ fMark.slot | number }}<ng-container *ngIf="fMark.proposer"> · <a [routerLink]="['/validator', fMark.proposer]" class="mono">{{ fMark.proposer | slice:0:8 }}…</a></ng-container></ng-container>
        <ng-container *ngIf="fMark.kind === 'bmm'">BMM block<ng-container *ngIf="fMark.mainheight"> · <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> {{ fMark.mainheight | number }}</ng-container></ng-container>
        <ng-container *ngIf="fMark.ack"> · anchor of <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> {{ fMark.ack.mainheight | number }}</ng-container>
        <ng-container *ngIf="fAnchored"> · anchored by <app-sidechain-label chain="ecash" name="eCash"></app-sidechain-label> {{ fAnchored.mainheight | number }}</ng-container>
        · {{ fMark.finality?.status || 'not on the active chain' }}
      </span>
      <!-- the ribbon: what the block is, and the eCash block that ties it to eCash (a BMM block's carrier, the ticket an
           anchor acknowledges, the anchor that anchored it) -->
      <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'" [title]="fTitle">
        <span class="icons">
          <span class="fk" [class.fk-tie]="fKind !== 'PoS'">{{ fKind }}</span>
          <ng-container *ngIf="fMain"><app-svg-images name="chain-mark" fill="ecash" width="11" height="11" class="fe"></app-svg-images><span class="fmain">{{ fMain | number }}</span></ng-container>
        </span>
        <!-- finality: soft (a block of stake alone), anchored (an eCash anchor covers it, n of them so far), final (enough
             anchors: it cannot be reorganised) -->
        <span class="ffin" [ngClass]="'ffin-' + (fMark.finality?.status || 'none')">{{ fFinality }}</span>
      </div>
    </ng-container>

    <ng-container *ngIf="!l2 && !flush && mark?.summary as s">
      <!-- a band per sidechain carried -->
      <div *ngIf="mode === 'stripe'" class="stripe" [title]="stripeTitle">
        <span *ngFor="let a of s.bmm" class="band" [style.background]="colorOf(a.slot)"></span>
      </div>

      <!-- the miner alone (block and transaction pages) -->
      <span *ngIf="mode === 'miner'" class="badge miner-badge" [title]="'From the coinbase of this block' + (s.datum ? ' (DATUM: pool tag and miner tag)' : '')"><img *ngIf="s.minerLogo" class="pool-logo" [src]="logoUrl(s.minerLogo)" (error)="hideLogo($event)" alt="">{{ s.miner || 'Unknown' }}{{ s.datum && s.minerTag ? ' · ' + s.minerTag : '' }}</span>

      <div *ngIf="mode === 'below' || mode === 'inline'" class="marks" [class.inline]="mode === 'inline'">
        <span *ngIf="mode === 'below'" class="miner" [title]="'Mined by ' + (s.miner || 'an unknown miner') + (s.datum ? ', DATUM miner ' + (s.minerTag || 'without a tag') : '')"><img *ngIf="s.minerLogo" class="pool-logo" [src]="logoUrl(s.minerLogo)" (error)="hideLogo($event)" alt="">{{ s.miner || 'Unknown' }}</span>
        <span class="icons">
          <span *ngFor="let a of s.bmm" class="sc" [style.color]="colorOf(a.slot)" [title]="a.name + ' block carried' + (a.bid != null ? ', bid ' + a.bid + ' sats' : '')">
            <app-svg-images name="chain-mark" [fill]="markId(a.slot, a.name)" [width]="px" [height]="px"></app-svg-images>
          </span>
          <span *ngIf="!s.bmm.length && mode === 'inline'" class="none">–</span>
          <span *ngIf="s.deposits" class="peg dep" [title]="s.deposits + ' deposit(s) into sidechains'">↓{{ s.deposits > 1 ? s.deposits : '' }}</span>
          <span *ngIf="s.withdrawals" class="peg wd" [title]="s.withdrawals + ' withdrawal(s) out of sidechains'">↑{{ s.withdrawals > 1 ? s.withdrawals : '' }}</span>
          <span *ngIf="s.bundlesProposed || s.bundlesClosed" class="peg bn" title="Withdrawal bundle proposed or closed">◆</span>
          <span *ngIf="s.proposals || s.acks" class="peg pr" title="Sidechain proposal or ack">✦</span>
        </span>
      </div>
    </ng-container>

    <!-- the blocks list's drivechain columns: the sidechains carried, the bids, the peg, the bundle votes -->
    <ng-container *ngIf="!l2 && !flush && mark?.summary as s">
      <span *ngIf="mode === 'bmm'" class="col bmm" [title]="stripeTitle">
        <span *ngFor="let a of s.bmm" class="sc" [style.color]="colorOf(a.slot)"><app-svg-images name="chain-mark" [fill]="markId(a.slot, a.name)" [width]="px" [height]="px"></app-svg-images></span>
        <span *ngIf="s.bmm.length" class="n">{{ s.bmm.length }}</span>
        <span *ngIf="!s.bmm.length" class="none">–</span>
      </span>
      <span *ngIf="mode === 'bids'" class="col" [title]="bidsTitle(s)">
        <ng-container *ngIf="s.bids; else noBid">{{ s.bids | number }}<span class="u">sats</span></ng-container>
        <ng-template #noBid><span class="none">–</span></ng-template>
        <span *ngIf="s.bmmRequests > s.bmm.length" class="beaten" title="BMM requests in this block that another request for their slot beat">{{ s.bmmRequests - s.bmm.length }} beaten</span>
      </span>
      <span *ngIf="mode === 'peg'" class="col">
        <span *ngIf="s.deposits" class="dep" [title]="s.deposits + ' deposit(s) into sidechains: ' + (s.depositAmount / 1e8) + ' ECX'">↓ {{ s.depositAmount / 1e8 | number:'1.0-4' }}</span>
        <span *ngIf="s.withdrawals" class="wd" [title]="s.withdrawals + ' withdrawal(s) out of sidechains: ' + (s.withdrawalAmount / 1e8) + ' ECX'">↑ {{ s.withdrawalAmount / 1e8 | number:'1.0-4' }}</span>
        <span *ngIf="s.bundlesProposed || s.bundlesClosed" class="bn" [title]="(s.bundlesProposed ? s.bundlesProposed + ' bundle(s) proposed' : '') + (s.bundlesProposed && s.bundlesClosed ? ', ' : '') + (s.bundlesClosed ? s.bundlesClosed + ' bundle(s) closed' : '')">◆</span>
        <span *ngIf="!s.deposits && !s.withdrawals && !s.bundlesProposed && !s.bundlesClosed" class="none">–</span>
      </span>
      <span *ngIf="mode === 'votes'" class="col" [title]="votesTitle(s)">
        <ng-container *ngIf="voteCount(s, 'upvote') || voteCount(s, 'downvote'); else noVote">
          <span *ngIf="voteCount(s, 'upvote')" class="up">▲{{ voteCount(s, 'upvote') }}</span>
          <span *ngIf="voteCount(s, 'downvote')" class="down">▼{{ voteCount(s, 'downvote') }}</span>
        </ng-container>
        <ng-template #noVote><span class="none">–</span></ng-template>
        <span *ngIf="s.proposals || s.acks" class="pr" [title]="(s.proposals ? s.proposals + ' sidechain proposal(s)' : '') + (s.proposals && s.acks ? ', ' : '') + (s.acks ? s.acks + ' ack(s)' : '')">✦</span>
      </span>
    </ng-container>
  `,
  styles: [`
    .col { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 0.86em; font-variant-numeric: tabular-nums; }
    .col.bmm { gap: 2px; } .col .n { margin-left: 4px; color: var(--transparent-fg); font-size: 0.9em; }
    .col .u { margin-left: 3px; color: var(--transparent-fg); font-size: 0.85em; }
    .col .beaten { margin-left: 6px; font-size: 0.78em; color: #ff9b9b; }
    .col .dep { color: #3bd16f; } .col .wd { color: #ff6b6b; } .col .bn { color: #ffd166; }
    .col .up { color: #3bd16f; } .col .down { color: #ff6b6b; } .col .pr { color: #a585ff; }
    :host { display: block; }
    .miner-badge { background: color-mix(in srgb, var(--chain-accent, #E6A849) 25%, transparent); color: var(--fg); font-size: 0.85em; }
    .stripe { display: flex; gap: 1px; height: 4px; margin: 4px 8px 0; border-radius: 2px; overflow: hidden; }
    .band { flex: 1; }
    .marks { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; line-height: 1.1; }
    .marks.inline { flex-direction: row; justify-content: flex-start; }
    .miner { color: var(--transparent-fg); max-width: 124px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 13px; display: inline-flex; align-items: center; gap: 4px; }
    .pool-logo { width: 1.1em; height: 1.1em; object-fit: contain; flex: none; }
    .icons { display: inline-flex; align-items: center; gap: 2px; flex-wrap: wrap; justify-content: center; }
    .sc { display: inline-flex; }
    .peg { font-weight: 700; font-size: 11px; padding: 0 2px; }
    .dep { color: #3bd16f; } .wd { color: #ff6b6b; } .bn { color: #ffd166; } .pr { color: #5aa6ff; }
    .none { color: var(--transparent-fg); }
    .fk { font-weight: 700; font-size: 11px; color: var(--transparent-fg); }
    .fk-tie { color: var(--fg); background: color-mix(in srgb, var(--chain-accent) 30%, transparent); padding: 0 4px; border-radius: 3px; }
    .fe { margin-left: 4px; vertical-align: -1px; }
    .ffin { display: block; font-size: 10.5px; line-height: 1.3; color: var(--transparent-fg); }
    .marks.inline .ffin { display: inline; margin-left: 6px; }
    .ffin-final { color: #3bd16f; font-weight: 600; }
    .ffin-anchored { color: var(--chain-accent); }
    .ffin-none { color: #ff6b6b; }
    .fmain { font-size: 11px; color: var(--fg); margin-left: 2px; }
    .fdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 4px; }
    .mono { font-family: monospace; }
    .carrier { display: inline-flex; align-items: center; gap: 3px; color: var(--fg); font-weight: 600; text-decoration: none; }
    a.carrier:hover { text-decoration: underline; }
  `],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChainBlockMarksComponent implements OnChanges, OnDestroy {
  @Input() hash: string;
  /** stripe, below, inline, miner: the ribbon's and the lists' marks; bmm, bids, peg, votes: one column each of the blocks list */
  @Input() mode: 'stripe' | 'below' | 'inline' | 'miner' | 'bmm' | 'bids' | 'peg' | 'votes' = 'below';
  @Input() size: string | number = 13;
  get px(): string { return String(this.size); }

  mark: BlockMark | undefined;
  stripeTitle = '';
  private sub: Subscription;

  /** a sidechain explorer: the block's BMM mark (undefined: not known yet, null: none); FreeBank's too (its header's) */
  l2 = PROFILE.kind === 'l2' || FREEBANK;
  /** Flush: the block's kind and finality */
  flush = PROFILE.kind === 'flush';
  fMark: FlushBlockMark | null = null;
  /** the ribbon's word for the block (BMM, ⚓ Anchor, Anchored, PoS) and the eCash block that ties it to eCash */
  fKind = 'PoS';
  fMain: number | null = null;
  fAnchored: FlushAnchor | null = null;
  fFinality = '';
  fTitle = '';
  fColor = 'transparent';
  l2Mark: L2Mark | null | undefined;
  l2Title = '';
  ecashColor = PROFILES['ecash']?.color ?? '#E6A849';
  mainBase$: Observable<string | null>;

  constructor(private injector: Injector, private cd: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.sub?.unsubscribe();
    if (this.flush) {
      this.fMark = null;
      if (!this.hash) {
        return;
      }
      const live = this.injector.get(FlushLiveService);
      this.sub = combineLatest([live.mark$(this.hash), live.anchored$(this.hash)]).subscribe(([m, anchored]) => {
        this.fMark = m;
        this.fAnchored = anchored;
        // a BMM block, else a block acking an eCash ticket (an anchor), else one an anchor anchored, else a block of stake
        [this.fKind, this.fMain] = m?.kind === 'bmm' ? ['BMM', m.mainheight ?? null]
          : m?.ack ? ['⚓ Anchor', m.ack.mainheight ?? null]
          : anchored ? ['Anchored', anchored.mainheight]
          : ['PoS', null];
        const st = m?.finality?.status;
        const n = m?.finality?.anchors ?? 0;
        this.fFinality = st === 'final' ? '✓ final' : st === 'anchored' ? `anchored · ${n} anchor${n === 1 ? '' : 's'}`
          : st === 'soft' ? 'soft' : m ? 'not on the active chain' : '';
        this.fColor = st === 'final' ? '#3bd16f' : st === 'anchored' ? (PROFILE.color) : 'transparent';
        this.fTitle = m ? (m.kind === 'pos' ? `Block of stake, slot ${m.slot}` + (m.proposer ? `, signed by ${m.proposer}` : '')
          : 'BMM block' + (m.mainheight ? `, committed to by eCash block ${m.mainheight}` : ''))
          + (m.ack ? ` · the anchor of eCash block ${m.ack.mainheight}'s ticket` : '')
          + (anchored ? ` · anchored by eCash block ${anchored.mainheight} (${anchored.kind === 'bmm' ? 'BMM block' : 'ticket'}, acked by block ${anchored.byHeight})` : '')
          + (st ? ` · ${st}` + (m.finality?.anchors ? ` (${m.finality.anchors} anchors)` : '') : '') : '';
        this.cd.markForCheck();
      });
      return;
    }
    if (FREEBANK) {
      // FreeBank: the eCash block its header names (BMM), its height and bid when the eCash explorer's BMM events have it
      this.l2Mark = undefined;
      if (!this.hash) {
        return;
      }
      this.mainBase$ = this.injector.get(FreebankApiService).mainchain$;
      this.sub = this.injector.get(FreebankLiveService).bmm$(this.hash).subscribe(({ mark, mainHeight, bid }) => {
        const mb = mark?.mainblock ? { hash: mark.mainblock, height: mainHeight as number } : null; // (height null: not among the recent BMM events)
        this.l2Mark = mark ? { height: mark.height, hash: mark.hash, mainBlock: mb, bmm: bid !== null ? { bid } as any : null, deposits: 0 } : null;
        this.l2Title = mb
          ? `Mined in eCash block ${mainHeight ?? mb.hash} (blind merged mining)` + (bid !== null ? `, bid ${bid} sats paid to its miner` : '')
          : (mark ? 'No eCash block named in this block\'s header' : '');
        this.cd.markForCheck();
      });
      return;
    }
    if (this.l2) {
      // (the services are taken here, so that the eCash explorer never makes the sidechain one, nor the reverse)
      const l2Live = this.injector.get(L2LiveService);
      this.mainBase$ = this.injector.get(L2ApiService).mainchain$;
      l2Live.requestHash(this.hash);
      this.sub = l2Live.mark$(this.hash).subscribe((m) => {
        this.l2Mark = m;
        const mb = m?.mainBlock;
        const bid = m?.bmm?.bid;
        this.l2Title = mb
          ? `Carried by eCash block ${mb.height} (blind merged mining)` + (bid !== null && bid !== undefined ? `, bid ${bid} sats paid to its miner` : '')
          : (m === null ? '' : 'No eCash block known to have carried this block (yet)');
        this.cd.markForCheck();
      });
      return;
    }
    const live = this.injector.get(DrivechainLiveService);
    live.requestHash(this.hash);
    this.sub = live.mark$(this.hash).subscribe((m) => {
      this.mark = m;
      const s = m?.summary;
      this.stripeTitle = s ? (s.bmm.length ? s.bmm.map(a => a.name).join(', ') + ' carried' : 'No sidechain block carried') : '';
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  bidsTitle(s: any): string {
    return s.bmm.map((a: any) => `${a.name}${a.bid != null ? ` ${a.bid} sats` : ''}`).join(', ') || 'No BMM bid in this block';
  }

  voteCount(s: any, vote: string): number {
    return (s.votes ?? []).filter((v: any) => v.vote === vote).length;
  }

  votesTitle(s: any): string {
    const cast = (s.votes ?? []).filter((v: any) => v.vote !== 'abstain');
    return cast.length ? 'Bundle votes: ' + cast.map((v: any) => `${v.vote} ${v.name}`).join(', ') : 'No bundle vote in this block (abstained)';
  }

  colorOf(slot: number): string {
    return slotColor(slot);
  }

  markId(slot: number, name?: string | null): string {
    return slotMarkId(slot, name);
  }

  logoUrl(logo: string): string {
    return `/resources/pool-logos/${logo}`;
  }

  hideLogo(event: Event): void {
    (event.target as HTMLElement).style.display = 'none';
  }

  get profile() {
    return PROFILE;
  }
}
