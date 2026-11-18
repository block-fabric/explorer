import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Observable, Subject, catchError, combineLatest, map, of, switchMap, takeUntil, timer } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';
import { CxColumn, CxFilter } from '@app/chain/components/chain-table/chain-table.component';

// GET /api/v1/l2/feature/game: the node's game_state (sidepot-node app/rpc_server.rs game_json)
interface GameSnapshot {
  l1_height: number; clock: number; round: number; deadline: number; price_sats: number; pot_sats: number;
  bonus_pool_sats: number; streak: { producer: string; blocks: number } | null; accounts: number;
}
export interface GameView extends Partial<GameSnapshot> {
  started: boolean; at: number; stale: boolean;
  start_height?: number | null; to_settle?: number | null; peg_waiting?: number | null; mempool_txs?: number | null;
  preview?: GameSnapshot | null;
}

// GET /api/v1/chain/sidepot/moves on the eCash explorer (backend chain/sidepot-moves.ts)
interface Move {
  txid: string; vout: number; height: number; time: number; kind: 'buy' | 'cashout'; player: string; nonce: number; expires: number;
  round?: number; keys?: number; maxPrice?: number; amount?: number; dest?: string; signed: boolean;
}
interface Moves { start: number; scannedTo: number | null; counts: { buys: number; cashouts: number; unsigned: number; players: number }; moves: Move[] }

interface Deposit { txid: string; vout: number; amount: number; account: string; mainHeight: number; height: number; time: number | null }
interface Deposits { count: number; amount: number; items: Deposit[] }

interface AccountState { balance_sats: number; keys: number; nonce: number }
// GET feature/game/account/:key?preview=1: the settled account and the node's preview to the eCash tip, or null
type Account = (AccountState & { preview: AccountState | null }) | null;

const GAME_START = 984960;
const KEY = /^[0-9a-f]{64}$/;

/** /game: Sidepot's key game, from its node (game_state, game_account), its index (game deposits) and eCash (moves) */
@Component({
  selector: 'app-sidepot-game',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .lookup { display: flex; gap: 8px; max-width: 760px; margin: 6px 0 4px; input { flex: 1; font-family: monospace; } }
    .acct { display: flex; flex-wrap: wrap; gap: 24px; margin: 8px 0 4px; .l { font-size: 0.75rem; color: var(--transparent-fg); } }
    .preview { font-size: 0.85rem; color: var(--transparent-fg); margin: 2px 0 10px; }
    .ok { color: #3bd16f; } .bad { color: #ff6b6b; }
    .key { font-family: monospace; }
  `],
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="game"></app-l2-feature-head>
    @if (game$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This explorer has no game page.</div>
      } @else {
        <app-l2-state [state]="v" what="The game" [height]="160"></app-l2-state>
        @if (v.data; as g) {
          @if (!begun(g)) {
            <div class="alert alert-info">The game starts at eCash block {{ (g.start_height ?? start) | number }}: its first round opens with keys at
              <app-l2-amount [sats]="g.price_sats ?? 0"></app-l2-amount> and {{ ticksLeft(g) | number }} ticks on the clock.</div>
          } @else {
            <div class="kpis">
              <div class="kpi"><div class="l">Pot</div><div class="v">{{ ecx(g.pot_sats) }}</div><div class="s">round {{ g.round | number }} · {{ g.pot_sats | number }} sats</div></div>
              <div class="kpi"><div class="l">Key price</div><div class="v"><app-l2-amount [sats]="g.price_sats ?? 0"></app-l2-amount></div><div class="s">rises with each eCash block holding a buy</div></div>
              <div class="kpi"><div class="l">Time left</div><div class="v">{{ ticksLeft(g) | number }}</div><div class="s">ticks (eCash blocks with transactions) · deadline {{ g.deadline | number }}</div></div>
              <div class="kpi"><div class="l">Bonus pool</div><div class="v">{{ ecx(g.bonus_pool_sats) }}</div>
                <div class="s">@if (g.streak; as s) {streak: <span class="key" [title]="s.producer">{{ shortId(s.producer) }}</span>, {{ s.blocks }} blocks} @else {no streak}</div></div>
              <div class="kpi"><div class="l">Game accounts</div><div class="v">{{ g.accounts | number }}</div><div class="s">settled to eCash block {{ g.l1_height | number }}</div></div>
            </div>
            @if (g.preview; as p) {
              @if (p.l1_height !== g.l1_height) {
                <p class="preview">As of eCash block {{ p.l1_height | number }}, before a Sidepot block settles it: pot {{ ecx(p.pot_sats) }},
                  key price <app-l2-amount [sats]="p.price_sats"></app-l2-amount>, round {{ p.round | number }}, {{ p.deadline - p.clock | number }} ticks left.
                  @if (g.to_settle) { {{ g.to_settle | number }} eCash blocks with moves or deposits wait for a Sidepot block.}</p>
              }
            }
            @if (g.stale) {<p class="preview">The node is slow to answer: this is its answer of <app-time kind="since" [time]="g.at"></app-time>.</p>}
          }
        }
      }
    }

    <h2>Game account</h2>
    <form class="lookup" (submit)="lookup(acct.value); $event.preventDefault()">
      <input #acct class="form-control form-control-sm" [value]="account$.value ?? ''" placeholder="Account key: 64 hex characters (the part after spot:)" spellcheck="false">
      <button class="btn btn-sm btn-primary" type="submit">Look up</button>
    </form>
    @if (account$ | async; as key) {
      @if (accountData$ | async; as a) {
        @if (a === 'error') {
          <div class="alert alert-warning">The node did not answer for this account.</div>
        } @else {
          @if (accountState(a); as s) {
            <div class="acct">
              <div><div class="l">Balance</div><app-l2-amount [sats]="s.balance_sats"></app-l2-amount></div>
              <div><div class="l">Keys this round</div>{{ s.keys | number }}</div>
              <div><div class="l">Last nonce</div>{{ s.nonce | number }}</div>
              @if (accountPreview(a); as p) {
                @if (p.balance_sats !== s.balance_sats || p.keys !== s.keys) {
                  <div><div class="l">At the eCash tip</div><app-l2-amount [sats]="p.balance_sats"></app-l2-amount> · {{ p.keys | number }} keys</div>
                }
              }
            </div>
          } @else {
            <p class="preview">The game has no account for <span class="key">{{ key }}</span>: one opens with a deposit to <span class="key">spot:{{ key }}</span>.</p>
          }
          <p class="preview"><a href="javascript:void(0)" (click)="lookup('')">all accounts' moves</a></p>
        }
      }
    }

    <h2>Moves posted on eCash @if (account$ | async) {<span class="muted small">of this account</span>}</h2>
    @if (moves$ | async; as m) {
      @if (m === 'error') {
        <div class="alert alert-warning">The eCash explorer did not answer.</div>
      } @else {
        <p class="preview">{{ m.counts.buys | number }} {{ m.counts.buys === 1 ? 'buy' : 'buys' }} and {{ m.counts.cashouts | number }} {{ m.counts.cashouts === 1 ? 'cashout' : 'cashouts' }} by {{ m.counts.players | number }} {{ m.counts.players === 1 ? 'account' : 'accounts' }},
          read from eCash block {{ m.start | number }} to {{ m.scannedTo === null ? '…' : (m.scannedTo | number) }}.
          @if (m.counts.unsigned) { {{ m.counts.unsigned | number }} not signed for this Sidepot (ignored by the game).}</p>
        <div class="box">
          <app-chain-table [rows]="m.moves" [columns]="moveCols" [filters]="moveFilters" [search]="moveMatches" searchPlaceholder="Account, transaction…"
              sort="height" empty="No moves posted yet." [trackBy]="moveKey">
            <ng-template cxCell="height" let-x><a [href]="(main$ | async) + '/block/' + x.height">{{ x.height | number }}</a></ng-template>
            <ng-template cxCell="time" let-x><app-timestamp [unixTime]="x.time" [hideTimeSince]="true"></app-timestamp></ng-template>
            <ng-template cxCell="kind" let-x>{{ x.kind === 'buy' ? 'Buy' : 'Cashout' }}@if (!x.signed) {<span class="bad small ms-1" title="its signature is not the account's for this Sidepot: the game ignores it">unsigned</span>}</ng-template>
            <ng-template cxCell="player" let-x><a href="javascript:void(0)" class="key" [title]="x.player" (click)="lookup(x.player)">{{ shortId(x.player) }}</a></ng-template>
            <ng-template cxCell="what" let-x>
              @if (x.kind === 'buy') {{{ x.keys | number }} keys, round {{ x.round | number }}, at most <app-l2-amount [sats]="x.maxPrice"></app-l2-amount> each}
              @else {@if (x.amount) {<app-l2-amount [sats]="x.amount"></app-l2-amount>} @else {everything} to <a [routerLink]="['/address', x.dest]" class="mono">{{ shortId(x.dest) }}</a>}
            </ng-template>
            <ng-template cxCell="nonce" let-x>{{ x.nonce | number }}</ng-template>
            <ng-template cxCell="txid" let-x><a [href]="(main$ | async) + '/tx/' + x.txid" class="mono" [title]="x.txid">{{ shortId(x.txid) }}</a></ng-template>
          </app-chain-table>
        </div>
        <p class="note">A move is a signed entry in an eCash transaction's OP_RETURN output. What is listed is what was posted: the game takes a
          move if the account's balance, nonce, round, price and expiry allow it, and every Sidepot block must process the moves of the eCash blocks it settles.</p>
      }
    }

    <h2>Deposits to game accounts</h2>
    @if (deposits$ | async; as d) {
      @if (d === 'error') {
        <div class="alert alert-warning">The index did not answer.</div>
      } @else {
        <p class="preview">{{ d.count | number }} deposits, <app-l2-amount [sats]="d.amount"></app-l2-amount> in all: BIP300 deposits addressed spot:&lt;account&gt;, credited to the account instead of making a coin.</p>
        <div class="box">
          <app-chain-table [rows]="d.items" [columns]="depositCols" sort="height" empty="No deposits to game accounts yet.">
            <ng-template cxCell="height" let-x><a [routerLink]="['/block', x.height]">{{ x.height | number }}</a></ng-template>
            <ng-template cxCell="mainHeight" let-x><a [href]="(main$ | async) + '/block/' + x.mainHeight">{{ x.mainHeight | number }}</a></ng-template>
            <ng-template cxCell="account" let-x><a href="javascript:void(0)" class="key" [title]="x.account" (click)="lookup(x.account)">{{ shortId(x.account) }}</a></ng-template>
            <ng-template cxCell="amount" let-x><app-l2-amount [sats]="x.amount"></app-l2-amount></ng-template>
            <ng-template cxCell="txid" let-x><a [href]="(main$ | async) + '/tx/' + x.txid" class="mono" [title]="x.txid">{{ shortId(x.txid) }}:{{ x.vout }}</a></ng-template>
          </app-chain-table>
        </div>
      }
    }
  </div>`,
})
export class SidepotGamePage implements OnInit, OnDestroy {
  start = GAME_START;
  shortId = shortId;
  game$: Observable<Loaded<GameView> | 'unavailable'>;
  account$ = new BehaviorSubject<string | null>(null);
  accountData$: Observable<{ account: Account } | 'error'>;
  moves$: Observable<Moves | 'error'>;
  /** the eCash explorer's URL (its API lists the moves; its pages show the eCash blocks and txs) */
  main$: Observable<string>;
  deposits$: Observable<Deposits | 'error'>;
  private destroy$ = new Subject<void>();

  moveCols: CxColumn<Move>[] = [
    { key: 'height', label: 'eCash block', sort: true },
    { key: 'time', label: 'Time', sort: true, hide: 'md' },
    { key: 'kind', label: 'Move', sort: true },
    { key: 'player', label: 'Account' },
    { key: 'what', label: 'What' },
    { key: 'nonce', label: 'Nonce', align: 'right', sort: true, hide: 'lg' },
    { key: 'txid', label: 'Transaction', hide: 'md' },
  ];
  moveFilters: CxFilter<Move>[] = [{ options: [{ label: 'Buys', test: x => x.kind === 'buy' }, { label: 'Cashouts', test: x => x.kind === 'cashout' }] }];
  moveMatches = (x: Move, q: string) => x.player.includes(q) || x.txid.includes(q) || (x.dest ?? '').toLowerCase().includes(q);
  moveKey = (x: Move) => x.txid + ':' + x.vout;
  depositCols: CxColumn<Deposit>[] = [
    { key: 'height', label: 'Sidepot block', sort: true },
    { key: 'mainHeight', label: 'eCash block', sort: true, hide: 'md' },
    { key: 'account', label: 'Account' },
    { key: 'amount', label: 'Amount', align: 'right', sort: true, nowrap: true },
    { key: 'txid', label: 'eCash output', hide: 'md' },
  ];

  constructor(private api: L2ApiService, private http: HttpClient, private route: ActivatedRoute, private router: Router, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Game');
    const q = String(this.route.snapshot.queryParamMap.get('account') ?? '').toLowerCase();
    this.account$.next(KEY.test(q) ? q : null);
    this.game$ = featureData$(this.api, 'game', () => timer(0, 30_000).pipe(switchMap(() => this.api.feature$<GameView>('game'))));
    // (/api/ paths go to this explorer's API: chain/base-path.ts)
    this.accountData$ = this.account$.pipe(switchMap(key => !key ? of('error' as const) : this.http.get<Account>(
      '/api/v1/l2/feature/game/account/' + key, { params: { preview: 1 } }).pipe(map(account => ({ account })), catchError(() => of('error' as const)))));
    this.main$ = this.api.mainchain$.pipe(map(u => u ?? ''));
    this.moves$ = combineLatest([this.account$, this.main$]).pipe(switchMap(([key, main]) => timer(0, 60_000).pipe(switchMap(() =>
      this.http.get<Moves>(main + '/api/v1/chain/sidepot/moves', { params: key ? { limit: 200, player: key } : { limit: 200 } }).pipe(
        catchError(() => of('error' as const)))))), takeUntil(this.destroy$));
    this.deposits$ = this.account$.pipe(switchMap(key => this.api.feature$<Deposits>('game/deposits' + (key ? '?account=' + key : '')).pipe(
      catchError(() => of('error' as const)))));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  lookup(value: string): void {
    const key = value.trim().toLowerCase().replace(/^spot:/, '');
    if (key && !KEY.test(key)) {
      return;
    }
    this.account$.next(key || null);
    void this.router.navigate([], { queryParams: { account: key || null }, replaceUrl: true });
  }

  /** sats as ECX, for the pot-sized amounts */
  ecx(sats: number | null | undefined): string {
    const v = (sats ?? 0) / 1e8;
    return v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 2 : 4 }) + ' ECX';
  }

  /** the game has settled an eCash block from its start on (before it, the node reports the opening state) */
  begun(g: GameView): boolean {
    return g.started && (g.l1_height ?? 0) >= (g.start_height ?? GAME_START);
  }

  ticksLeft(g: GameView): number {
    return Math.max(0, (g.deadline ?? 0) - (g.clock ?? 0));
  }

  /** the account as the game has settled it, or null when the game has none */
  accountState(a: { account: Account }): AccountState | null {
    return a.account;
  }

  accountPreview(a: { account: Account }): AccountState | null {
    return a.account?.preview ?? null;
  }
}
