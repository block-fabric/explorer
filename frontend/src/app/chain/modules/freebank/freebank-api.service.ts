import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, startWith, switchMap, throwError } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { PROFILE } from '@app/chain/profiles';

/** A request's state for a template: { loading } first, then { data } or { error } */
export interface FbLoaded<T> {
  loading: boolean;
  data?: T;
  error?: FbError;
}

export interface FbError {
  status: number;
  message: string;
}

/** the backend's fixed error texts (chains/FREEBANK-API.md: 400 malformed, 404 unknown, 502 node down, 503 busy) */
export function fbError(e: any): FbError {
  const status = e instanceof HttpErrorResponse ? e.status : (e?.status ?? 0);
  const message = status === 0 ? 'The explorer\'s backend cannot be reached'
    : status === 404 ? 'Not found'
    : status === 400 ? 'Not a valid id'
    : status === 429 ? 'Too many requests: try again in a few seconds'
    : status === 502 ? `The ${PROFILE.name} node is not reachable right now`
    : status === 503 ? 'The explorer is busy: try again in a few seconds'
    : `Error ${status}`;
  return { status, message };
}

export function fbLoaded<T>(obs: Observable<T>): Observable<FbLoaded<T>> {
  return obs.pipe(
    map(data => ({ loading: false, data })),
    catchError(e => of({ loading: false, error: fbError(e) })),
    startWith({ loading: true }),
  );
}

/** as fbLoaded, without the loading state first (a request repeated in place) */
export function fbResult<T>(obs: Observable<T>): Observable<FbLoaded<T>> {
  return obs.pipe(map(data => ({ loading: false, data })), catchError(e => of({ loading: false, error: fbError(e) })));
}

type Params = Record<string, string | number | boolean | null | undefined>;

/**
 * FreeBank's data (chains/FREEBANK-API.md): the FreeBank node's allowlisted read RPCs (GET /api/v1/freebank/rpc/:method:
 * houses, bills, the loan book, pools, assets, the gold fix, the peg), a transaction's credit operation
 * (GET /api/v1/freebank/tx/:txid), the BMM fields of blocks (GET /api/v1/freebank/blocks), and its BMM and peg from the
 * eCash explorer's drivechain API for its slot (the mainchainExplorer of GET /api/v1/chain: /api/v1/drivechain/*?slot=).
 */
@Injectable({ providedIn: 'root' })
export class FreebankApiService {
  /** the eCash explorer of this network, null: none */
  readonly mainchain$: Observable<string | null>;

  constructor(private http: HttpClient, private api: ChainApiService) {
    this.mainchain$ = this.api.chain$().pipe(
      map(c => (c?.mainchainExplorer ?? c?.explorers?.['ecash'] ?? null)?.replace(/\/+$/, '') ?? null),
      shareReplay(1),
    );
  }

  /** a path segment of the API: an id, a hash */
  seg(s: string | number): string {
    return encodeURIComponent(String(s ?? ''));
  }

  /** an allowlisted read RPC of the FreeBank node (GET /api/v1/freebank/rpc/:method?args=<JSON array>), its JSON as is */
  rpc$<T>(method: string, ...args: unknown[]): Observable<T> {
    while (args.length && args[args.length - 1] === undefined) {
      args.pop();
    }
    return this.api.get<T>('freebank/rpc/' + method, args.length ? { args: JSON.stringify(args) } : undefined);
  }

  /** what a transaction does on FreeBank (GET /api/v1/freebank/tx/:txid): its credit family and operation */
  tx$<T>(txid: string): Observable<T> {
    return this.api.get<T>('freebank/tx/' + this.seg(txid));
  }

  /** a block's BMM fields (GET /api/v1/freebank/block/:hash): the eCash block it was mined in, its withdrawal bundle */
  block$<T>(hash: string): Observable<T> {
    return this.api.get<T>('freebank/block/' + this.seg(hash));
  }

  /** the BMM fields of up to 30 blocks (GET /api/v1/freebank/blocks?hashes=): hash -> fields, null for one not known */
  blocks$<T>(hashes: string[]): Observable<Record<string, T | null>> {
    return this.api.get<Record<string, T | null>>('freebank/blocks', { hashes: hashes.join(',') });
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
