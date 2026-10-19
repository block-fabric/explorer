import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, catchError, debounceTime, of, switchMap, combineLatest, map } from 'rxjs';
import { SharedModule } from '@app/shared/shared.module';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';

/** BitNames: every name (/names) and one name with its records and history (/name/:id) */
@Component({
  selector: 'app-bitnames-names',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SharedModule],
  styleUrls: ['../../components/module-page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="container-xl mp">
    <ng-container *ngIf="!nameId; else detail">
      <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> Names</h1>
      <div class="sub">Names on BitNames point to addresses, keys and DNS records, and are owned like coins.</div>
      <div class="kpis" *ngIf="info$ | async as i">
        <div class="kpi"><div class="l">Names</div><div class="v">{{ i.names | number }}</div></div>
        <div class="kpi"><div class="l">Reservations</div><div class="v">{{ i.reservations | number }}</div><div class="s">commitments waiting to be revealed</div></div>
        <div class="kpi"><div class="l">Reveal depth</div><div class="v">{{ i.revealdepth }}</div><div class="s">blocks before a reservation can register</div></div>
        <div class="kpi"><div class="l">ICANN names</div><div class="v">{{ i.icann ? 'on' : 'off' }}</div></div>
      </div>
      <input class="form-control search" placeholder="Search names" [ngModel]="match$.value" (ngModelChange)="match$.next($event)">
      <div class="box">
        <table class="table table-borderless table-sm">
          <thead><tr><th>Name</th><th>Seq</th><th>Registered</th><th>Points to</th><th>Owner</th></tr></thead>
          <tbody>
            <tr *ngFor="let n of names$ | async">
              <td><a [routerLink]="['/name' | relativeUrl, n.name || ('0x' + n.namehash)]"><b>{{ n.name || (n.namehash | slice:0:16) + '…' }}</b></a></td>
              <td class="mono muted">{{ n.seq }}</td>
              <td><a [routerLink]="['/tx' | relativeUrl, n.registration]">{{ n.registered | number }}</a></td>
              <td class="muted">{{ pointsTo(n) }}</td>
              <td class="mono"><a *ngIf="n.owner?.address" [routerLink]="['/address' | relativeUrl, n.owner.address]">{{ n.owner.address | slice:0:14 }}…</a></td>
            </tr>
          </tbody>
        </table>
      </div>
    </ng-container>

    <ng-template #detail>
      <ng-container *ngIf="name$ | async as d; else loadingName">
        <ng-container *ngIf="d.name as n">
          <h1><app-svg-images name="chain-mark" [fill]="profile.id" width="30" height="30" class="cmark"></app-svg-images> {{ n.name || 'Unnamed' }}</h1>
          <div class="sub mono">{{ n.namehash }}</div>
          <div class="grid2">
            <div class="box">
              <table class="table table-borderless table-sm">
                <tr><td class="muted">Sequence</td><td>{{ n.seq }}</td></tr>
                <tr><td class="muted">Registered</td><td>block {{ n.registered | number }} · <a [routerLink]="['/tx' | relativeUrl, n.registration]" class="mono">{{ n.registration | slice:0:16 }}…</a></td></tr>
                <tr *ngIf="n.parent"><td class="muted">Parent</td><td><a [routerLink]="['/name' | relativeUrl, '0x' + n.parent]" class="mono">{{ n.parent | slice:0:16 }}…</a> · label {{ n.label }}</td></tr>
                <tr><td class="muted">Owner</td><td><a *ngIf="n.owner?.address" [routerLink]="['/address' | relativeUrl, n.owner.address]" class="mono">{{ n.owner.address }}</a></td></tr>
                <tr *ngFor="let kv of entries(n.data)"><td class="muted">{{ kv[0] }}</td><td class="mono">{{ kv[1] }}</td></tr>
              </table>
            </div>
            <div class="box">
              <h5>History</h5>
              <table class="table table-borderless table-sm">
                <thead><tr><th>Field</th><th>Value</th><th>Block</th></tr></thead>
                <tbody>
                  <ng-container *ngFor="let f of entries(d.history)">
                    <tr *ngFor="let h of asArray(f[1])"><td class="muted">{{ f[0] }}</td><td class="mono">{{ stringify(h.value) }}</td>
                      <td><a [routerLink]="['/tx' | relativeUrl, h.txid]">{{ h.height | number }}</a></td></tr>
                  </ng-container>
                </tbody>
              </table>
            </div>
          </div>
        </ng-container>
      </ng-container>
      <ng-template #loadingName><div class="skeleton-loader mt-4"></div></ng-template>
    </ng-template>
  </div>`,
})
export class BitnamesNamesPage implements OnInit {
  profile = PROFILE;
  nameId: string | null = null;
  match$ = new BehaviorSubject<string>('');
  info$: Observable<any>;
  names$: Observable<any[]>;
  name$: Observable<any>;

  constructor(private api: ChainApiService, private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.info$ = this.api.feature$('info').pipe(catchError(() => of(null)));
    this.names$ = this.match$.pipe(debounceTime(250), switchMap(m => this.api.feature$<any[]>('names', { count: 200, match: m || null }).pipe(catchError(() => of([])))));
    this.name$ = this.route.paramMap.pipe(
      map(p => p.get('id')),
      switchMap(id => {
        this.nameId = id;
        return id ? this.api.feature$('name/' + encodeURIComponent(id)).pipe(catchError(() => of(null))) : of(null);
      }),
    );
  }

  pointsTo(n: any): string {
    const d = n.data || {};
    return [d.ipv4, d.ipv6 && (d.ipv6.ip || d.ipv6), d.records ? 'DNS records' : null, d.encryptionkey ? 'encryption key' : null, d.paymailfee != null ? 'paymail' : null]
      .filter(Boolean).join(' · ');
  }

  entries(o: any): [string, any][] {
    return Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]);
  }

  asArray(v: any): any[] {
    try { return Array.isArray(v) ? v : JSON.parse(v); } catch (e) { return []; }
  }

  stringify(v: any): string {
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}
