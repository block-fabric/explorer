import { Injectable } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { FlushApiService } from './flush-api.service';
import { assetArg } from './flush-format';

/** What the pages need to show an asset by its id: ticker, display name, decimals, whether it has a logo, its control
 *  coin (held: the supply is unlocked, its holder can mint more; none: a fixed supply) */
export interface AssetInfo {
  id: string;
  ticker: string;
  displayName: string | null;
  decimals: number;
  hasLogo: boolean;
  control: { txid: string; vout: number; address?: string } | null;
}

export const ECX_ID = '0'.repeat(64);
export const ECX_INFO: AssetInfo = { id: ECX_ID, ticker: 'ECX', displayName: 'eCash', decimals: 8, hasLogo: false, control: null };

/** The node's getasset, once per asset and page load (ECX: the chain's coin, 8 decimals) */
@Injectable({ providedIn: 'root' })
export class FlushAssetsService {
  private cache = new Map<string, Observable<AssetInfo | null>>();

  constructor(private api: FlushApiService) {}

  info$(id: string | null | undefined): Observable<AssetInfo | null> {
    const k = String(id ?? '').toLowerCase();
    if (!k || k === ECX_ID || k === 'ecx') {
      return of(ECX_INFO);
    }
    let o = this.cache.get(k);
    if (!o) {
      o = this.api.rpc$<any>('getasset', assetArg(k)).pipe(
        map(a => ({
          id: String(a?.asset ?? k), ticker: String(a?.name ?? a?.label ?? ''), displayName: a?.display_name ?? null,
          decimals: Number.isFinite(a?.decimals) ? a.decimals : 8, hasLogo: !!(a?.logo || a?.has_logo),
          control: a?.control?.txid ? a.control : null,
        })),
        catchError(() => of(null)),
        shareReplay(1),
      );
      if (this.cache.size > 500) {
        this.cache.clear();
      }
      this.cache.set(k, o);
    }
    return o;
  }
}

/** units of an asset (decodeassettx's integers) in whole units */
export function units(n: number | string | null | undefined, decimals: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? v / Math.pow(10, decimals) : NaN;
}
