import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, shareReplay, catchError, map } from 'rxjs';
import { StateService } from '@app/services/state.service';
import {
  ChainTxInfo, DrivechainBlock, DrivechainBlockSummary, DrivechainSummary, SidechainCarrier, SidechainSummary,
} from '@app/chain/chain.interfaces';

/** The chain profiles' API, /api/v1/chain, /api/v1/drivechain/*, /api/v1/sidechain/* */
@Injectable({ providedIn: 'root' })
export class ChainApiService {
  private base: string;
  private carriers = new Map<string, Observable<SidechainCarrier | null>>();

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

  sidechainSummary$(): Observable<SidechainSummary> {
    return this.get('sidechain/summary');
  }

  /** The Chains block that carried a sidechain block (memoized per page load) */
  carrier$(sideBlockHash: string): Observable<SidechainCarrier | null> {
    if (!this.carriers.has(sideBlockHash)) {
      this.carriers.set(sideBlockHash, this.get<{ carrier: SidechainCarrier | null }>('sidechain/block/' + sideBlockHash).pipe(
        map(v => v.carrier),
        catchError(() => of(null)),
        shareReplay(1),
      ));
    }
    return this.carriers.get(sideBlockHash)!;
  }

  carriers$(hashes: string[]): Observable<Record<string, SidechainCarrier | null>> {
    return this.get('sidechain/blocks', { hashes: hashes.join(',') });
  }

  /** Per-sidechain feature routes (/api/v1/sidechain/<path>) */
  feature$<T>(path: string, params?: Record<string, string | number | null | undefined>): Observable<T> {
    return this.get('sidechain/' + path, params);
  }
}
