import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import config from '../config';
import logger from '../logger';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import mempool from '../api/mempool';
import { IEsploraApi } from '../api/bitcoin/esplora-api.interface';
import { PROFILE } from './profile';

/**
 * The address index: address and scripthash lookups for a backend that only has the node's RPC (MEMPOOL.BACKEND
 * "none"), where upstream answers 405 (it needs electrs).
 *
 * Every block is read once (getblock verbosity 3: each input comes with the output it spends). Per output script:
 * the funded / spent counts and sums, the transactions with the value each one moved for the script, and the
 * unspent outputs. Unconfirmed transactions come from the backend's mempool at query time. The last UNDO_DEPTH
 * blocks keep what they changed, to undo a reorg; a deeper one, or another genesis, indexes again.
 *
 * In memory with a JSON cache (<CACHE_DIR>/chain/addresses-<profile>-<network>.json): right for the testnets'
 * size; a chain with millions of transactions wants a database or electrs instead. CHAIN.ADDRESS_INDEX: false
 * turns it off.
 */

interface ScriptEntry {
  a: string | null;                                   // the address, when the script has one
  txs: [string, number, number, number][];            // txid, height, block time, value moved (sats, + received)
  u: Record<string, [number, number]>;                // unspent outputs: "txid:n" -> [value, height]
  fc: number; fs: number; sc: number; ss: number;     // funded count / sum, spent count / sum
}

/** what a block did, to undo it */
interface UndoOp {
  s: string;                  // script
  txid: string;
  out?: string;               // "txid:n" funded by this block
  spent?: [string, number, number]; // "txid:n", value, height: spent by this block
  delta: number;
  newTx: boolean;
}

const CACHE_VERSION = 3; // 3: eCash
const UNDO_DEPTH = 100;
const PAGE = 25;
const sats = (v: number | undefined): number => Math.round((v ?? 0) * 1e8);

class AddressIndex {
  private scripts = new Map<string, ScriptEntry>();
  private byAddress = new Map<string, string>();      // address -> script
  private byScripthash = new Map<string, string>();   // sha256(script) hex, both byte orders -> script
  private hashes: string[] = [];                      // block hash per height
  private undo = new Map<number, UndoOp[]>();
  private genesis = '';
  private running = false;
  private again = false;
  private ready = false;
  private lastSave = 0;

  get enabled(): boolean {
    return config.MEMPOOL.BACKEND === 'none' && config.CHAIN?.ADDRESS_INDEX !== false;
  }

  isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (!this.enabled) {
      return;
    }
    this.load();
    void this.run();
    setInterval(() => void this.run(), 15000);
  }

  onNewBlock(): void {
    if (this.enabled) {
      void this.run();
    }
  }

  private file(): string {
    return path.join(config.MEMPOOL.CACHE_DIR, 'chain', `addresses-${PROFILE.id}-${config.CHAIN.NETWORK}.json`);
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), 'utf8'));
      if (raw.version !== CACHE_VERSION) {
        return;
      }
      this.genesis = raw.genesis;
      this.hashes = raw.hashes;
      for (const [s, e] of Object.entries(raw.scripts as Record<string, ScriptEntry>)) {
        this.put(s, e);
      }
      logger.info(`Address index: ${this.scripts.size} scripts up to block ${this.hashes.length - 1} from the cache`);
    } catch (e) {
      // no cache yet
    }
  }

  private save(force = false): void {
    if (!force && Date.now() - this.lastSave < 120000) {
      return;
    }
    this.lastSave = Date.now();
    try {
      fs.mkdirSync(path.dirname(this.file()), { recursive: true });
      const tmp = this.file() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, genesis: this.genesis, hashes: this.hashes, scripts: Object.fromEntries(this.scripts) }));
      fs.renameSync(tmp, this.file());
    } catch (e) {
      logger.warn(`Address index: cannot save the cache: ${e instanceof Error ? e.message : e}`);
    }
  }

  private put(script: string, e: ScriptEntry): void {
    this.scripts.set(script, e);
    if (e.a) {
      this.byAddress.set(e.a, script);
    }
    const h = createHash('sha256').update(Buffer.from(script, 'hex')).digest();
    this.byScripthash.set(h.toString('hex'), script);
    this.byScripthash.set(Buffer.from(h).reverse().toString('hex'), script);
  }

  private entry(script: string, address: string | null): ScriptEntry {
    let e = this.scripts.get(script);
    if (!e) {
      e = { a: address, txs: [], u: {}, fc: 0, fs: 0, sc: 0, ss: 0 };
      this.put(script, e);
    } else if (!e.a && address) {
      e.a = address;
      this.byAddress.set(address, script);
    }
    return e;
  }

  private reset(): void {
    this.scripts.clear();
    this.byAddress.clear();
    this.byScripthash.clear();
    this.hashes = [];
    this.undo.clear();
  }

  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.sync();
      } while (this.again);
      this.ready = true;
    } catch (e) {
      logger.warn(`Address index: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.running = false;
    }
  }

  private async sync(): Promise<void> {
    const genesis: string = await bitcoinClient.getBlockHash(0);
    if (this.genesis && this.genesis !== genesis) {
      logger.notice('Address index: the chain was started over; indexing again');
      this.reset();
    }
    this.genesis = genesis;
    const tip: number = await bitcoinClient.getBlockCount();

    // reorg: undo blocks whose hash is no longer the node's
    while (this.hashes.length) {
      const h = this.hashes.length - 1;
      if (h <= tip && this.hashes[h] === await bitcoinClient.getBlockHash(h)) {
        break;
      }
      if (!this.undo.has(h)) {
        logger.notice(`Address index: reorg deeper than ${UNDO_DEPTH} blocks at ${h}; indexing again`);
        this.reset();
        break;
      }
      this.undoBlock(h);
    }

    const start = this.hashes.length;
    if (start > tip) {
      return;
    }
    if (tip - start > 10) {
      logger.info(`Address index: blocks ${start} to ${tip}`);
    }
    // read ahead a few blocks at a time, apply in order
    for (let h = start; h <= tip; h += 8) {
      const heights = Array.from({ length: Math.min(8, tip - h + 1) }, (_, i) => h + i);
      const blocks = await Promise.all(heights.map(async (x) => bitcoinClient.getBlock(await bitcoinClient.getBlockHash(x), 3)));
      for (const b of blocks) {
        if (b.height !== this.hashes.length || (b.height > 0 && b.previousblockhash !== this.hashes[b.height - 1])) {
          return; // the chain moved meanwhile: the next run sorts it out
        }
        this.applyBlock(b);
      }
      if ((h - start) % 1000 < 8) {
        this.save();
      }
    }
    this.save(tip - start > 0);
  }

  private applyBlock(block: any): void {
    const ops: UndoOp[] = [];
    for (const tx of block.tx) {
      const deltas = new Map<string, number>();
      for (const vin of tx.vin) {
        const p = vin.prevout;
        if (vin.coinbase || !p?.scriptPubKey?.hex) {
          continue;
        }
        const s = p.scriptPubKey.hex;
        const e = this.entry(s, p.scriptPubKey.address ?? null);
        const key = `${vin.txid}:${vin.vout}`;
        const v = sats(p.value);
        const height = e.u[key]?.[1] ?? p.height ?? 0;
        delete e.u[key];
        e.sc++;
        e.ss += v;
        deltas.set(s, (deltas.get(s) ?? 0) - v);
        ops.push({ s, txid: tx.txid, spent: [key, v, height], delta: 0, newTx: false });
      }
      for (const o of tx.vout) {
        const s = o.scriptPubKey?.hex;
        if (!s || s.startsWith('6a')) {
          continue; // OP_RETURN: no address, never spent
        }
        const e = this.entry(s, o.scriptPubKey.address ?? null);
        const key = `${tx.txid}:${o.n}`;
        const v = sats(o.value);
        e.u[key] = [v, block.height];
        e.fc++;
        e.fs += v;
        deltas.set(s, (deltas.get(s) ?? 0) + v);
        ops.push({ s, txid: tx.txid, out: key, delta: 0, newTx: false });
      }
      for (const [s, d] of deltas) {
        this.scripts.get(s)!.txs.push([tx.txid, block.height, block.time, d]);
        ops.push({ s, txid: tx.txid, delta: d, newTx: true });
      }
    }
    this.hashes.push(block.hash);
    this.undo.set(block.height, ops);
    this.undo.delete(block.height - UNDO_DEPTH);
  }

  private undoBlock(height: number): void {
    const ops = this.undo.get(height) ?? [];
    for (const op of ops.reverse()) {
      const e = this.scripts.get(op.s);
      if (!e) {
        continue;
      }
      if (op.newTx) {
        const i = e.txs.findIndex(t => t[0] === op.txid && t[1] === height);
        if (i >= 0) { e.txs.splice(i, 1); }
      } else if (op.out) {
        const v = e.u[op.out]?.[0] ?? 0;
        delete e.u[op.out];
        e.fc--;
        e.fs -= v;
      } else if (op.spent) {
        const [key, v, h] = op.spent;
        e.u[key] = [v, h];
        e.sc--;
        e.ss -= v;
      }
    }
    this.undo.delete(height);
    this.hashes.pop();
  }

  // --- lookups (esplora shapes) ---------------------------------------------------------------------

  private notReady(): Error {
    return new Error(this.ready ? 'not found' : 'The address index is still being built');
  }

  scriptOf(address: string): string | undefined {
    return this.byAddress.get(address);
  }

  scriptOfHash(scripthash: string): string | undefined {
    return this.byScripthash.get(scripthash.toLowerCase());
  }

  /** the unconfirmed transactions touching a script, with what each moved */
  private mempoolFor(script: string): { txid: string; delta: number; funded: [string, number][]; spent: [string, number][]; time: number }[] {
    const out: any[] = [];
    const mp = mempool.getMempool();
    for (const txid in mp) {
      const tx = mp[txid];
      let delta = 0;
      const funded: [string, number][] = [];
      const spent: [string, number][] = [];
      tx.vout.forEach((o, n) => { if (o.scriptpubkey === script) { delta += o.value; funded.push([`${txid}:${n}`, o.value]); } });
      for (const i of tx.vin) {
        if (i.prevout?.scriptpubkey === script) { delta -= i.prevout.value; spent.push([`${i.txid}:${i.vout}`, i.prevout.value]); }
      }
      if (funded.length || spent.length) {
        out.push({ txid, delta, funded, spent, time: tx.firstSeen ?? Math.floor(Date.now() / 1000) });
      }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  stats(script: string): { chain_stats: IEsploraApi.ChainStats; mempool_stats: IEsploraApi.MempoolStats } {
    const e = this.scripts.get(script);
    const mp = this.mempoolFor(script);
    return {
      chain_stats: { funded_txo_count: e?.fc ?? 0, funded_txo_sum: e?.fs ?? 0, spent_txo_count: e?.sc ?? 0, spent_txo_sum: e?.ss ?? 0, tx_count: e?.txs.length ?? 0 },
      mempool_stats: {
        funded_txo_count: mp.reduce((a, t) => a + t.funded.length, 0), funded_txo_sum: mp.reduce((a, t) => a + t.funded.reduce((x, f) => x + f[1], 0), 0),
        spent_txo_count: mp.reduce((a, t) => a + t.spent.length, 0), spent_txo_sum: mp.reduce((a, t) => a + t.spent.reduce((x, f) => x + f[1], 0), 0),
        tx_count: mp.length,
      },
    };
  }

  /** txids for a page: on the first page the unconfirmed ones (up to 50) then 25 confirmed; after `after` 25 more */
  txids(script: string, after: string): string[] {
    const e = this.scripts.get(script);
    const chain = (e?.txs ?? []).slice().reverse().map(t => t[0]);
    if (!after) {
      return [...this.mempoolFor(script).slice(0, 50).map(t => t.txid), ...chain.slice(0, PAGE)];
    }
    const i = chain.indexOf(after);
    return i < 0 ? [] : chain.slice(i + 1, i + 1 + PAGE);
  }

  utxos(script: string): IEsploraApi.UTXO[] {
    const e = this.scripts.get(script);
    const mp = this.mempoolFor(script);
    const spentInMempool = new Set(mp.flatMap(t => t.spent.map(s => s[0])));
    const out: IEsploraApi.UTXO[] = [];
    for (const [key, [value, height]] of Object.entries(e?.u ?? {})) {
      if (spentInMempool.has(key)) { continue; }
      const [txid, n] = key.split(':');
      out.push({ txid, vout: Number(n), value, status: { confirmed: true, block_height: height, block_hash: this.hashes[height] } });
    }
    for (const t of mp) {
      for (const [key, value] of t.funded) {
        const [txid, n] = key.split(':');
        out.push({ txid, vout: Number(n), value, status: { confirmed: false } });
      }
    }
    return out;
  }

  summary(script: string): IEsploraApi.AddressTxSummary[] {
    const e = this.scripts.get(script);
    return (e?.txs ?? []).slice(-5000).reverse().map(([txid, height, time, value]) => ({ txid, height, time, value }));
  }

  /** addresses starting with a prefix (the search box's suggestions) */
  prefix(p: string, limit = 10): string[] {
    const out: string[] = [];
    for (const a of this.byAddress.keys()) {
      if (a.startsWith(p)) {
        out.push(a);
        if (out.length >= limit) { break; }
      }
    }
    return out;
  }

  get scriptCount(): number {
    return this.scripts.size;
  }

  get height(): number {
    return this.hashes.length - 1;
  }

  assertKnown(script: string | undefined): string {
    if (!script) {
      throw this.notReady();
    }
    return script;
  }
}

export default new AddressIndex();
