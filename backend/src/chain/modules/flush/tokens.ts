import bitcoinClient from '../../../api/bitcoin/bitcoin-client';
import { IEsploraApi } from '../../../api/bitcoin/esplora-api.interface';
import logger from '../../../logger';
import { hasAssetMarker } from './markers';

/**
 * What each output of GET address/:address/utxo (and scripthash/:hash/utxo) carries on Flush besides its ECX: a field
 * `token` on each one (chains/FLUSH-API.md), for wallets.
 *
 *   token: { kind, id, amount_units } | null    kind: the node's Token::Kind (0 asset, 1 control, 2 reservation, 3 lp,
 *                                               4 receipt, 5 position, 6 order); amount_units: an integer as a string
 *   token absent                                not known: a confirmed output and a node whose gettxout has no token
 *   spendable: false                            an unconfirmed output whose token is not known yet (the result of an
 *                                               order, given when its block applies it), or not exactly (see below)
 *
 * Confirmed outputs: the node's state (gettxout's token, 7.0.1 on), so the results of swaps and launches are in it;
 * kept by outpoint and block, as an output's token does not change while it is unspent. Unconfirmed ones: the
 * transaction's marker (decodeassettx), which lists the outputs that carry a token; the others carry nothing. An amount
 * decodeassettx gives only as a JSON number past 2^53 cannot be read exactly: spendable false.
 */

export interface UtxoToken {
  kind: number;
  id: string;
  amount_units: string;
}

export type FlushUtxo = IEsploraApi.UTXO & { token?: UtxoToken | null; spendable?: boolean };

/** decodeassettx's names of the token kinds, in Token::Kind's order */
const KINDS = ['asset', 'control', 'reservation', 'lp', 'receipt', 'position', 'order'];
/** node calls at once for one request */
const CONCURRENCY = 4;
const MAX_CONFIRMED = 200000;
const MAX_MEMPOOL = 5000;
const MEMPOOL_TTL_MS = 10 * 60000;

/** what an unconfirmed transaction's outputs carry: by output, its token, null (nothing) or 'pending' (not known) */
type TxTokens = Map<number, UtxoToken | null | 'pending'>;

/** @asyncUnsafe: fn's errors pass on (annotate's fn catches its own) */
async function eachLimited<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, /** @asyncUnsafe */ async () => {
    while (next < items.length) {
      await fn(items[next++]);
    }
  }));
}

class FlushTokens {
  /** "<txid>:<vout>:<block hash>" -> its token (null: none); only answers that had the field */
  private confirmed = new Map<string, UtxoToken | null>();
  private mempool = new Map<string, { at: number; tokens: TxTokens }>();

  /** The UTXOs with their tokens; one that cannot be read is left as it is (no token field) */
  /** @asyncSafe */
  async annotate(utxos: IEsploraApi.UTXO[]): Promise<FlushUtxo[]> {
    const out: FlushUtxo[] = utxos.map(u => ({ ...u }));
    await eachLimited(out, CONCURRENCY, /** @asyncSafe: catches */ async u => {
      try {
        if (u.status?.confirmed) {
          const token = await this.confirmedToken(u);
          if (token !== undefined) {
            u.token = token;
            u.spendable = true;
          }
        } else {
          const t = (await this.txTokens(u.txid)).get(u.vout) ?? null;
          u.token = t === 'pending' ? null : t;
          u.spendable = t !== 'pending';
        }
      } catch (e) {
        logger.debug(`Flush tokens: ${u.txid}:${u.vout}: ${e instanceof Error ? e.message : e}`);
      }
    }).catch(() => undefined);
    return out;
  }

  /** undefined: not known (the node's gettxout has no token, or the output is gone) */
  /** @asyncUnsafe: annotate() catches */
  private async confirmedToken(u: IEsploraApi.UTXO): Promise<UtxoToken | null | undefined> {
    const key = `${u.txid}:${u.vout}:${u.status.block_hash ?? ''}`;
    if (this.confirmed.has(key)) {
      return this.confirmed.get(key);
    }
    const r = await bitcoinClient.call('gettxout', u.txid, u.vout, false);
    if (!r || !('token' in r)) {
      return undefined;
    }
    const t = r.token;
    const token = t ? { kind: Number(t.kind), id: String(t.id), amount_units: String(t.amount_units) } : null;
    if (this.confirmed.size >= MAX_CONFIRMED) {
      this.confirmed.delete(this.confirmed.keys().next().value as string);
    }
    this.confirmed.set(key, token);
    return token;
  }

  /** @asyncUnsafe: annotate() catches */
  private async txTokens(txid: string): Promise<TxTokens> {
    const c = this.mempool.get(txid);
    if (c && Date.now() - c.at < MEMPOOL_TTL_MS) {
      return c.tokens;
    }
    const tokens: TxTokens = new Map();
    const tx = await bitcoinClient.call('getrawtransaction', txid, true);
    if (hasAssetMarker(tx)) {
      const d = await bitcoinClient.call('decodeassettx', tx.hex);
      if (d?.error) {
        // a marker the node cannot read: none of its outputs is known
        (tx.vout ?? []).forEach((o: any) => tokens.set(Number(o.n), 'pending'));
      }
      for (const o of d?.outputs ?? []) {
        const kind = KINDS.indexOf(o.carries);
        const units = o.amount_units !== undefined ? String(o.amount_units)
          : Number.isSafeInteger(o.amount) ? String(o.amount) : null;
        tokens.set(Number(o.n), kind < 0 || units === null ? 'pending' : { kind, id: String(o.id), amount_units: units });
      }
    }
    if (this.mempool.size >= MAX_MEMPOOL) {
      this.mempool.delete(this.mempool.keys().next().value as string);
    }
    this.mempool.set(txid, { at: Date.now(), tokens });
    return tokens;
  }
}

export default new FlushTokens();
