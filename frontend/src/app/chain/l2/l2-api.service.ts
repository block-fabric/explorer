import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, startWith } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { ChainInfo } from '@app/chain/chain.interfaces';
import { L2Feature } from '@app/chain/chain-module';
import { MODULE } from '@app/chain/profiles';
import {
  L2Address, L2Block, L2BlockSummary, L2Deposit, L2Error, L2SearchResult, L2Summary, L2Tx, L2Withdrawal, Loaded,
} from '@app/chain/l2/l2.interfaces';

/** A failed request as the pages show it: the backend's { error } text, and whether the index is still being built */
export function l2Error(e: any): L2Error {
  const status = e instanceof HttpErrorResponse ? e.status : (e?.status ?? 0);
  const body = e?.error;
  const text = typeof body === 'string' ? body : (body?.error ?? body?.message ?? null);
  const message = status === 503 ? 'The index is still being built'
    : status === 404 ? (text || 'Not found')
    : status === 400 ? (text || 'Invalid id')
    : status === 0 ? 'The explorer\'s backend cannot be reached'
    : (text || `Error ${status}`);
  return { status, message: String(message), building: status === 503 };
}

/** The request as a template state: { loading } first, then { data } or { error } */
export function loaded<T>(obs: Observable<T>): Observable<Loaded<T>> {
  return obs.pipe(
    map(data => ({ loading: false, data })),
    catchError(e => of({ loading: false, error: l2Error(e) })),
    startWith({ loading: true }),
  );
}

/** The sidechain explorer's API: GET /api/v1/l2/* (chains/L2-API.md) and /api/v1/chain */
@Injectable({ providedIn: 'root' })
export class L2ApiService {
  /** the eCash explorer of this network (mainchain blocks, transactions and addresses link there), null: none */
  readonly mainchain$: Observable<string | null>;
  /** the feature pages this chain has: the backend's list, the module's until it answers */
  readonly features$: Observable<string[]>;

  constructor(private api: ChainApiService) {
    this.mainchain$ = this.api.chain$().pipe(
      map(c => (c?.mainchainExplorer ?? c?.explorers?.['ecash'] ?? null)?.replace(/\/+$/, '') ?? null),
      shareReplay(1),
    );
    this.features$ = this.api.chain$().pipe(
      map(c => c?.features ?? MODULE.features ?? []),
      startWith((MODULE.features ?? []) as L2Feature[] as string[]),
      shareReplay(1),
    );
  }

  chain$(): Observable<ChainInfo | null> {
    return this.api.chain$();
  }

  summary$(): Observable<L2Summary> {
    return this.api.get('l2/summary');
  }

  blocks$(before: number | null, limit = 25): Observable<L2BlockSummary[]> {
    return this.api.get('l2/blocks', { before, limit });
  }

  block$(hashOrHeight: string | number): Observable<L2Block> {
    return this.api.get('l2/block/' + encodeURIComponent(String(hashOrHeight)));
  }

  tx$(txid: string): Observable<L2Tx> {
    return this.api.get('l2/tx/' + encodeURIComponent(txid));
  }

  address$(address: string, before: number | null, limit = 25): Observable<L2Address> {
    return this.api.get('l2/address/' + encodeURIComponent(address), { before, limit });
  }

  deposits$(before: number | null, limit = 25): Observable<L2Deposit[]> {
    return this.api.get('l2/deposits', { before, limit });
  }

  withdrawals$(before: number | null, limit = 25): Observable<L2Withdrawal[]> {
    return this.api.get('l2/withdrawals', { before, limit });
  }

  search$(query: string): Observable<L2SearchResult> {
    return this.api.get('l2/search/' + encodeURIComponent(query));
  }

  /** the eCash explorer's drivechain cockpit for this slot (GET /api/v1/l2/bmm/cockpit), window in eCash blocks */
  bmmCockpit$(window: number): Observable<any> {
    return this.api.get('l2/bmm/cockpit', { window });
  }

  /** the eCash explorer's drivechain events of this slot: bmm, bmm-requests, deposits, withdrawals, bundles, ... */
  bmmEvents$(kind: string, before: number | null = null, limit = 40): Observable<any[]> {
    return this.api.get('l2/bmm/events/' + encodeURIComponent(kind), { before, limit });
  }

  /** a chain feature's read RPC (GET /api/v1/l2/feature/<path>): node-given shapes, lists as { items } */
  feature$<T = any>(path: string, id?: string): Observable<T> {
    return this.api.get('l2/feature/' + path + (id !== undefined ? '/' + encodeURIComponent(id) : ''));
  }
}
