import { createHash } from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { bech32 } from 'bech32';

/**
 * Flush's peg and stake markers: OP_RETURN outputs with one push that starts with a 4-byte tag (backbone-flush
 * src/sidechain/script.cpp ParseTagged: OP_RETURN, then a single push to the end of the script). The asset marker
 * (BAST) is the node's to decode (decodeassettx).
 *
 *   WITHDRAWAL  D8 'WDR' | main fee (u64 LE) | refund key hash (20) | mainchain script (1-80)    (sidechain/state.h)
 *               the output's value is amount + main fee
 *   REFUND      D9 'RFN' | withdrawal txid (32, internal order) | vout (u32 LE) | signature (65)
 *   BUNDLE      DA 'BND' | bundle hash (32, internal order): the coinbase's commitment to a withdrawal bundle
 *   BOND        DB 'STK' | validator x-only key (32) | owner key hash (20) | proof of possession (64)
 *               [| owner signature (65)]; the bonded amount is the output's value              (pos/bond.h)
 *   UNBOND      DC 'UNB' | validator key (32) | amount (i64 LE, 0 = all) | sequence (u32 LE) | owner signature (65)
 *   EVIDENCE    DD 'EVD' | two block headers the leader of a slot signed (DoubleProposal)        (pos/evidence.h)
 *   POOL        DE 'VPL' (nothing after): a coinbase output into the validator pool          (pos/feesplit.h)
 *   POOL SHARES DE 'VPS' | count (u32 LE): before the validators' shares of the pool a peg step pays
 *
 * Keys and key hashes print in wire order (the node's HexStr); txids and block hashes reversed (GetHex).
 */

export const TAGS = {
  withdrawal: 'd8574452',
  refund: 'd952464e',
  bundle: 'da424e44',
  bond: 'db53544b',
  unbond: 'dc554e42',
  evidence: 'dd455644',
  validatorPool: 'de56504c',
  validatorShares: 'de565053',
};

/** The header version bit of an extended header (primitives/block.h BLOCK_EXTENSION_BIT) */
const BLOCK_EXTENSION_BIT = 0x00010000;
const MAX_MAIN_SCRIPT_SIZE = 80;
const COMPACT_SIGNATURE_SIZE = 65;
/** Bitcoin Core's MAX_MONEY */
const MAX_MONEY = 21e6 * 1e8;

export type PegOp =
  | { kind: 'withdrawal'; vout: number; value: number; amount: number; mainFee: number; refundKeyHash: string;
      refundAddress: string | null; mainScript: string; mainAddress: string | null; valid: boolean }
  | { kind: 'refund'; vout: number; withdrawal: { txid: string; vout: number } }
  | { kind: 'bundle'; vout: number; hash: string };

export type StakeOp =
  | { kind: 'bond'; vout: number; amount: number; pubkey: string; owner: string; ownerAddress: string | null; signed: boolean }
  | { kind: 'unbond'; vout: number; pubkey: string; amount: number | null; all: boolean; sequence: number }
  | { kind: 'evidence'; vout: number; headers: { hash: string; prevHash: string; time: number }[] }
  | { kind: 'validatorPool'; vout: number; amount: number }
  | { kind: 'validatorShares'; vout: number; count: number };

/** The addresses to print: the Flush chain's bech32 prefix, and the eCash network's (withdrawals' destinations) */
export interface AddressContext {
  flushHrp: string | null;
  main: bitcoin.networks.Network | null;
}

/** The single push of an OP_RETURN script that holds nothing else, or null (as ParseTagged reads it) */
export function taggedPush(script: Buffer): Buffer | null {
  if (script.length < 2 || script[0] !== 0x6a) {
    return null;
  }
  const op = script[1];
  let at = 2;
  let n: number;
  if (op >= 0x01 && op <= 0x4b) {
    n = op;
  } else if (op === 0x4c && script.length >= 3) {
    n = script[2];
    at = 3;
  } else if (op === 0x4d && script.length >= 4) {
    n = script.readUInt16LE(2);
    at = 4;
  } else if (op === 0x4e && script.length >= 6) {
    n = script.readUInt32LE(2);
    at = 6;
  } else {
    return null;
  }
  return at + n === script.length ? script.subarray(at) : null;
}

const reversed = (b: Buffer): string => Buffer.from(b).reverse().toString('hex');
const sha256d = (b: Buffer): Buffer => createHash('sha256').update(createHash('sha256').update(b).digest()).digest();

/** A P2WPKH address of a key hash, with the chain's prefix */
export function p2wpkh(hrp: string | null, keyHash: Buffer): string | null {
  if (!hrp) {
    return null;
  }
  try {
    return bech32.encode(hrp, [0, ...bech32.toWords(keyHash)]);
  } catch (e) {
    return null;
  }
}

function mainAddress(network: bitcoin.networks.Network | null, script: Buffer): string | null {
  if (!network) {
    return null;
  }
  try {
    return bitcoin.address.fromOutputScript(script, network);
  } catch (e) {
    return null;
  }
}

/** A block header of a DoubleProposal: 80 bytes, then hashSections (32) and a signature (64) if extended */
function readHeader(b: Buffer, at: number): { hash: string; prevHash: string; time: number; next: number } {
  if (at + 80 > b.length) {
    throw new Error('short header');
  }
  const extended = (b.readInt32LE(at) & BLOCK_EXTENSION_BIT) !== 0;
  const end = at + 80 + (extended ? 96 : 0);
  if (end > b.length) {
    throw new Error('short extended header');
  }
  // GetHash: the 80 bytes, then hashSections in an extended header (never the signature)
  const hashed = b.subarray(at, at + (extended ? 112 : 80));
  return { hash: reversed(sha256d(hashed)), prevHash: reversed(b.subarray(at + 4, at + 36)), time: b.readUInt32LE(at + 68), next: end };
}

function decodePeg(tag: string, p: Buffer, vout: number, value: number, ctx: AddressContext): PegOp | null {
  switch (tag) {
    case TAGS.withdrawal: {
      // ParseWithdrawalOutput: more than 28 bytes, a mainchain script of at most 80
      if (p.length <= 28 || p.length > 28 + MAX_MAIN_SCRIPT_SIZE) {
        return null;
      }
      const fee = p.readBigUInt64LE(0);
      const feeOk = fee <= BigInt(MAX_MONEY) && Number(fee) < value;
      const mainFee = Number(fee);
      const script = p.subarray(28);
      const keyHash = p.subarray(8, 28);
      const address = mainAddress(ctx.main, script);
      return {
        kind: 'withdrawal', vout, value, amount: feeOk ? value - mainFee : 0, mainFee, refundKeyHash: keyHash.toString('hex'),
        refundAddress: p2wpkh(ctx.flushHrp, keyHash), mainScript: script.toString('hex'), mainAddress: address,
        // what the node takes as a withdrawal: a fee below the value, and a standard destination (an address)
        valid: feeOk && address !== null,
      };
    }
    case TAGS.refund:
      if (p.length !== 36 + COMPACT_SIGNATURE_SIZE) {
        return null;
      }
      return { kind: 'refund', vout, withdrawal: { txid: reversed(p.subarray(0, 32)), vout: p.readUInt32LE(32) } };
    case TAGS.bundle:
      return p.length === 32 ? { kind: 'bundle', vout, hash: reversed(p) } : null;
  }
  return null;
}

function decodeStake(tag: string, p: Buffer, vout: number, value: number, ctx: AddressContext): StakeOp | null {
  switch (tag) {
    case TAGS.bond: {
      if (p.length !== 116 && p.length !== 116 + COMPACT_SIGNATURE_SIZE) {
        return null;
      }
      const owner = p.subarray(32, 52);
      return {
        kind: 'bond', vout, amount: value, pubkey: p.subarray(0, 32).toString('hex'), owner: owner.toString('hex'),
        ownerAddress: p2wpkh(ctx.flushHrp, owner), signed: p.length > 116,
      };
    }
    case TAGS.unbond: {
      if (p.length !== 44 + COMPACT_SIGNATURE_SIZE) {
        return null;
      }
      const amount = Number(p.readBigInt64LE(32));
      return { kind: 'unbond', vout, pubkey: p.subarray(0, 32).toString('hex'), amount: amount === 0 ? null : amount, all: amount === 0, sequence: p.readUInt32LE(40) };
    }
    case TAGS.evidence: {
      try {
        const a = readHeader(p, 0);
        const b = readHeader(p, a.next);
        if (b.next !== p.length) {
          return null;
        }
        return { kind: 'evidence', vout, headers: [a, b].map(h => ({ hash: h.hash, prevHash: h.prevHash, time: h.time })) };
      } catch (e) {
        return null;
      }
    }
    case TAGS.validatorPool:
      return p.length === 0 ? { kind: 'validatorPool', vout, amount: value } : null;
    case TAGS.validatorShares:
      return p.length === 4 ? { kind: 'validatorShares', vout, count: p.readUInt32LE(0) } : null;
  }
  return null;
}

const PEG = new Set([TAGS.withdrawal, TAGS.refund, TAGS.bundle]);
const STAKE = new Set([TAGS.bond, TAGS.unbond, TAGS.evidence, TAGS.validatorPool, TAGS.validatorShares]);

/** One output's marker: its family and what it says, or null (no marker, or one that does not read) */
export function decodeOutput(scriptHex: string, vout: number, value: number, ctx: AddressContext): { peg?: PegOp; stake?: StakeOp } | null {
  if (typeof scriptHex !== 'string' || !scriptHex.startsWith('6a') || scriptHex.length > 40000 || !/^[0-9a-f]*$/.test(scriptHex)) {
    return null;
  }
  const push = taggedPush(Buffer.from(scriptHex, 'hex'));
  if (!push || push.length < 4) {
    return null;
  }
  const tag = push.subarray(0, 4).toString('hex');
  const payload = push.subarray(4);
  if (PEG.has(tag)) {
    const op = decodePeg(tag, payload, vout, value, ctx);
    return op ? { peg: op } : null;
  }
  if (STAKE.has(tag)) {
    const op = decodeStake(tag, payload, vout, value, ctx);
    return op ? { stake: op } : null;
  }
  return null;
}

/** Whether a verbose transaction has an asset marker (an OP_RETURN whose first push starts with "BAST") */
export function hasAssetMarker(tx: any): boolean {
  return (tx?.vout ?? []).some((o: any) => {
    const hex: string = o?.scriptPubKey?.hex ?? '';
    // the push's opcode (and its length bytes) come before the tag (bitassets IsMarkerScript)
    return /^6a(?:[0-3][0-9a-f]|4[0-9ab]|4c[0-9a-f]{2}|4d[0-9a-f]{4}|4e[0-9a-f]{8})42415354/.test(hex);
  });
}

/** Reads the bitassets marker, which is more compact than Bitcoin's CompactSize: integers in base 128, high bit first. */
class MarkerReader {
  private at: number;
  constructor(private readonly data: Buffer, at = 0) {
    this.at = at;
  }

  private take(n: number): Buffer {
    if (n < 0 || this.at + n > this.data.length) {
      throw new Error('marker ends early');
    }
    const b = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return b;
  }

  u8(): number { return this.take(1)[0]; }
  u16(): number { return this.take(2).readUInt16LE(0); }
  i32(): number { return this.take(4).readInt32LE(0); }
  u64(): number { return Number(this.take(8).readBigUInt64LE(0)); }
  bytes(n: number): void { this.take(n); }

  /** VARINT: 7 bits a byte, high bit: more follow, and the value carries (as ReadVarInt) */
  varint(): number {
    let n = 0;
    for (;;) {
      const ch = this.u8();
      if (n > Math.floor(Number.MAX_SAFE_INTEGER / 128)) throw new Error('varint too large');
      n = n * 128 + (ch & 0x7f);
      if ((ch & 0x80) === 0) return n;
      n += 1;
    }
  }

  /** std::vector's and std::string's CompactSize */
  compact(): number {
    const first = this.u8();
    if (first < 0xfd) return first;
    const n = first === 0xfd ? this.u16() : first === 0xfe ? this.take(4).readUInt32LE(0) : this.u64();
    if (!Number.isSafeInteger(n)) throw new Error('compact size too large');
    return n;
  }

  string(): string { return this.take(this.compact()).toString('utf8'); }
  script(): string { return this.take(this.compact()).toString('hex'); }
  optional(fn: () => void): void { if (this.u8()) fn(); }
  vector(fn: () => void): void { for (let n = this.compact(); n > 0; --n) fn(); }
  get done(): boolean { return this.at === this.data.length; }
}

/** AssetData (state.h): an optional commitment, ipv4, ipv6, encryption key, signing key and info. */
function skipAssetData(r: MarkerReader): void {
  r.optional(() => r.bytes(32));
  r.optional(() => r.bytes(6));
  r.optional(() => r.bytes(18));
  r.optional(() => r.bytes(33));
  r.optional(() => r.bytes(32));
  r.optional(() => { r.string(); });
}

/** Register (state.h): name, nonce, supply, decimals, data, optional text; a logo kind adds the logo. */
function skipRegister(r: MarkerReader): void {
  r.bytes(32);
  r.bytes(32);
  r.varint();
  r.u8();
  skipAssetData(r);
  r.optional(() => { r.string(); });
}

function skipOutputs(r: MarkerReader): void {
  r.vector(() => {
    r.varint();
    const kind = r.u8();
    if (kind !== 0xff) {
      r.bytes(32);
      if (kind === 0 || kind === 3) r.varint();
    }
  });
  if (!r.done) throw new Error('marker has bytes left');
}

/** Where the operation pays CHN back, for the kinds that have a chn_to at the end (state.h); null for the others. */
function readChnTo(r: MarkerReader, kind: number): string | null {
  switch (kind) {
  case 2: // register: no CHN output
    return null;
  case 6: // swap: asset_in, amount_in, asset_out, min_out, chn_to
    r.bytes(32); r.varint(); r.bytes(32); r.varint(); return r.script();
  case 8: // remove_liquidity: asset_a, asset_b, shares, min_a, min_b, chn_to
    r.bytes(32); r.bytes(32); r.varint(); r.varint(); r.varint(); return r.script();
  case 10: // bid: auction, quote_amount, min_base, chn_to
    r.bytes(32); r.varint(); r.varint(); return r.script();
  case 11: // collect: auction, chn_to
    r.bytes(32); return r.script();
  case 13: // route: path, amount_in, min_out, chn_to
    r.vector(() => r.bytes(32)); r.varint(); r.varint(); return r.script();
  case 20: // pool_withdraw: pool, shares, only, min0, min1, chn_to
    r.bytes(32); r.varint(); r.u8(); r.varint(); r.varint(); return r.script();
  case 21: // swap_pools: asset_in, pools, amount_in, min_out, chn_to
    r.bytes(32); r.vector(() => r.bytes(32)); r.varint(); r.varint(); return r.script();
  case 22: { // launch_token: its Register, logo, display name, creator, allocation, min/max/first buy, first min, chn_to
    skipRegister(r);
    r.vector(() => r.u8());
    r.string();
    r.script();
    r.u16();
    r.varint(); r.varint(); r.varint(); r.varint();
    return r.script();
  }
  case 24: // open_position: pool, ticks, liquidity, max0, max1, chn_to
    r.bytes(32); r.i32(); r.i32(); r.u64(); r.u64(); r.varint(); r.varint(); return r.script();
  case 25: // change_position: position, add, liquidity, limits, collect, close, chn_to
    r.bytes(32); r.u8(); r.u64(); r.u64(); r.varint(); r.varint(); r.u8(); r.u8(); return r.script();
  case 27: // settle_order: order, cancel, chn_to
    r.bytes(32); r.u8(); return r.script();
  default:
    return null;
  }
}

/**
 * The marker's kind byte (BAST, version, then the kind, so 2/33/35 for a Register where decodeassettx says 2) and, for
 * the operations that have one, chn_to: the script the coinbase pays CHN change to. chnTo is null when the kind has none,
 * or (with a node newer than this layout) when it cannot be read; markerKind is still given.
 */
export function assetMarker(tx: any): { markerKind: number; chnTo: string | null } | null {
  for (const o of tx?.vout ?? []) {
    const hex: string = o?.scriptPubKey?.hex ?? '';
    if (!hasAssetMarker({ vout: [o] })) {
      continue;
    }
    const push = taggedPush(Buffer.from(hex, 'hex'));
    if (!push || push.length < 6 || push.subarray(0, 4).toString('hex') !== '42415354' || push[4] !== 0) {
      return null;
    }
    const kind = push[5];
    try {
      const r = new MarkerReader(push, 6);
      const chnTo = readChnTo(r, kind);
      skipOutputs(r);
      return { markerKind: kind, chnTo };
    } catch {
      return { markerKind: kind, chnTo: null };
    }
  }
  return null;
}

/** The marker's operation kind byte; see assetMarker. */
export function assetMarkerKind(tx: any): number | null {
  return assetMarker(tx)?.markerKind ?? null;
}

/** The peg and stake markers of a verbose transaction (getrawtransaction's JSON), in output order */
export function decodeMarkers(tx: any, ctx: AddressContext): { peg: PegOp[]; stake: StakeOp[] } {
  const peg: PegOp[] = [];
  const stake: StakeOp[] = [];
  for (const o of tx?.vout ?? []) {
    const value = Math.round(Number(o?.value ?? 0) * 1e8);
    const d = decodeOutput(o?.scriptPubKey?.hex ?? '', Number(o?.n ?? 0), Number.isFinite(value) ? value : 0, ctx);
    if (d?.peg) {
      peg.push(d.peg);
    }
    if (d?.stake) {
      stake.push(d.stake);
    }
  }
  return { peg, stake };
}
