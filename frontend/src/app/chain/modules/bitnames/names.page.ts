import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, map, switchMap, tap } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { L2ApiService } from '@app/chain/l2/l2-api.service';
import { Loaded } from '@app/chain/l2/l2.interfaces';
import { shortId } from '@app/chain/l2/l2-common';
import { FEATURE_PAGE_IMPORTS, featureData$ } from '@app/chain/l2/features/feature-kit';

// GET /api/v1/l2/feature/names[/:id] (chains/L2-API.md)
interface Ref { height: number; time: number | null; txid: string }
export interface NameItem {
  id: string;
  /** the plain name, when revealed (BatchIcann) or a candidate hashes to the id */
  name: string | null;
  seq: string | null;
  /** bitname_data: commitment (hex), socket addresses, encryption and signing keys, paymail fee */
  data: any;
  owner: string | null;
  registered: Ref | null;
  updates: number;
  transfers: number;
  last: Ref | null;
}
export interface NameEvent extends Ref {
  kind: 'reservation' | 'registration' | 'update' | 'transfer' | 'icann';
  address: string | null;
  data: any;
}

const RECORDS = ['commitment', 'socket_addr_v4', 'socket_addr_v6', 'encryption_pubkey', 'signing_pubkey', 'paymail_fee_sats'];

/** /names: every registered BitName with its owner, records and history counts */
@Component({
  selector: 'app-bitnames-names',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="names"></app-l2-feature-head>
    @if (view$ | async; as v) {
      @if (v === 'unavailable') {
        <div class="alert alert-info">This sidechain has no names: this page belongs to the BitNames explorer.</div>
      } @else {
        <app-l2-state [state]="v" what="Names" [height]="400"></app-l2-state>
        @if (v.data; as d) {
          <div class="kpis">
            <div class="kpi"><div class="l">Names</div><div class="v">{{ d.items.length | number }}</div><div class="s">registered</div></div>
            <div class="kpi"><div class="l">Revealed</div><div class="v">{{ revealed(d.items) | number }}</div><div class="s">with a known plain name</div></div>
            <div class="kpi"><div class="l">Reservations</div><div class="v">{{ d.reservations.total | number }}</div><div class="s">{{ d.reservations.open | number }} still open</div></div>
            <div class="kpi"><div class="l">With records</div><div class="v">{{ withRecords(d.items) | number }}</div><div class="s">a commitment or an address</div></div>
          </div>
          <input type="search" class="form-control form-control-sm search" placeholder="Filter by name, hash, owner or record" [value]="filter" (input)="filter = $any($event.target).value">
          <div class="box">
            <table class="table table-borderless table-sm">
              <thead><tr><th>Seq</th><th>Name</th><th>Owner</th><th>Records</th><th>Registered</th><th class="text-end">Updates</th><th class="text-end">Transfers</th></tr></thead>
              <tbody>
                @for (n of filtered(d.items); track n.id) {
                  <tr>
                    <td class="muted">{{ n.seq }}</td>
                    <td><app-l2-asset [id]="n.id" kind="name"></app-l2-asset></td>
                    <td>@if (n.owner) {<a [routerLink]="['/address', n.owner]" class="mono">{{ shortId(n.owner, 6) }}</a>} @else {<span class="muted">–</span>}</td>
                    <td class="small">
                      @for (r of records(n); track r) {<span class="pill on me-1">{{ r }}</span>} @empty {<span class="muted">none</span>}
                    </td>
                    <td>@if (n.registered) {<a [routerLink]="['/block', n.registered.height]">{{ n.registered.height | number }}</a>} @else {<span class="muted">–</span>}</td>
                    <td class="text-end">{{ n.updates | number }}</td>
                    <td class="text-end">{{ n.transfers | number }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="empty">{{ filter ? 'Nothing matches the filter.' : 'No names yet.' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          <p class="note">BitNames keeps a name's blake3 hash, not the name: a name shows in plain when an ICANN batch reveals it or a
            candidate name hashes to it, else as its short hash. Reservations commit to a name before it is registered.</p>
        }
      }
    }
  </div>`,
})
export class BitNamesNamesPage implements OnInit {
  view$: Observable<Loaded<{ items: NameItem[]; reservations: { total: number; open: number; registered: number } }> | 'unavailable'>;
  filter = '';
  shortId = shortId;

  constructor(private api: L2ApiService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setTitle('Names');
    this.view$ = featureData$(this.api, 'names', () => this.api.feature$('names'));
  }

  records(n: NameItem): string[] {
    return RECORDS.filter(k => n.data?.[k] !== null && n.data?.[k] !== undefined).map(k => k.replace(/_/g, ' ').replace('pubkey', 'key'));
  }

  revealed(items: NameItem[]): number {
    return items.filter(n => n.name).length;
  }

  withRecords(items: NameItem[]): number {
    return items.filter(n => n.data?.commitment || n.data?.socket_addr_v4 || n.data?.socket_addr_v6).length;
  }

  filtered(items: NameItem[]): NameItem[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) {
      return items;
    }
    return items.filter(n => {
      try {
        return [n.id, n.name, n.owner, n.seq, JSON.stringify(n.data)].some(x => String(x ?? '').toLowerCase().includes(q));
      } catch (e) {
        return false;
      }
    });
  }
}

/** /names/:id: one BitName: records, owner, its reservation, registration, updates and transfers */
@Component({
  selector: 'app-bitnames-name',
  standalone: true,
  imports: [...FEATURE_PAGE_IMPORTS],
  styleUrls: ['../../components/module-page.scss', '../../l2/pages/l2-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <app-l2-feature-head path="names" [id]="id" [title]="title"></app-l2-feature-head>
    @if (view$ | async; as v) {
      <app-l2-state [state]="v" what="Name" [id]="id" [height]="400"></app-l2-state>
      @if (v.data; as n) {
        <div class="grid2">
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Name</th><td>@if (n.name) {<b>{{ n.name }}</b> <span class="muted">(hashes to the id)</span>} @else {<span class="muted">not revealed: the chain keeps the name's hash</span>}</td></tr>
              <tr><th>Sequence</th><td>{{ n.seq ?? '–' }}</td></tr>
              <tr><th>Owner</th><td>@if (n.owner) {<a [routerLink]="['/address', n.owner]" class="mono">{{ n.owner }}</a>} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Registered</th><td>@if (n.registered) {block <a [routerLink]="['/block', n.registered.height]">{{ n.registered.height | number }}</a>@if (n.registered.time) {, <app-timestamp [unixTime]="n.registered.time"></app-timestamp>}} @else {<span class="muted">–</span>}</td></tr>
              <tr><th>Updates / transfers</th><td>{{ n.updates | number }} / {{ n.transfers | number }}</td></tr>
            </tbody></table>
          </div>
          <div class="box">
            <table class="kv"><tbody>
              <tr><th>Commitment</th><td class="mono">{{ n.data?.commitment ?? '–' }}</td></tr>
              <tr><th>IPv4 socket</th><td class="mono">{{ n.data?.socket_addr_v4 ?? '–' }}</td></tr>
              <tr><th>IPv6 socket</th><td class="mono">{{ n.data?.socket_addr_v6 ?? '–' }}</td></tr>
              <tr><th>Encryption key</th><td class="mono">{{ n.data?.encryption_pubkey ?? '–' }}</td></tr>
              <tr><th>Signing key</th><td class="mono">{{ n.data?.signing_pubkey ?? '–' }}</td></tr>
              <tr><th>Paymail fee</th><td>@if (n.data?.paymail_fee_sats !== null && n.data?.paymail_fee_sats !== undefined) {<app-l2-amount [sats]="n.data.paymail_fee_sats"></app-l2-amount>} @else {<span class="muted">–</span>}</td></tr>
            </tbody></table>
          </div>
        </div>
        <h2>History</h2>
        <div class="box">
          <table class="table table-borderless table-sm">
            <thead><tr><th>Block</th><th>Time</th><th>Event</th><th>To</th><th>Transaction</th></tr></thead>
            <tbody>
              @for (e of n.history; track e.txid + e.kind) {
                <tr>
                  <td><a [routerLink]="['/block', e.height]">{{ e.height | number }}</a></td>
                  <td>@if (e.time) {<app-timestamp [unixTime]="e.time" [hideTimeSince]="true"></app-timestamp>} @else {<span class="muted">–</span>}</td>
                  <td><span class="pill" [class.on]="e.kind === 'registration'">{{ e.kind }}</span></td>
                  <td>@if (e.address) {<a [routerLink]="['/address', e.address]" class="mono">{{ shortId(e.address, 6) }}</a>} @else {<span class="muted">–</span>}</td>
                  <td><a [routerLink]="['/tx', e.txid]" class="mono" [title]="e.txid">{{ shortId(e.txid) }}</a></td>
                </tr>
              } @empty {<tr><td colspan="5" class="empty">No history in the index.</td></tr>}
            </tbody>
          </table>
        </div>
      }
    }
  </div>`,
})
export class BitNamesNamePage implements OnInit {
  id = '';
  title: string | null = 'BitName';
  view$: Observable<Loaded<NameItem & { history: NameEvent[] }>>;
  shortId = shortId;

  constructor(private api: L2ApiService, private route: ActivatedRoute, private seo: SeoService) {}

  ngOnInit(): void {
    this.view$ = this.route.paramMap.pipe(
      map(p => String(p.get('id') ?? '')),
      tap(id => {
        this.id = id;
        this.title = 'BitName';
        this.seo.setTitle('Name ' + shortId(id));
      }),
      switchMap(id => featureData$(this.api, 'names', () => this.api.feature$<NameItem & { history: NameEvent[] }>('names', id).pipe(tap(n => {
        if (n.name) {
          this.title = n.name;
          this.seo.setTitle('Name ' + n.name);
        }
      })))),
      map(v => v === 'unavailable' ? { loading: false, error: { status: 404, message: 'Not found', building: false } } : v),
    );
  }
}
