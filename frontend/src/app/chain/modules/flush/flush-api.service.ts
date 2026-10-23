import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, startWith, switchMap, throwError } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';
import { basePath } from '@app/chain/base-path';

/** A request's state for a template: { loading } first, then { data } or { error } */
export interface FlushLoaded<T> {
  loading: boolean;
  data?: T;
  error?: FlushError;
}

export interface FlushError {
  status: number;
  message: string;
  /** the API has no such route on this network (a list's 404, 501) */
  unavailable: boolean;
}

export function flushError(e: any): FlushError {
  const status = e instanceof HttpErrorResponse ? e.status : (e?.status ?? 0);
  const body = e?.error;
  const text = typeof body === 'string' ? null : (body?.error?.message ?? (typeof body?.error === 'string' ? body.error : null));
  const message = status === 0 ? 'The explorer\'s backend cannot be reached'
    : status === 404 ? 'Not found'
    : status === 400 ? 'Not a valid id or query'
    : status === 429 ? 'Too many requests: try again in a few seconds'
    : status === 501 ? 'Not served by this network\'s API'
    : status === 502 || status === 503 ? 'Flush\'s public API is not reachable right now'
    : (text ? String(text) : `Error ${status}`);
  return { status, message, unavailable: status === 501 || (status === 404 && /no such resource/i.test(String(text ?? ''))) };
}

export function flushLoaded<T>(obs: Observable<T>): Observable<FlushLoaded<T>> {
  return obs.pipe(
    map(data => ({ loading: false, data })),
    catchError(e => of({ loading: false, error: flushError(e) })),
    startWith({ loading: true }),
  );
}

/** as flushLoaded, without the loading state first (a request repeated in place) */
export function flushResult<T>(obs: Observable<T>): Observable<FlushLoaded<T>> {
  return obs.pipe(map(data => ({ loading: false, data })), catchError(e => of({ loading: false, error: flushError(e) })));
}

type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * Flush's data (chains/FLUSH-API.md): the Flush node's allowlisted read RPCs (GET /api/v1/flush/rpc/:method), a
 * transaction's and a block's Flush fields, asset logos, its public DEX API through the explorer's backend
 * (GET /api/v1/flush/market/<path>, read-only and allowlisted), and its BMM and peg from the eCash explorer's drivechain API for its slot (the
 * mainchainExplorer of GET /api/v1/chain: /api/v1/drivechain/cockpit?slot=, /events/<kind>?slot=).
 */
@Injectable({ providedIn: 'root' })
export class FlushApiService {
  /** the eCash explorer of this network, null: none */
  readonly mainchain$: Observable<string | null>;

  constructor(private http: HttpClient, private api: ChainApiService) {
    this.mainchain$ = this.api.chain$().pipe(
      map(c => (c?.mainchainExplorer ?? c?.explorers?.['ecash'] ?? null)?.replace(/\/+$/, '') ?? null),
      shareReplay(1),
    );
  }

  /** GET /api/v1/flush/market/<path>: the public API's /api/v1/<path> */
  market$<T>(path: string, params?: Params): Observable<T> {
    const p: Record<string, string> = {};
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== null && v !== undefined && v !== '' && v !== false) {
        p[k] = String(v);
      }
    }
    return this.api.get<T>('flush/market/' + path, p);
  }

  /** a path segment of the API: an id, a ticker, an address */
  seg(s: string): string {
    return encodeURIComponent(String(s ?? ''));
  }

  /** the image of an asset's logo (getassetlogo's PNG or JPEG: GET /api/v1/flush/logo/:asset), by asset id */
  logoUrl(assetId: string): string {
    return basePath() + '/api/v1/flush/logo/' + this.seg(assetId);
  }

  /** an allowlisted read RPC of the Flush node (GET /api/v1/flush/rpc/:method?args=<JSON array>), its JSON as is */
  rpc$<T>(method: string, ...args: unknown[]): Observable<T> {
    while (args.length && args[args.length - 1] === undefined) {
      args.pop();
    }
    return this.api.get<T>('flush/rpc/' + method, args.length ? { args: JSON.stringify(args) } : undefined);
  }

  /** what a transaction does on Flush (GET /api/v1/flush/tx/:txid): asset, peg and stake operations */
  tx$<T>(txid: string): Observable<T> {
    return this.api.get<T>('flush/tx/' + this.seg(txid));
  }

  /** a block's stake fields (GET /api/v1/flush/block/:hash): kind, slot, proposer, anchor, finality */
  block$<T>(hash: string): Observable<T> {
    return this.api.get<T>('flush/block/' + this.seg(hash));
  }

  /** the stake fields of up to 30 blocks (GET /api/v1/flush/blocks?hashes=): hash -> fields, null for one not known */
  blocks$<T>(hashes: string[]): Observable<Record<string, T | null>> {
    return this.api.get<Record<string, T | null>>('flush/blocks', { hashes: hashes.join(',') });
  }

  /** the eCash explorer's drivechain API (GET <mainchainExplorer>/api/v1/drivechain/<path>), this chain's slot */
  drivechain$<T>(path: string, params?: Params): Observable<T> {
    return this.mainchain$.pipe(
      switchMap(base => {
        if (!base) {
          return throwError(() => ({ status: 404, error: null }));
        }
        let p = new HttpParams().set('slot', String(PROFILE.slot));
        for (const [k, v] of Object.entries(params ?? {})) {
          if (v !== null && v !== undefined && v !== '') {
            p = p.set(k, String(v));
          }
        }
        return this.http.get<T>(base + '/api/v1/drivechain/' + path, { params: p });
      }),
    );
  }
}
