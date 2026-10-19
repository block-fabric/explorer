import { Injectable } from '@angular/core';
import { BehaviorSubject, catchError, debounceTime, filter, merge, of, switchMap, timer } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { MODULE } from '@app/chain/profiles';
import { StateService } from '@app/services/state.service';
import { basePath } from '@app/chain/base-path';

export interface AssetMeta { ticker: string | null; label: string; display: string | null; decimals: number; logo: string | null }
export const CHN_ID = '0'.repeat(64);

/** Every asset's ticker, display name and logo (chains with a token ledger: BitAssets, Layers), refreshed with new blocks */
@Injectable({ providedIn: 'root' })
export class AssetMetaService {
  readonly enabled = !!MODULE.tokens;
  meta$ = new BehaviorSubject<Record<string, AssetMeta>>({});

  constructor(private api: ChainApiService, private stateService: StateService) {
    if (!this.enabled) { return; }
    merge(timer(0, 120000), this.stateService.blocks$.pipe(filter(b => !!b?.length), debounceTime(5000))).pipe(
      switchMap(() => this.api.get<Record<string, AssetMeta>>('sidechain/asset-meta').pipe(catchError(() => of(null)))),
    ).subscribe((m) => { if (m) { this.meta$.next(m); } });
  }

  get(id: string): AssetMeta | undefined {
    return this.meta$.value[id];
  }

  /** the logo's URL (an <img> is not an HttpClient request: the sub-path is added here); null without a logo */
  logoUrl(id: string): string | null {
    const m = this.get(id);
    return m?.logo ? `${basePath()}/api/v1/sidechain/asset/${id}/logo?h=${m.logo}` : null;
  }
}
