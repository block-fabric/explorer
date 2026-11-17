import fs from 'fs';
import path from 'path';
import bs58 from 'bs58';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import config from '../config';
import logger from '../logger';
import { taggedHash, verifySchnorr } from './bip340';

/**
 * Sidepot's moves (slot 88, Coinelius/sidepot crates/sidepot-core/src/entry.rs): signed entries in eCash OP_RETURN
 * outputs (OP_RETURN OP_PUSHDATA1 <len> <entry>), which every Sidepot block must process in eCash block order. Read
 * here from the eCash blocks themselves, from the game's first block on; each entry decoded and its signature checked
 * against this Sidepot's domain (the eCash block that mined its proposal, and its slot).
 *
 * An entry is `magic "SPOT" | version 0 | kind | body | player(32) | nonce(8) | expires(4) | sig(64)`, integers
 * little-endian: a BUY (kind 1, 128 bytes) has round(4) keys(2) max_price(8), a CASHOUT (kind 2, 142 bytes) amount(8)
 * dest(20) (a Sidepot address; amount 0 = the whole balance). The signature is BIP340 by `player` over
 * tagged_hash("Sidepot/entry", anchor | slot | the entry without its signature).
 *
 * What is listed is what was posted: whether the game took a move (the player's balance, nonce, the round, the price,
 * the expiry against the game clock) is the game's to decide, in its state (the Sidepot node's game_state).
 *
 * In memory, saved to <CACHE_DIR>/chain/sidepot-moves.json; the newest REORG_DEPTH blocks are checked again each pass.
 */

const START = 984960;          // the game's first eCash block (sidepot-node --game-start-height)
const ANCHOR_HEIGHT = 982723;  // the eCash block that mined the slot's proposal (--game-anchor)
const SLOT = 88;
const SCAN_EVERY = 60_000;
const PER_PASS = 24;           // blocks read per pass at most (getblock 2 of a busy block is megabytes)
const REORG_DEPTH = 12;
const KEEP = 20_000;           // entries kept at most
const BUY_LEN = 128;
const CASHOUT_LEN = 142;

export interface SidepotMove {
  txid: string; vout: number; height: number; time: number;
  kind: 'buy' | 'cashout';
  player: string;              // the game account (x-only key, hex)
  nonce: number; expires: number;
  round?: number; keys?: number; maxPrice?: number;      // a buy
  amount?: number; dest?: string;                        // a cashout (sats, 0 = all; a Sidepot address)
  signed: boolean;             // its signature is the player's, for this Sidepot
}

interface Saved { anchor: string | null; scanned: { height: number; hash: string }[]; moves: SidepotMove[] }

let anchor: Buffer | null = null; // internal byte order
let scanned: { height: number; hash: string }[] = []; // the newest REORG_DEPTH blocks read
let moves: SidepotMove[] = [];
let running = false;
let started = false;

const cacheFile = (): string => path.join(config.MEMPOOL.CACHE_DIR, 'chain', 'sidepot-moves.json');

function load(): void {
  try {
    const s: Saved = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (Array.isArray(s.moves) && Array.isArray(s.scanned)) {
      moves = s.moves;
      scanned = s.scanned;
      anchor = s.anchor ? Buffer.from(s.anchor, 'hex') : null;
    }
  } catch {
    // (none yet)
  }
}

function save(): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    const tmp = cacheFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ anchor: anchor?.toString('hex') ?? null, scanned, moves } as Saved));
    fs.renameSync(tmp, cacheFile());
  } catch (e) {
    logger.debug(`Sidepot moves: could not save: ${e instanceof Error ? e.message : e}`, 'Sidepot');
  }
}

/** A Sidepot entry in an output script, decoded, or null when the script carries none (or a malformed one) */
export function decodeEntry(scriptHex: string, domain: Buffer): Omit<SidepotMove, 'txid' | 'vout' | 'height' | 'time'> | null {
  const s = Buffer.from(scriptHex, 'hex');
  if (s.length < 3 || s[0] !== 0x6a || s[1] !== 0x4c || s[2] !== s.length - 3) {
    return null;
  }
  const d = s.subarray(3);
  if (d.toString('latin1', 0, 4) !== 'SPOT' || d[4] !== 0) {
    return null;
  }
  const kind = d[5] === 1 ? 'buy' : d[5] === 2 ? 'cashout' : null;
  if (!kind || d.length !== (kind === 'buy' ? BUY_LEN : CASHOUT_LEN)) {
    return null;
  }
  const tail = d.length - 108; // player(32) nonce(8) expires(4) sig(64)
  const player = d.subarray(tail, tail + 32);
  const sig = d.subarray(d.length - 64);
  const move: Omit<SidepotMove, 'txid' | 'vout' | 'height' | 'time'> = {
    kind, player: player.toString('hex'), nonce: Number(d.readBigUInt64LE(tail + 32)), expires: d.readUInt32LE(tail + 40),
    signed: verifySchnorr(player, taggedHash('Sidepot/entry', domain, d.subarray(0, d.length - 64)), sig),
  };
  if (kind === 'buy') {
    move.round = d.readUInt32LE(6);
    move.keys = d.readUInt16LE(10);
    move.maxPrice = Number(d.readBigUInt64LE(12));
  } else {
    move.amount = Number(d.readBigUInt64LE(6));
    move.dest = bs58.encode(d.subarray(14, 34));
  }
  return move;
}

/** @asyncUnsafe */
async function $readBlock(height: number, hash: string, domain: Buffer): Promise<SidepotMove[]> {
  const b: any = await bitcoinClient.getBlock(hash, 2);
  const out: SidepotMove[] = [];
  for (const tx of (b.tx ?? []).slice(1)) {
    for (const o of tx.vout ?? []) {
      const hex: string = o.scriptPubKey?.hex ?? '';
      if (!hex.startsWith('6a4c')) {
        continue;
      }
      const m = decodeEntry(hex, domain);
      if (m) {
        out.push({ txid: tx.txid, vout: o.n, height, time: b.time, ...m });
      }
    }
  }
  return out;
}

/** the blocks after the last read, up to PER_PASS; after a reorganisation, from the fork @asyncSafe */
async function $scan(): Promise<void> {
  if (running) {
    return;
  }
  running = true;
  try {
    if (!anchor) {
      anchor = Buffer.from(String(await bitcoinClient.getBlockHash(ANCHOR_HEIGHT)), 'hex').reverse();
    }
    const domain = Buffer.concat([anchor, Buffer.from([SLOT])]);
    // a block read before that is no longer on the chain: drop what came from it and above
    for (const s of [...scanned]) {
      if (String(await bitcoinClient.getBlockHash(s.height).catch(() => '')) !== s.hash) {
        moves = moves.filter(m => m.height < s.height);
        scanned = scanned.filter(x => x.height < s.height);
        break;
      }
    }
    const tip: number = await bitcoinClient.getBlockCount();
    let h = Math.max(START, (scanned[scanned.length - 1]?.height ?? START - 1) + 1);
    let read = 0;
    for (; h <= tip && read < PER_PASS; h++, read++) {
      const hash = String(await bitcoinClient.getBlockHash(h));
      moves.push(...await $readBlock(h, hash, domain));
      scanned.push({ height: h, hash });
    }
    scanned = scanned.slice(-REORG_DEPTH);
    if (moves.length > KEEP) {
      moves = moves.slice(-KEEP);
    }
    if (read) {
      save();
    }
  } catch (e) {
    logger.debug(`Sidepot moves: ${e instanceof Error ? e.message : e}`, 'Sidepot');
  } finally {
    running = false;
  }
}

export function startSidepotMoves(): void {
  if (started) {
    return;
  }
  started = true;
  load();
  void $scan();
  setInterval(() => { void $scan(); }, SCAN_EVERY);
}

/** The moves, newest first, below height `before` (exclusive) if given; the count of each kind; how far the read is */
export function getSidepotMoves(limit: number, before: number | null, player: string | null): any {
  const all = player ? moves.filter(m => m.player === player) : moves;
  const page = all.filter(m => before === null || m.height < before).slice(-limit).reverse();
  return {
    start: START, slot: SLOT, scannedTo: scanned[scanned.length - 1]?.height ?? null,
    counts: {
      buys: all.filter(m => m.kind === 'buy').length, cashouts: all.filter(m => m.kind === 'cashout').length,
      unsigned: all.filter(m => !m.signed).length, players: new Set(all.map(m => m.player)).size,
    },
    moves: page,
  };
}
