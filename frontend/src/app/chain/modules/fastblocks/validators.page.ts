import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, timer, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { MiniLineChartComponent } from '../bitassets/line-chart.component';
import { BehaviorSubject } from 'rxjs';

/** FastBlocks: the slot clock, the validator set and its stake, finality by anchoring on Chains, evidence (/validators) */
@Component({
  selector: 'app-fastblocks-validators',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, MiniLineChartComponent],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .leader { color: var(--chain-accent); font-weight: 700; }
    .key { max-width: 420px; }
    .sched { display: flex; gap: 3px; flex-wrap: wrap; }
    .fees-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
    .flow .frow { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
    .fl { width: 90px; font-size: 0.8rem; color: var(--transparent-fg); }
    .fv { width: 300px; font-size: 0.78rem; color: var(--transparent-fg); }
    .fbar { flex: 1; display: flex; height: 18px; border-radius: 9px; overflow: hidden; gap: 2px; background: #ffffff0a; }
    .seg { min-width: 0; } .seg.peg, i.peg { background: #ffd166; } .seg.ord, i.ord { background: #5aa6ff; }
    .seg.bid, i.bid { background: #b5f27e; } .seg.val, i.val { background: var(--chain-accent); }
    .seg.pot, i.pot { background: #2bc79a; } .seg.bmm, i.bmm { background: #ff8a3d; } .seg.burn, i.burn { background: #ff6b6b; }
    .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 0.72rem; color: var(--transparent-fg); margin-top: 8px;
      i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: middle; } }
    .blocks td { white-space: nowrap; }
    .key { max-width: 200px; }
    .wrap td { white-space: normal; overflow-wrap: anywhere; }
    .split { display: flex; height: 26px; border-radius: 6px; overflow: hidden; gap: 2px; font-size: 0.78rem; font-weight: 600; color: #11131f;
      div { display: flex; align-items: center; justify-content: center; } .bid { background: #b5f27e; } .val { background: var(--chain-accent); } }
    .slot { width: 26px; height: 26px; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; color: #11131f; font-weight: 700; }
  `],
  template: `
  <div class="container-xl mp" *ngIf="data$ | async as d">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> Validators</h1>
    <div class="sub">{{ profile.name }} makes a block of stake every {{ d.info?.slotseconds }} seconds from a bonded validator set; Chains blocks anchor them by blind merged mining, which makes them final.</div>
    <div class="kpis" *ngIf="d.info as i">
      <div class="kpi"><div class="l">Slot</div><div class="v">{{ i.slot | number }}</div><div class="s">epoch {{ i.epoch }} · {{ i.active ? 'active' : 'inactive' }}{{ i.stalled ? ' · STALLED' : '' }}</div></div>
      <div class="kpi"><div class="l">Bonded</div><div class="v">{{ i.staking?.bonded | number:'1.0-2' }}</div><div class="s">CHN · {{ i.staking?.unbonding | number:'1.0-2' }} unbonding</div></div>
      <div class="kpi"><div class="l">Anchors</div><div class="v">{{ i.anchors | number }}</div><div class="s">last at Chains {{ i.lastanchormainheight | number }}</div></div>
      <div class="kpi"><div class="l">Anchored height</div><div class="v">{{ i.lastanchoredheight | number }}</div><div class="s">first unanchored slot {{ i.firstunanchoredslot | number }}</div></div>
      <div class="kpi"><div class="l">Fee pot</div><div class="v">{{ i.pot?.accrued | number:'1.0-8' }}</div><div class="s">paid {{ i.pot?.paid | number:'1.0-8' }} CHN</div></div>
      <div class="kpi"><div class="l">Evidence</div><div class="v">{{ i.evidence | number }}</div><div class="s">{{ i.staking?.slashed | number:'1.0-2' }} CHN slashed</div></div>
    </div>

    <!-- fees: where every satoshi of fees came from and where it went (GET sidechain/fees, fees.ts) -->
    <ng-container *ngIf="fees$ | async as f">
      <div class="fees-head">
        <h2>Fees <span class="muted" style="font-size: 0.8rem">{{ f.blocks | number }} blocks, {{ f.from | number }}–{{ f.to | number }} · read from each block's coinbase</span></h2>
        <div class="btn-group btn-group-sm">
          <button *ngFor="let w of windows" class="btn" [class.btn-primary]="window === w.blocks" [class.btn-secondary]="window !== w.blocks" (click)="setWindow(w.blocks)">{{ w.label }}</button>
        </div>
      </div>

      <div class="kpis">
        <div class="kpi"><div class="l">Fees paid</div><div class="v"><app-amount [satoshis]="f.totals.fees" digitsInfo="1.0-4" [noFiat]="true" [forceSats]="(f.totals.fees) < 10000000"></app-amount></div><div class="s">in {{ f.totals.blocksWithFees | number }} blocks</div></div>
        <div class="kpi"><div class="l">Peg fees</div><div class="v"><app-amount [satoshis]="f.totals.peg" digitsInfo="1.0-4" [noFiat]="true" [forceSats]="(f.totals.peg) < 10000000"></app-amount></div><div class="s">withdrawals and refunds: all to the bidder</div></div>
        <div class="kpi"><div class="l">Ordinary fees</div><div class="v"><app-amount [satoshis]="f.totals.ordinary" digitsInfo="1.0-4" [noFiat]="true" [forceSats]="(f.totals.ordinary) < 10000000"></app-amount></div><div class="s">split between bidder and validators</div></div>
        <div class="kpi"><div class="l">Bidder's share</div><div class="v">{{ f.totals.bidderShareEffective === null ? '–' : (f.totals.bidderShareEffective * 100 | number:'1.2-2') + '%' }}</div><div class="s">of ordinary fees, as the blocks paid it</div></div>
        <div class="kpi"><div class="l">To validators</div><div class="v"><app-amount [satoshis]="f.totals.validators" digitsInfo="1.0-4" [noFiat]="true" [forceSats]="(f.totals.validators) < 10000000"></app-amount></div><div class="s"><app-amount [satoshis]="f.totals.poolDistributed" digitsInfo="1.0-8" [noFiat]="true"></app-amount> paid out by stake</div></div>
        <div class="kpi"><div class="l">To bidders</div><div class="v"><app-amount [satoshis]="f.totals.peg + f.totals.bidder" digitsInfo="1.0-4" [noFiat]="true" [forceSats]="(f.totals.peg + f.totals.bidder) < 10000000"></app-amount></div><div class="s">pot <app-amount [satoshis]="f.totals.toPot" digitsInfo="1.0-8" [noFiat]="true"></app-amount> · BMM miners <app-amount [satoshis]="f.totals.toBmmMiners" digitsInfo="1.0-8" [noFiat]="true"></app-amount></div></div>
      </div>

      <!-- the flow: fees -> bidder (pot / BMM miner) and validators (pool) -->
      <div class="box">
        <h5>Where the fees went</h5>
        <div class="flow">
          <div class="frow"><span class="fl">Paid</span>
            <div class="fbar"><span class="seg peg" [style.flex]="f.totals.peg || 0" [title]="'peg fees ' + f.totals.peg + ' sats'"></span><span class="seg ord" [style.flex]="f.totals.ordinary || 0" [title]="'ordinary fees ' + f.totals.ordinary + ' sats'"></span></div>
            <span class="fv">peg {{ pct(f.totals.peg, f.totals.fees) }} · ordinary {{ pct(f.totals.ordinary, f.totals.fees) }}</span></div>
          <div class="frow"><span class="fl">Shared</span>
            <div class="fbar"><span class="seg bid" [style.flex]="(f.totals.peg + f.totals.bidder) || 0"></span><span class="seg val" [style.flex]="f.totals.validators || 0"></span></div>
            <span class="fv">bidder {{ pct(f.totals.peg + f.totals.bidder, f.totals.fees) }} · validators {{ pct(f.totals.validators, f.totals.fees) }}</span></div>
          <div class="frow"><span class="fl">Bidder via</span>
            <div class="fbar"><span class="seg pot" [style.flex]="f.totals.toPot || 0"></span><span class="seg bmm" [style.flex]="f.totals.toBmmMiners || 0"></span><span class="seg burn" [style.flex]="f.totals.burned || 0"></span></div>
            <span class="fv">pot {{ pct(f.totals.toPot, f.totals.peg + f.totals.bidder) }} · BMM miners {{ pct(f.totals.toBmmMiners, f.totals.peg + f.totals.bidder) }}{{ f.totals.burned ? ' · burned ' + pct(f.totals.burned, f.totals.peg + f.totals.bidder) : '' }}</span></div>
        </div>
        <div class="legend">
          <span><i class="peg"></i>peg fees</span><span><i class="ord"></i>ordinary fees</span><span><i class="bid"></i>to the BMM bidder</span><span><i class="val"></i>to the validators' pool</span>
          <span><i class="pot"></i>fee pot (blocks of stake, paid at the next anchor)</span><span><i class="bmm"></i>kept by the BMM miner</span><span><i class="burn"></i>unclaimed (burned)</span>
        </div>
        <p class="muted small mt-2 mb-0">Peg transactions (withdrawals, refund requests) pay their whole fee to the bidder. Ordinary fees are split by the curve below:
          a block of stake puts the bidder's share in the fee pot, which the next anchor pays to the payee of the ticket Chains committed to; a BMM block's miner takes it directly.
          The validators' share goes into the pool of the block's epoch and is paid to the validators by stake once the epoch is over.</p>
      </div>

      <div class="grid2 mt-3">
        <div class="box">
          <h5>The split now <small class="muted">curve {{ f.now.curve }}{{ f.now.active ? '' : ' (not active yet)' }}</small></h5>
          <div class="split mb-2"><div class="bid" [style.flex]="f.now.bidderbps">bidder {{ f.now.bidderbps / 100 | number:'1.0-2' }}%</div><div class="val" [style.flex]="f.now.validatorsbps">validators {{ f.now.validatorsbps / 100 | number:'1.0-2' }}%</div></div>
          <table class="table table-borderless table-sm wrap">
            <tr><td class="muted">Chains block spacing (S)</td><td>{{ f.now.spacing }} s <span class="muted">median of 11 spacings, at Chains {{ f.now.mainheight | number }} (this epoch's seed block)</span></td></tr>
            <tr><td class="muted">Blocks of stake</td><td>bidder {{ f.now.bidderbps / 100 | number:'1.0-2' }}% · validators {{ f.now.validatorsbps / 100 | number:'1.0-2' }}%</td></tr>
            <tr><td class="muted">A BMM block now</td><td>S {{ f.now.bmmSpacing }} s at Chains {{ f.now.bmmMainheight | number }} · bidder {{ f.now.bmmBidderbps / 100 | number:'1.0-2' }}%</td></tr>
            <tr><td class="muted">Fee pot</td><td><app-amount [satoshis]="f.now.pot.outstanding" digitsInfo="1.0-8" [noFiat]="true"></app-amount> waiting for the next anchor · reserve <app-amount [satoshis]="f.now.pot.reserve" digitsInfo="1.0-8" [noFiat]="true"></app-amount></td></tr>
            <tr><td class="muted">Validators' pool</td><td><ng-container *ngFor="let e of f.now.poolEpochs; let last = last">epoch {{ e.epoch }}: <app-amount [satoshis]="e.amount" digitsInfo="1.0-8" [noFiat]="true"></app-amount>{{ last ? '' : ' · ' }}</ng-container><span *ngIf="!f.now.poolEpochs.length" class="muted">empty</span></td></tr>
          </table>
        </div>
        <div class="box">
          <h5>Bidder's share against S <small class="muted">50% up to 60 s, then {{ f.now.curve === 2 ? 'down by 0.5 point per 6 s, 20% from 420 s' : 'falling as 30/S, at least 10%' }}; the dot is now</small></h5>
          <app-mini-line-chart [points]="curvePoints(f)" [dots]="[[f.now.spacing, f.now.bidderbps / 100, 'S ' + f.now.spacing + ' s: ' + f.now.bidderbps / 100 + '%']]" xPrefix=""></app-mini-line-chart>
          <div class="muted small">S in seconds (x) · bidder's share in % (y)</div>
        </div>
      </div>

      <div class="grid2 mt-3">
        <div class="box">
          <h5>Validators <small class="muted">blocks made and pool shares received</small></h5>
          <table class="table table-borderless table-sm">
            <thead><tr><th>Validator</th><th class="text-right">Stake</th><th class="text-right">Blocks</th><th class="text-right">Fees in them</th><th class="text-right">Pool shares</th></tr></thead>
            <tbody><tr *ngFor="let v of f.validators">
              <td class="mono key"><app-truncate [text]="v.pubkey.startsWith('owner:') ? (v.owner || '?') : v.pubkey" [lastChars]="6"></app-truncate></td>
              <td class="text-right">{{ v.stake ? (v.stake / 1e8 | number:'1.0-2') : '–' }}</td>
              <td class="text-right">{{ v.blocks | number }}</td>
              <td class="text-right">{{ v.feesInBlocks / 1e8 | number:'1.0-8' }}</td>
              <td class="text-right">{{ v.poolShares / 1e8 | number:'1.0-8' }} <span class="muted">({{ v.payouts }})</span></td>
            </tr></tbody>
          </table>
        </div>
        <div class="box">
          <h5>Bidders paid <small class="muted">the pot at anchors, and BMM miners</small></h5>
          <p *ngIf="!f.payees.length" class="muted mb-0">No anchor in this window.</p>
          <table class="table table-borderless table-sm" *ngIf="f.payees.length">
            <thead><tr><th>Paid to</th><th class="text-right">Anchors</th><th class="text-right">Pot received</th><th class="text-right">As BMM miner</th></tr></thead>
            <tbody><tr *ngFor="let p of f.payees">
              <td class="mono key"><app-truncate *ngIf="!p.address.startsWith('('); else rawPayee" [text]="p.address" [link]="['/address' | relativeUrl, p.address]" [lastChars]="6"></app-truncate><ng-template #rawPayee><span class="muted">{{ p.address }}</span></ng-template></td>
              <td class="text-right">{{ p.anchors | number }}</td>
              <td class="text-right">{{ p.potPaid / 1e8 | number:'1.0-8' }}</td>
              <td class="text-right">{{ p.bmmMiner / 1e8 | number:'1.0-8' }}</td>
            </tr></tbody>
          </table>
        </div>
      </div>

      <h2>Fees block by block <span class="muted" style="font-size: 0.8rem">the newest blocks with fees or anchor payouts</span></h2>
      <div class="box">
        <table class="table table-borderless table-sm blocks">
          <thead><tr><th>Block</th><th>Kind</th><th class="text-right">Peg fees</th><th class="text-right">Ordinary</th><th class="text-right">Bidder</th><th class="text-right">Validators</th>
            <th class="text-right">Into the pot</th><th>Anchor payouts</th></tr></thead>
          <tbody><tr *ngFor="let b of f.recent">
            <td><a [routerLink]="['/block' | relativeUrl, b.hash]">{{ b.h | number }}</a></td>
            <td><span class="pill" [class.on]="b.kind === 'bmm'">{{ b.kind === 'bmm' ? 'BMM' : b.anchor ? 'PoS·BMM' : 'PoS' }}</span></td>
            <td class="text-right">{{ b.peg | number }}</td>
            <td class="text-right">{{ b.ordinary | number }}</td>
            <td class="text-right">{{ b.bidder | number }} <span class="muted" *ngIf="b.ordinary">{{ b.bidder / b.ordinary * 100 | number:'1.1-1' }}%</span></td>
            <td class="text-right">{{ b.validators | number }}</td>
            <td class="text-right">{{ b.kind === 'bmm' ? ('miner ' + (b.miner | number) + (b.burned ? ', burned ' + (b.burned | number) : '')) : (b.pot | number) }}</td>
            <td class="small">
              <ng-container *ngIf="b.anchor">
                <span *ngIf="b.potPaid !== null">pot {{ b.potPaid | number }}<span class="muted" *ngIf="b.potExpected !== null && b.potExpected !== b.potPaid"> (accrued {{ b.potExpected | number }})</span></span>
                <span *ngIf="b.potPaid === null && b.potExpected" class="muted">pot {{ b.potExpected | number }} accrued</span>
                <span *ngIf="b.shares.length">{{ b.potPaid !== null || b.potExpected ? ' · ' : '' }}{{ b.shares.length }} pool share{{ b.shares.length === 1 ? '' : 's' }}: {{ sharesTotal(b) | number }}</span>
                <span *ngIf="b.otherPayouts" class="muted"> · other {{ b.otherPayouts | number }}</span>
              </ng-container>
            </td>
          </tr></tbody>
        </table>
        <div class="muted small">Amounts in sats.</div>
      </div>
    </ng-container>

    <h2>Validator set <span class="muted" style="font-size: 0.8rem">epoch {{ d.validators?.epoch }} · total stake {{ (d.validators?.totalstake || 0) / 1e8 | number:'1.0-2' }} CHN</span></h2>
    <div class="box">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Validator</th><th class="text-right">Stake</th><th>Share</th><th class="text-right">Slots this epoch</th><th>Status</th></tr></thead>
        <tbody>
          <tr *ngFor="let v of d.validators?.validators">
            <td class="mono key" [class.leader]="v.pubkey === d.info?.leader"><app-truncate [text]="v.pubkey" [lastChars]="8">{{ v.pubkey === d.info?.leader ? ' ◀ leader' : '' }}</app-truncate></td>
            <td class="text-right">{{ v.stake / 1e8 | number:'1.0-2' }} CHN</td>
            <td><div class="bar"><div class="fill" [style.width.%]="100 * v.stake / (d.validators.totalstake || 1)"></div></div></td>
            <td class="text-right">{{ v.slots }}</td>
            <td><span class="pill" [class.on]="!v.banned && !v.jaileduntilepoch">{{ v.banned ? 'banned' : v.jaileduntilepoch ? 'jailed to ' + v.jaileduntilepoch : 'active' }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <ng-container *ngIf="schedule(d.schedule) as s">
      <h2 *ngIf="s.length">Leader schedule</h2>
      <div class="box sched" *ngIf="s.length">
        <div class="slot" *ngFor="let x of s" [style.background]="keyColor(x.leader)" [title]="'slot ' + x.slot + ': ' + x.leader">{{ x.slot % 100 }}</div>
      </div>
    </ng-container>

    <h2>Evidence <span class="muted" style="font-size: 0.8rem">double proposals, punished by slashing</span></h2>
    <div class="box">
      <p *ngIf="!d.evidence?.length" class="muted mb-0">No validator has signed two blocks for the same slot.</p>
      <table class="table table-borderless table-sm" *ngIf="d.evidence?.length">
        <tbody><tr *ngFor="let e of d.evidence"><td class="mono key"><app-truncate [text]="e.pubkey" [lastChars]="8"></app-truncate></td><td>slot {{ e.slot }}</td><td class="mono muted">{{ e.hashes?.join(' / ') }}</td></tr></tbody>
      </table>
    </div>
  </div>`,
})
export class FastblocksValidatorsPage implements OnInit {
  profile = PROFILE;
  data$: Observable<any>;
  fees$: Observable<any>;
  windows = [{ label: '1h', blocks: 240 }, { label: '1d', blocks: 5760 }, { label: '1w', blocks: 40320 }, { label: 'All', blocks: 0 }];
  window = 5760;
  private window$ = new BehaviorSubject<number>(5760);

  setWindow(w: number): void { this.window = w; this.window$.next(w); }

  pct(x: number, total: number): string { return total ? (100 * x / total).toFixed(1) + '%' : '–'; }

  sharesTotal(b: any): number { return b.shares.reduce((a: number, s: any) => a + s.amount, 0); }

  /** the bidder's share in % against S for the curve in use */
  curvePoints(f: any): [number, number][] {
    const col = f.now.curve === 1 ? 1 : 2;
    return f.curves.map((c: number[]) => [c[0], c[col] / 100]);
  }

  constructor(private api: ChainApiService) {}

  ngOnInit(): void {
    this.fees$ = combineLatest([this.window$, timer(0, 20000)]).pipe(
      switchMap(([w]) => this.api.feature$<any>('fees', { window: w }).pipe(catchError(() => of(null)))),
    );
    const get = (p: string) => this.api.feature$<any>(p).pipe(catchError(() => of(null)));
    this.data$ = timer(0, 15000).pipe(
      switchMap(() => combineLatest([get('pos'), get('validators'), get('schedule'), get('evidence')])),
      map(([info, validators, schedule, evidence]) => ({ info, validators, schedule, evidence })),
    );
  }

  /** the leader schedule as a list of { slot, leader }, whatever its shape */
  schedule(s: any): { slot: number; leader: string }[] {
    const list = Array.isArray(s) ? s : (s?.slots ?? s?.schedule ?? []);
    return list.slice(0, 120).map((x: any, i: number) => ({ slot: x.slot ?? (s?.firstslot ?? 0) + i, leader: x.leader ?? x.pubkey ?? String(x) }));
  }

  keyColor(key: string): string {
    const h = parseInt((key || '0').slice(0, 6), 16) % 360;
    return `hsl(${h}, 70%, 65%)`;
  }
}
