import { createHash } from 'crypto';
import { opReturnPayload } from './bip300';

/**
 * Helpers for chain modules that decode their sidechain's OP_RETURN markers (Bitcoin Core serialization: little
 * endian integers, CompactSize lengths, 32-byte hashes in internal order, printed reversed by the node's RPCs).
 */

export class Reader {
  pos = 0;
  constructor(public buf: Buffer) {}

  get left(): number { return this.buf.length - this.pos; }
  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error('marker too short');
    }
  }
  u8(): number { this.need(1); return this.buf[this.pos++]; }
  bool(): boolean { return this.u8() !== 0; }
  u16(): number { this.need(2); const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  u32(): number { this.need(4); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  i32(): number { this.need(4); const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  /** int64 as a number (exact up to 2^53; fine for amounts) */
  i64(): number { this.need(8); const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return Number(v); }
  bytes(n: number): Buffer { this.need(n); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  compactSize(): number {
    const b = this.u8();
    if (b < 0xfd) { return b; }
    if (b === 0xfd) { return this.u16(); }
    if (b === 0xfe) { return this.u32(); }
    return this.i64();
  }
  /** Bitcoin Core's VARINT (not CompactSize) */
  varint(): number {
    let n = 0;
    for (;;) {
      const b = this.u8();
      n = n * 128 + (b & 0x7f);
      if (b & 0x80) { n++; } else { return n; }
    }
  }
  varBytes(): Buffer { return this.bytes(this.compactSize()); }
  string(): string { return this.varBytes().toString('utf8'); }
  /** 32-byte hash, in the reversed (RPC) order */
  hash(): string { return Buffer.from(this.bytes(32)).reverse().toString('hex'); }
  hex(n: number): string { return this.bytes(n).toString('hex'); }
  opt<T>(f: () => T): T | null { return this.bool() ? f() : null; }
  vector<T>(f: () => T): T[] { const n = this.compactSize(); const out: T[] = []; for (let i = 0; i < n; i++) { out.push(f()); } return out; }
}

/** The outputs of a verbose transaction whose script is OP_RETURN <push starting with tag> */
export function findMarkers(tx: any, tagHex: string): { vout: number; value: number; payload: Buffer }[] {
  const out: { vout: number; value: number; payload: Buffer }[] = [];
  for (const o of tx?.vout ?? []) {
    const hex: string = o.scriptPubKey?.hex ?? o.scriptpubkey ?? '';
    if (!hex.startsWith('6a')) { continue; }
    const body = opReturnPayload(Buffer.from(hex, 'hex'));
    if (body && body.subarray(0, tagHex.length / 2).toString('hex') === tagHex) {
      out.push({ vout: o.n, value: Math.round((o.value ?? 0) * 1e8), payload: body.subarray(tagHex.length / 2) });
    }
  }
  return out;
}

export function sha256(b: Buffer): Buffer {
  return createHash('sha256').update(b).digest();
}

export function sha256d(b: Buffer): Buffer {
  return sha256(sha256(b));
}

/** Decode with a reader, returning partial results and an error instead of throwing */
export function safeDecode<T extends object>(fn: () => T): T | { error: string } {
  try {
    return fn();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
