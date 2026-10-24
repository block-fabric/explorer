import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { FEATURE_PAGE_IMPORTS, chipsBy, featureData$, matchAny } from '@app/chain/l2/features/feature-kit';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

// GET /api/v1/l2/feature/decisions[/:id], feature/votes (chains/L2-API.md): Truthcoin's oracle, from the node's public reads
export interface DecisionItem {
  decision_id_hex: string;
  period_index: number;
  decision_index: number;
  state: string;
  decision: { id: string; market_maker_pubkey_hash: string; is_standard: boolean; decision_type: string; header: string; description: string; tags: string[] } | null;
  markets: { market_id: string; title: string }[];
}
export interface DecisionStatus { is_testing_mode: boolean; blocks_per_period: number; current_period: number; current_period_name: string }
export interface DecisionDetail extends DecisionItem {
  entry: any;
  votes: { voter_address: string; decision_id: string; vote_value: number; period_id: number; block_height: number }[];
}
export interface VotesView {
  status: DecisionStatus;
  period: { period_id: number; status: string; start_time: number; end_time: number; decisions: any[];
    stats: { total_voters: number; active_voters: number; total_votes: number; participation_rate: number }; consensus: any } | null;
  voters: { address: string; votecoin_balance: number; total_votes: number; is_active: boolean }[];
  periods: { period_index: number; cheapest_available_slot_sats: number; cheapest_available_tier: number; slots_available_by_tier: number[] }[];
  voteTxs: { txid: string; height: number; time: number | null; type: string; voter: string | null }[];
}

/** /decisions: the oracle's decisions past "created" (claimed, voting, resolved) and the count of open slots */
@Component({
  selector: 'app-truthcoin-decisions',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="decisions"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no oracle: this page belongs to the Truthcoin explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Decisions" [height]="300"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Period</div><div class="v">{{ d.status.current_period }}</div><div class="s">{{ d.status.current_period_name }}</div></div>
            @for (c of countList(d.counts); track c[0]) {
              <div class="kpi"><div class="l">{{ c[0] }}</div><div class="v">{{ c[1] | number }}</div><div class="s">{{ c[0] === 'Created' ? 'open slots, unclaimed' : 'decisions' }}</div></div>
            }
          </div>
          <div class="box">
            <app-chain-table [rows]="d.items" [columns]="decisionCols" [filters]="chipsBy(d.items, 'State', stateOf)" [search]="decisionMatches"
                searchPlaceholder="Decision, question, market…" sort="period_index" empty="No claimed decisions." [trackBy]="decisionKey">
              <ng-template cxCell="id" let-x><a [routerLink]="['/decisions', x.decision_id_hex]" class="mono">{{ x.decision_id_hex }}</a></ng-template>
              <ng-template cxCell="header" let-x>{{ x.decision?.header }}</ng-template>
              <ng-template cxCell="type" let-x><span class="small muted">{{ x.decision?.decision_type }}</span></ng-template>
              <ng-template cxCell="state" let-x><span class="status" [class.ok]="x.state === 'Resolved'" [class.wait]="x.state === 'Voting'">{{ x.state }}</span></ng-template>
              <ng-template cxCell="markets" let-x><span class="small">@for (m of x.markets; track m.market_id) {<div><a [routerLink]="['/markets', m.market_id]">{{ m.title }}</a></div>} @empty {<span class="muted">–</span>}</span></ng-template>
            </app-chain-table>
          </div>
          <p class="note">A market's questions are oracle decisions: each is claimed in a period's slot, voted on by the Votecoin holders in its
            voting period, then resolved. "Created" counts the slots of the open periods nobody has claimed yet.</p>
        }
      }
    }
  </div>`,
})
export class TruthcoinDecisionsPage implements OnInit {
  view$: Observable<Loaded<{ status: DecisionStatus; counts: Record<string, number>; items: DecisionItem[] }> | 'unavailable'>;
  chipsBy = chipsBy;
  stateOf = (x: DecisionItem) => x.state;
  decisionCols: CxColumn<DecisionItem>[] = [
    { key: 'id', label: 'Decision', sort: x => x.decision_id_hex },
    { key: 'header', label: 'Question', sort: x => x.decision?.header },
    { key: 'type', label: 'Type', sort: x => x.decision?.decision_type, hide: 'md' },
    { key: 'state', label: 'State', sort: true },
    { key: 'period_index', label: 'Period', sort: true },
    { key: 'markets', label: 'Markets', sort: x => x.markets.length, hide: 'md' },
  ];
  decisionKey = (x: DecisionItem) => x.decision_id_hex;
  decisionMatches = matchAny<DecisionItem>(x => x.decision_id_hex, x => x.decision?.header, x => x.markets.map(m => m.title).join(' '));

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Decisions');
    this.view$ = featureData$(this.api, 'markets', () => this.api.feature$('decisions'));
  }

  countList(c: Record<string, number>): [string, number][] {
    const order = ['Claimed', 'Voting', 'Resolved', 'Created'];
    return Object.entries(c ?? {}).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }
}

/** /decisions/:id: one decision, its votes and the markets that use it */
@Component({
  selector: 'app-truthcoin-decision',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="decisions" [id]="id" [title]="title"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Decision" [id]="id" [height]="300"></app-l2-state>
      @if (v.data; as d) {
        <div class="grid2">
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>State</th><td><span class="status">{{ d.state }}</span></td></tr>
              <tr><th>Period / slot</th><td>{{ d.period_index }} / {{ d.decision_index }}</td></tr>
              <tr><th>Type</th><td>{{ d.decision?.decision_type ?? '–' }}{{ d.decision?.is_standard ? ' (standard)' : '' }}</td></tr>
              <tr><th>Description</th><td>{{ d.decision?.description || '–' }}</td></tr>
              <tr><th>Claimed by</th><td class="mono">{{ d.decision?.market_maker_pubkey_hash ?? '–' }}</td></tr>
              <tr><th>Markets</th><td>@for (m of d.markets; track m.market_id) {<div><a [routerLink]="['/markets', m.market_id]">{{ m.title }}</a></div>} @empty {<span class="muted">none</span>}</td></tr>
            </tbody></table>
          </div>
          <div class="box"><app-l2-value [value]="d.entry?.content"></app-l2-value></div>
        </div>
        <h2>Votes</h2>
        <div class="box">
          <app-chain-table [rows]="d.votes" [columns]="voteCols" [search]="voteMatches" searchPlaceholder="Voter…" sort="block" empty="No votes yet.">
            <ng-template cxCell="voter" let-x><a [routerLink]="['/address', x.voter_address]" class="mono">{{ x.voter_address }}</a></ng-template>
            <ng-template cxCell="block" let-x><a [routerLink]="['/block', x.block_height]">{{ x.block_height | number }}</a></ng-template>
          </app-chain-table>
        </div>
      }
    }
  </div>`,
})
export class TruthcoinDecisionPage implements OnInit {
  id = '';
  title: string | null = 'Decision';
  view$: Observable<Loaded<DecisionDetail>>;
  voteCols: CxColumn<DecisionDetail['votes'][number]>[] = [
    { key: 'voter', label: 'Voter', sort: x => x.voter_address },
    { key: 'vote_value', label: 'Vote', align: 'right', sort: true },
    { key: 'period_id', label: 'Period', sort: true },
    { key: 'block', label: 'Block', sort: x => x.block_height },
  ];
  voteMatches = matchAny<DecisionDetail['votes'][number]>(x => x.voter_address);

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.title = 'Decision';
        this.seo.setTitle('Decision ' + id);
      }),
      switchMap(id => featureData$(this.api, 'markets', () => this.api.feature$<DecisionDetail>('decisions', id).pipe(tap(d => {
        this.title = d.decision?.header || 'Decision';
      })))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }
}

/** /votes: the current voting period, the Votecoin holders and the decision slots' pricing */
@Component({
  selector: 'app-truthcoin-votes',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="votes"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no oracle: this page belongs to the Truthcoin explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Votes" [height]="300"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Period</div><div class="v">{{ d.status.current_period }}</div><div class="s">{{ d.status.current_period_name }} · {{ d.period?.status ?? 'no voting period' }}</div></div>
            <div class="kpi"><div class="l">Decisions to vote on</div><div class="v">{{ d.period?.decisions?.length ?? 0 | number }}</div><div class="s">in this period</div></div>
            <div class="kpi"><div class="l">Voters</div><div class="v">{{ d.voters.length | number }}</div><div class="s">{{ d.period?.stats?.active_voters ?? 0 | number }} active this period</div></div>
            <div class="kpi"><div class="l">Votes cast</div><div class="v">{{ d.period?.stats?.total_votes ?? 0 | number }}</div><div class="s">participation {{ (d.period?.stats?.participation_rate ?? 0) * 100 | number:'1.0-1' }}%</div></div>
          </div>
          @if (d.period) {
            <div class="muted small mb-2">Period {{ d.period.period_id }}: <app-timestamp [unixTime]="d.period.start_time" [hideTimeSince]="true"></app-timestamp> to <app-timestamp [unixTime]="d.period.end_time" [hideTimeSince]="true"></app-timestamp></div>
          }
          <div class="grid2">
            <div>
              <h2>Votecoin holders</h2>
              <div class="box">
                <app-chain-table [rows]="d.voters" [columns]="voterCols" [filters]="activeFilters" [search]="voterMatches" searchPlaceholder="Voter…"
                    sort="votecoin" [pageSize]="10" empty="No voters.">
                  <ng-template cxCell="address" let-x><a [routerLink]="['/address', x.address]" class="mono">{{ x.address }}</a></ng-template>
                  <ng-template cxCell="votecoin" let-x>{{ x.votecoin_balance | number:'1.0-6' }}</ng-template>
                  <ng-template cxCell="votes" let-x>{{ x.total_votes | number }}</ng-template>
                  <ng-template cxCell="active" let-x>@if (x.is_active) {<span class="status ok">active</span>}</ng-template>
                </app-chain-table>
              </div>
            </div>
            <div>
              <h2>Decision slots</h2>
              <div class="box">
                <app-chain-table [rows]="d.periods" [columns]="periodCols" sort="period_index" [asc]="true" [pageSize]="10" empty="No open periods.">
                  <ng-template cxCell="cheapest" let-p><app-l2-amount [sats]="p.cheapest_available_slot_sats"></app-l2-amount></ng-template>
                  <ng-template cxCell="tiers" let-p><span class="mono small">{{ p.slots_available_by_tier.join(' · ') }}</span></ng-template>
                </app-chain-table>
              </div>
            </div>
          </div>
          @if (d.voteTxs.length) {
            <h2>Vote transactions</h2>
            <div class="box">
              <app-chain-table [rows]="d.voteTxs" [columns]="voteTxCols" [filters]="chipsBy(d.voteTxs, 'Type', typeOf)" [search]="voteTxMatches"
                  searchPlaceholder="Voter, tx…" sort="height" empty="None.">
                <ng-template cxCell="height" let-t><a [routerLink]="['/block', t.height]">{{ t.height | number }}</a></ng-template>
                <ng-template cxCell="voter" let-t>@if (t.voter) {<a [routerLink]="['/address', t.voter]" class="mono">{{ t.voter }}</a>}</ng-template>
                <ng-template cxCell="txid" let-t><a [routerLink]="['/tx', t.txid]" class="mono">{{ shortId(t.txid) }}</a></ng-template>
              </app-chain-table>
            </div>
          }
        }
      }
    }
  </div>`,
})
export class TruthcoinVotesPage implements OnInit {
  view$: Observable<Loaded<VotesView> | 'unavailable'>;
  shortId = shortId;
  chipsBy = chipsBy;
  typeOf = (t: VotesView['voteTxs'][number]) => t.type;
  voterCols: CxColumn<VotesView['voters'][number]>[] = [
    { key: 'address', label: 'Voter' },
    { key: 'votecoin', label: 'Votecoin', align: 'right', sort: x => x.votecoin_balance },
    { key: 'votes', label: 'Votes', align: 'right', sort: x => x.total_votes },
    { key: 'active', label: '', sort: x => x.is_active ? 1 : 0 },
  ];
  activeFilters: CxFilter<VotesView['voters'][number]>[] = [{ options: [{ label: 'active', test: x => x.is_active }, { label: 'inactive', test: x => !x.is_active }] }];
  voterMatches = matchAny<VotesView['voters'][number]>(x => x.address);
  periodCols: CxColumn<VotesView['periods'][number]>[] = [
    { key: 'period_index', label: 'Period', sort: true },
    { key: 'cheapest', label: 'Cheapest slot', align: 'right', sort: p => p.cheapest_available_slot_sats },
    { key: 'tiers', label: 'Free slots by tier' },
  ];
  voteTxCols: CxColumn<VotesView['voteTxs'][number]>[] = [
    { key: 'height', label: 'Block', sort: true },
    { key: 'type', label: 'Type', sort: true },
    { key: 'voter', label: 'Voter', sort: true },
    { key: 'txid', label: 'Transaction' },
  ];
  voteTxMatches = matchAny<VotesView['voteTxs'][number]>(t => t.voter, t => t.txid);

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Votes');
    this.view$ = featureData$(this.api, 'markets', () => this.api.feature$('votes'));
  }
}
