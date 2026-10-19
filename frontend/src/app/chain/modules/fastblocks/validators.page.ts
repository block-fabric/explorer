import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of, timer, switchMap } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';

/** FastBlocks: the slot clock, the validator set and its stake, finality by anchoring on Chains, evidence (/validators) */
@Component({
  selector: 'app-fastblocks-validators',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .leader { color: var(--chain-accent); font-weight: 700; }
    .sched { display: flex; gap: 3px; flex-wrap: wrap; }
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

    <!-- the fee split (Layers, and FastBlocks from fee_split_height on) -->
    <ng-container *ngIf="d.info?.feesplit as f">
      <h2>Fee split <span class="muted" style="font-size: 0.8rem">{{ f.active ? 'active' : 'from height ' + f.activationheight }} · ordinary fees shared between the BMM bidder and the validators</span></h2>
      <div class="kpis">
        <div class="kpi"><div class="l">Bidder share</div><div class="v">{{ f.bidderbps / 100 | number:'1.0-2' }}%</div><div class="s">blocks of stake · BMM blocks {{ f.bmmbidderbps / 100 | number:'1.0-2' }}%</div></div>
        <div class="kpi"><div class="l">Validators share</div><div class="v">{{ f.validatorsbps / 100 | number:'1.0-2' }}%</div><div class="s">into the validator pool</div></div>
        <div class="kpi"><div class="l">Chains spacing</div><div class="v">{{ f.spacing }} s</div><div class="s">median at Chains {{ f.mainheight | number }} · 50/50 at ≤ 60 s</div></div>
        <div class="kpi"><div class="l">Validator pool</div><div class="v">{{ f.pool | number:'1.0-8' }}</div><div class="s">CHN to pay this epoch</div></div>
      </div>
      <div class="box">
        <div class="split"><div class="bid" [style.flex]="f.bidderbps">bidder {{ f.bidderbps / 100 | number:'1.0-0' }}%</div><div class="val" [style.flex]="f.validatorsbps">validators {{ f.validatorsbps / 100 | number:'1.0-0' }}%</div></div>
        <table class="table table-borderless table-sm mt-2" *ngIf="f.poolepochs?.length">
          <thead><tr><th>Epoch</th><th class="text-right">Pool</th></tr></thead>
          <tbody><tr *ngFor="let e of f.poolepochs"><td>{{ e.epoch }}</td><td class="text-right">{{ e.amount | number:'1.0-8' }} CHN</td></tr></tbody>
        </table>
      </div>
    </ng-container>

    <h2>Validator set <span class="muted" style="font-size: 0.8rem">epoch {{ d.validators?.epoch }} · total stake {{ (d.validators?.totalstake || 0) / 1e8 | number:'1.0-2' }} CHN</span></h2>
    <div class="box">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Validator</th><th class="text-right">Stake</th><th>Share</th><th class="text-right">Slots this epoch</th><th>Status</th></tr></thead>
        <tbody>
          <tr *ngFor="let v of d.validators?.validators">
            <td class="mono" [class.leader]="v.pubkey === d.info?.leader" [title]="v.pubkey">{{ v.pubkey | slice:0:16 }}…{{ v.pubkey === d.info?.leader ? '  ◀ leader' : '' }}</td>
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
        <tbody><tr *ngFor="let e of d.evidence"><td class="mono">{{ e.pubkey | slice:0:16 }}…</td><td>slot {{ e.slot }}</td><td class="mono muted">{{ e.hashes?.join(' / ') }}</td></tr></tbody>
      </table>
    </div>
  </div>`,
})
export class FastblocksValidatorsPage implements OnInit {
  profile = PROFILE;
  data$: Observable<any>;

  constructor(private api: ChainApiService) {}

  ngOnInit(): void {
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
