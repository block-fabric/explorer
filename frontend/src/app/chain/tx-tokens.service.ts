import { Injectable } from '@angular/core';
import { BehaviorSubject, catchError, of } from 'rxjs';
import { ChainApiService } from '@app/chain/chain-api.service';
import { MODULE } from '@app/chain/profiles';

export interface TxToken { kind: string; id: string; label: string; amount: string }
export interface TxTokens { vin: Record<number, TxToken>; vout: Record<number, TxToken> }

/**
 * The tokens on the inputs and outputs of transactions (chains whose module keeps a token ledger: BitAssets, Layers),
 * asked in batches for the transactions a list shows. `version$` ticks when new ones arrive.
 */
@Injectable({ providedIn: 'root' })
export class TxTokensService {
  readonly enabled = !!MODULE.tokens;
  private known = new Map<string, TxTokens | null>();
  private queue = new Set<string>();
  private timer: any = null;
  version$ = new BehaviorSubject<number>(0);

  constructor(private api: ChainApiService) {}

  get(txid: string): TxTokens | null | undefined {
    return this.known.get(txid);
  }

  request(txids: string[]): void {
    if (!this.enabled) { return; }
    for (const t of txids) {
      if (!this.known.has(t)) { this.queue.add(t); }
    }
    if (this.queue.size && !this.timer) {
      this.timer = setTimeout(() => this.flush(), 30);
    }
  }

  private flush(): void {
    this.timer = null;
    const batch = [...this.queue].slice(0, 50);
    batch.forEach(t => this.queue.delete(t));
    this.api.get<Record<string, TxTokens>>('sidechain/tx-tokens', { txids: batch.join(',') }).pipe(catchError(() => of(null))).subscribe((res) => {
      if (res) {
        for (const t of batch) { this.known.set(t, res[t] ?? null); }
        this.version$.next(this.version$.value + 1);
      } else {
        // the ledger may still be building: ask again later
        setTimeout(() => this.request(batch), 10000);
      }
      if (this.queue.size) { this.flush(); }
    });
  }
}
