import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, shareReplay, catchError } from 'rxjs';
import { StateService } from '@app/services/state.service';
import { ChainInfo, ChainTxInfo, DrivechainBlock, DrivechainBlockSummary, DrivechainSummary } from '@app/chain/chain.interfaces';

/** The chain profiles' API, /api/v1/chain, /api/v1/drivechain/* */
@Injectable({ providedIn: 'root' })
export class ChainApiService {
  private base: string;
  private chain: Observable<ChainInfo | null>;

  constructor(private http: HttpClient, private stateService: StateService) {
    let host = '';
    if (!this.stateService.isBrowser) {
      host = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
    this.base = host + '/api/v1/';
  }

  get<T>(path: string, params?: Record<string, string | number | null | undefined>): Observable<T> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== null && v !== undefined && v !== '') {
        p = p.set(k, String(v));
      }
    }
    return this.http.get<T>(this.base + path, { params: p });
  }

  drivechainSummary$(): Observable<DrivechainSummary> {
    return this.get('drivechain/summary');
  }

  drivechainBlock$(hashOrHeight: string | number): Observable<DrivechainBlock> {
    return this.get('drivechain/block/' + hashOrHeight);
  }

  drivechainBlocks$(to: number | null, count: number): Observable<DrivechainBlockSummary[]> {
    return this.get('drivechain/blocks', { to, count });
  }

  events$(kind: string, slot: number | null, before: number | null, limit = 25): Observable<any[]> {
    return this.get('drivechain/events/' + kind, { slot, before, limit });
  }

  tx$(txid: string): Observable<ChainTxInfo | null> {
    return this.get<ChainTxInfo | null>('drivechain/tx/' + txid).pipe(catchError(() => of(null)));
  }

  /** this explorer's chain and network, and the other networks' explorers (memoized per page load) */
  chain$(): Observable<ChainInfo | null> {
    if (!this.chain) {
      this.chain = this.get<ChainInfo>('chain').pipe(catchError(() => of(null)), shareReplay(1));
    }
    return this.chain;
  }

  /** The chain module's own routes (/api/v1/chain/<path>) */
  module$<T>(path: string, params?: Record<string, string | number | null | undefined>): Observable<T> {
    return this.get('chain/' + path, params);
  }
}
