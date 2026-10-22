import { blake3 } from '@noble/hashes/blake3';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import { bech32, bech32m } from 'bech32';
import { Content, OutPoint, OutPointKind } from './types';

/**
 * What the sidechain nodes share (chains/L2-NODES.md "Common to all"): BLAKE3 over borsh, 20-byte base58 addresses
 * without version or checksum, verifying keys, the OP_RETURN text of a deposit, outpoints as JSON, and the txids the
 * nodes do not hand out (Thunder's and zSide's). Sidechain hashes are hex of the raw bytes; eCash hashes are in
 * Bitcoin display order (reversed).
 */

/** 20 zero bytes: where a deposit goes when its text names no address */
export const BURN_ADDRESS = '11111111111111111111';

export const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
export const unhex = (s: string): Buffer => Buffer.from(s.replace(/^0x/, ''), 'hex');
export const reverseHex = (s: string): string => Buffer.from(s, 'hex').reverse().toString('hex');
export const blake3Hex = (b: Uint8Array): string => hex(blake3(b));

/** The 20 bytes of an address, or null */
export function decodeAddress(s: string): Uint8Array | null {
  try {
    const b = bs58.decode(s);
    return b.length === 20 ? b : null;
  } catch (e) {
    return null;
  }
}

export const isAddress = (s: string): boolean => decodeAddress(s) !== null;

/** The address of a 32-byte verifying key: the first 20 bytes of BLAKE3-XOF(key), base58 */
export function addressOfKeyBytes(key: Uint8Array): string {
  return bs58.encode(blake3(key, { dkLen: 20 }));
}

/**
 * The address of an authorization's verifying key, as the node shows the key: hex (Thunder, zSide, Coinshift) or
 * bech32m `<x>-svk1…` (BitNames bn-svk, BitAssets and Hivemind ba-svk). Null if neither.
 */
export function addressOfKey(key: string | null | undefined): string | null {
  if (!key) {
    return null;
  }
  const h = key.replace(/^0x/, '');
  if (/^[0-9a-fA-F]{64}$/.test(h)) {
    return addressOfKeyBytes(unhex(h));
  }
  if (/^[a-z]+-svk1/.test(key)) {
    for (const codec of [bech32m, bech32]) {
      try {
        const d = codec.decode(key, 200);
        const b = Uint8Array.from(codec.fromWords(d.words));
        if (b.length === 32) {
          return addressOfKeyBytes(b);
        }
      } catch (e) {
        // the other variant
      }
    }
  }
  return null;
}

/** UTF-8 text, or null when the bytes are not valid UTF-8 (the nodes' utf8_valid) */
function utf8(b: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch (e) {
    return null;
  }
}

/** `s<slot>_<b58>_<6 hex>`: the deposit form of an address (format_deposit_address) */
export function formatDeposit(address: string, slot: number): string {
  const prefix = `s${slot}_${address}_`;
  return prefix + hex(sha256(Buffer.from(prefix, 'latin1'))).slice(0, 6);
}

/**
 * The sidechain address a deposit credits, from its OP_RETURN bytes (hex), else the burn address:
 * - bare: base58 only (Thunder, zSide; the s9_ form burns);
 * - prefix: `s<slot>_<b58>_<checksum>` with any non-empty, case-insensitive prefix of the sha256 hex as checksum,
 *   else bare base58 (BitNames, BitAssets, Coinshift: address.rs from_deposit_address);
 * - checksum: `s<slot>_<b58>_<6 hex>`, the full checksum in any case, else bare base58 (Hivemind).
 */
export function depositAddress(textHex: string, rule: 'bare' | 'prefix' | 'checksum', slot: number): string {
  const s = utf8(unhex(textHex));
  if (s === null) {
    return BURN_ADDRESS;
  }
  if (rule !== 'bare') {
    const prefix = `s${slot}_`;
    const us = s.lastIndexOf('_');
    if (s.startsWith(prefix) && us >= prefix.length) {
      const addr = s.slice(prefix.length, us);
      const checksum = s.slice(us + 1);
      const digest = hex(sha256(Buffer.from(prefix + addr + '_', 'utf8')));
      const ok = rule === 'prefix'
        ? checksum.length > 0 && checksum.length <= 64 && [...checksum].every(ch => ch.charCodeAt(0) < 0x80) && digest.startsWith(checksum.toLowerCase())
        : checksum.toLowerCase() === digest.slice(0, 6);
      if (ok && isAddress(addr)) {
        return addr;
      }
    }
  }
  return isAddress(s) ? s : BURN_ADDRESS;
}

/** A node's OutPoint JSON as the contract's OutPoint, and the key the index files it under */
export function outPoint(j: any): OutPoint & { key: string } {
  const kind = Object.keys(j ?? {})[0];
  const v = j?.[kind];
  const short = (t: string) => t.slice(0, 8) + '…';
  switch (kind) {
    case 'Deposit': {
      const [txid, vout] = String(v).split(':');
      return { kind: 'deposit', txid, vout: Number(vout), label: `deposit ${short(txid)}:${vout}`, key: `d:${txid}:${vout}` };
    }
    case 'Regular':
    case 'Coinbase': {
      const k: OutPointKind = kind === 'Regular' ? 'regular' : 'coinbase';
      const txid = v.txid ?? v.merkle_root; // Coinshift: Coinbase { merkle_root, vout }
      return { kind: k, txid, vout: Number(v.vout), label: `${k === 'coinbase' ? 'coinbase ' : ''}${short(txid)}:${v.vout}`, key: `${k[0]}:${txid}:${v.vout}` };
    }
    case 'MarketFunds': {
      const id = Array.isArray(v.market_id) ? hex(Uint8Array.from(v.market_id)) : String(v.market_id);
      return {
        kind: 'marketFunds', txid: null, vout: null, label: `market ${id} @${v.block_height}${v.is_fee ? ' fee' : ''}`,
        key: `m:${id}:${v.block_height}:${v.is_fee ? 1 : 0}`,
      };
    }
    case 'Payout':
      return { kind: 'payout', txid: v.hash, vout: Number(v.vout), label: `payout ${short(v.hash)}:${v.vout}`, key: `p:${v.hash}:${v.vout}` };
    default:
      return { kind: 'regular', txid: null, vout: null, label: JSON.stringify(j).slice(0, 40), key: 'x:' + JSON.stringify(j) };
  }
}

/** The JSON of an outpoint, as the nodes write it */
export function outPointJson(kind: 'Regular' | 'Coinbase', txid: string, vout: number, coinbaseKey: 'txid' | 'merkle_root' = 'txid'): any {
  return { [kind]: { [kind === 'Coinbase' ? coinbaseKey : 'txid']: txid, vout } };
}

/** The sats an output holds: sats content, a withdrawal's value and main fee, market funds, a pending swap */
export function valueOf(c: Content): number {
  switch (c.type) {
    case 'value':
    case 'marketFunds':
    case 'swapPending':
      return c.value ?? 0;
    case 'withdrawal':
      return (c.value ?? 0) + (c.mainFee ?? 0);
    default:
      return 0;
  }
}

/** An enum as the nodes write it: "Variant" or {"Variant": value} -> [variant, value] */
export function tagged(raw: any): [string, any] {
  if (typeof raw === 'string') {
    return [raw, undefined];
  }
  const k = Object.keys(raw ?? {})[0] ?? '';
  return [k, raw?.[k]];
}

/** TxData as the contract's data: the variant's name lifted into `type` */
export function liftData(raw: any): any {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === 'string') {
    return { type: raw };
  }
  const type = Object.keys(raw)[0];
  const v = raw[type];
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? { type, ...v } : { type, value: v };
}

/** A withdrawal content from any of the nodes' spellings (value / value_sats, main_fee / main_fee_sats) */
export function withdrawalContent(raw: any, w: any): Content {
  return { type: 'withdrawal', value: Number(w.value ?? w.value_sats ?? 0), mainFee: Number(w.main_fee ?? w.main_fee_sats ?? 0), mainAddress: w.main_address, raw };
}

/** blake3(canonical_bytes): Thunder's txid (and Coinshift's) */
export function txidOfCanonical(canonicalHex: string): string {
  return blake3Hex(unhex(canonicalHex));
}

/**
 * zSide's txid: blake3(borsh(inputs) ‖ borsh(outputs) ‖ Option<bundle without auth>). canonical_bytes is
 * inputs ‖ Option<full bundle> ‖ outputs, and the bundle without auth (840 bytes per action + 41) is the prefix of
 * the full one, which goes on with the proof (u32 length + bytes), a spend-auth signature per action and the
 * binding signature.
 */
export function zsideTxid(canonicalHex: string, actions: number): string {
  const b = unhex(canonicalHex);
  let p = 4 + b.readUInt32LE(0) * (37 + 32);
  const inputs = b.subarray(0, p);
  let bundle: Buffer = Buffer.from([0]);
  if (b[p] === 1) {
    const start = p + 1;
    const noAuth = 840 * actions + 41;
    bundle = Buffer.concat([Buffer.from([1]), b.subarray(start, start + noAuth)]);
    const proofLen = b.readUInt32LE(start + noAuth);
    p = start + noAuth + 4 + proofLen + 64 * actions + 64;
  } else {
    p += 1;
  }
  return blake3Hex(Buffer.concat([inputs, b.subarray(p), bundle]));
}

/** blake3(merkle_root ‖ prev_main_hash (internal order) ‖ Option<prev_side_hash>) */
export function coinbaseTxid(merkleRoot: string, prevMainHash: string, prevSideHash: string | null): string {
  return blake3Hex(Buffer.concat([
    unhex(merkleRoot), unhex(reverseHex(prevMainHash)),
    prevSideHash ? Buffer.concat([Buffer.from([1]), unhex(prevSideHash)]) : Buffer.from([0]),
  ]));
}

/**
 * The block hash: blake3(merkle_root ‖ Option<prev_side_hash> ‖ prev_main_hash (internal order) [‖ u32 n ‖ roots]);
 * the utreexo chains (Thunder, Hivemind, zSide, Coinshift) hash their roots too, Empty/Placeholder as zeros.
 */
export function blockHash(header: { merkle_root: string; prev_side_hash: string | null; prev_main_hash: string; roots?: any[] }, withRoots: boolean): string {
  const parts: Buffer[] = [
    unhex(header.merkle_root),
    header.prev_side_hash ? Buffer.concat([Buffer.from([1]), unhex(header.prev_side_hash)]) : Buffer.from([0]),
    unhex(reverseHex(header.prev_main_hash)),
  ];
  if (withRoots) {
    const roots = header.roots ?? [];
    const n = Buffer.alloc(4);
    n.writeUInt32LE(roots.length);
    parts.push(n);
    for (const r of roots) {
      parts.push(typeof r === 'string' && /^[0-9a-f]{64}$/i.test(r) ? unhex(r) : r?.Some ? Buffer.from(r.Some) : Buffer.alloc(32));
    }
  }
  return blake3Hex(Buffer.concat(parts));
}
