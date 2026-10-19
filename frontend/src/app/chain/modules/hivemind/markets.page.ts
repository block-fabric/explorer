import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Observable, catchError, combineLatest, map, of } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';

/** Hivemind: the prediction markets with their odds, the decisions votecoin holders resolve, the reputation (/markets) */
@Component({
  selector: 'app-hivemind-markets',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .market { padding: 12px 0; border-top: 1px solid #ffffff12; &:first-child { border-top: none; } }
    .q { font-size: 1rem; font-weight: 600; }
    .meta { font-size: 0.75rem; color: var(--transparent-fg); margin: 2px 0 8px; }
    .odds { display: flex; height: 26px; border-radius: 6px; overflow: hidden; gap: 2px; }
    .odd { display: flex; align-items: center; justify-content: center; font-size: 0.78rem; font-weight: 600; min-width: 40px; color: #11131f; }
    .phase { text-transform: uppercase; }
  `],
  template: `
  <div class="container-xl mp" *ngIf="data$ | async as d">
    <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> Markets</h1>
    <div class="sub">Prediction markets on Hivemind, priced by a market maker (LMSR); votecoin holders resolve the decisions they depend on with sealed votes.</div>
    <div class="kpis" *ngIf="d.info as i">
      <div class="kpi"><div class="l">Voting period</div><div class="v">{{ i.period | number }}</div><div class="s">phase <b class="phase">{{ i.phase }}</b> · {{ i.periodseconds / 60 }} min periods</div></div>
      <div class="kpi"><div class="l">Markets</div><div class="v">{{ i.markets | number }}</div><div class="s">{{ trading(d.markets) }} trading</div></div>
      <div class="kpi"><div class="l">Decisions</div><div class="v">{{ i.decisions | number }}</div><div class="s">{{ openDecisions(d.decisions) }} open</div></div>
      <div class="kpi"><div class="l">Liquidity</div><div class="v">{{ treasury(d.markets) | number:'1.0-2' }}</div><div class="s">CHN in market treasuries</div></div>
      <div class="kpi"><div class="l">Voters</div><div class="v">{{ i.voters | number }}</div><div class="s">{{ i.reputation | number }} votecoin · pot {{ i.voterpot }} CHN</div></div>
    </div>

    <div class="tabs">
      <button [class.on]="tab === 'markets'" (click)="tab = 'markets'">Markets</button>
      <button [class.on]="tab === 'decisions'" (click)="tab = 'decisions'">Decisions</button>
      <button [class.on]="tab === 'reputation'" (click)="tab = 'reputation'">Reputation</button>
    </div>

    <div class="box" *ngIf="tab === 'markets'">
      <div class="market" *ngFor="let m of d.markets">
        <div class="q">{{ m.text }}</div>
        <div class="meta"><span class="pill" [class.on]="m.status === 'trading'">{{ m.status }}</span>
          · trading until period {{ m.tradinguntil }} · treasury {{ m.treasury | number:'1.0-4' }} CHN · fees {{ m.fees | number:'1.0-6' }} · {{ m.feebps / 100 }}% fee · opened at {{ m.height }}</div>
        <div class="odds">
          <div class="odd" *ngFor="let s of m.states; let i = index" [style.flex]="s.price" [style.background]="stateColor(i, m.states.length)" [title]="s.answers + ': ' + (s.price * 100 | number:'1.0-1') + '% · ' + s.shares + ' shares'">
            {{ s.answers }} {{ s.price * 100 | number:'1.0-0' }}%
          </div>
        </div>
      </div>
    </div>

    <div class="box" *ngIf="tab === 'decisions'">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Decision</th><th>Kind</th><th>Event period</th><th>Closes</th><th>Status</th><th>Outcome</th></tr></thead>
        <tbody>
          <tr *ngFor="let x of d.decisions">
            <td>{{ x.text }}</td>
            <td class="muted">{{ x.scaled ? 'scaled' : 'yes / no' }}</td>
            <td>{{ x.eventperiod }}</td>
            <td>{{ x.closeperiod }}</td>
            <td><span class="pill" [class.on]="x.status === 'open'">{{ x.status }}</span></td>
            <td>{{ x.outcome ?? x.answer ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="box" *ngIf="tab === 'reputation'">
      <table class="table table-borderless table-sm">
        <thead><tr><th>Account</th><th class="text-right">Votecoin</th><th>Share</th></tr></thead>
        <tbody>
          <tr *ngFor="let r of d.reputation">
            <td class="mono"><a [routerLink]="['/address' | relativeUrl, r.account]">{{ r.account }}</a></td>
            <td class="text-right">{{ r.amount | number:'1.0-8' }}</td>
            <td><div class="bar"><div class="fill" [style.width.%]="100 * r.amount / (d.info?.reputation || 1)"></div></div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
})
export class HivemindMarketsPage implements OnInit {
  profile = PROFILE;
  tab: 'markets' | 'decisions' | 'reputation' = 'markets';
  data$: Observable<any>;

  constructor(private api: ChainApiService) {}

  ngOnInit(): void {
    const get = (p: string) => this.api.feature$<any>(p).pipe(catchError(() => of(null)));
    this.data$ = combineLatest([get('info'), get('markets'), get('decisions'), get('reputation')]).pipe(
      map(([info, markets, decisions, reputation]) => ({
        info,
        markets: (markets ?? []).sort((a: any, b: any) => (a.status === 'trading' ? 0 : 1) - (b.status === 'trading' ? 0 : 1) || b.treasury - a.treasury),
        decisions: decisions ?? [], reputation: (reputation ?? []).sort((a: any, b: any) => b.amount - a.amount),
      })),
    );
  }

  stateColor(i: number, n: number): string {
    const palette = ['#ff8a7a', '#7ee0a0', '#f5b83d', '#5aa6ff', '#cba6f7', '#2ec4b6', '#ff8a3d', '#f26b9c'];
    return n === 2 ? (i === 0 ? '#ff8a7a' : '#7ee0a0') : palette[i % palette.length];
  }

  trading(ms: any[]): number { return ms.filter(m => m.status === 'trading').length; }
  openDecisions(ds: any[]): number { return ds.filter(x => x.status === 'open').length; }
  treasury(ms: any[]): number { return ms.reduce((a, m) => a + Number(m.treasury || 0), 0); }
}
