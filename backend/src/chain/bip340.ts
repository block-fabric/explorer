import { createHash } from 'crypto';

/**
 * BIP340 Schnorr signatures over secp256k1: verification only (Sidepot's L1 entries, chain/sidepot-moves.ts), as the
 * BIP's reference code does it, in Jacobian coordinates. Not constant time: it checks public data.
 */

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G: Point = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
  1n,
];

type Point = [bigint, bigint, bigint]; // Jacobian X, Y, Z (Z = 0: the point at infinity)

const mod = (a: bigint, m = P): bigint => {
  const r = a % m;
  return r < 0n ? r + m : r;
};

function pow(b: bigint, e: bigint, m = P): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) {
      r = r * b % m;
    }
    b = b * b % m;
    e >>= 1n;
  }
  return r;
}

function double([x, y, z]: Point): Point {
  if (z === 0n || y === 0n) {
    return [0n, 1n, 0n];
  }
  const ysq = y * y % P;
  const s = 4n * x * ysq % P;
  const m = 3n * x * x % P;
  const nx = mod(m * m - 2n * s);
  return [nx, mod(m * (s - nx) - 8n * ysq * ysq), 2n * y * z % P];
}

function add(a: Point, b: Point): Point {
  if (a[2] === 0n) {
    return b;
  }
  if (b[2] === 0n) {
    return a;
  }
  const z1z1 = a[2] * a[2] % P;
  const z2z2 = b[2] * b[2] % P;
  const u1 = a[0] * z2z2 % P;
  const u2 = b[0] * z1z1 % P;
  const s1 = a[1] * b[2] % P * z2z2 % P;
  const s2 = b[1] * a[2] % P * z1z1 % P;
  if (u1 === u2) {
    return s1 === s2 ? double(a) : [0n, 1n, 0n];
  }
  const h = mod(u2 - u1);
  const r = mod(s2 - s1);
  const hh = h * h % P;
  const hhh = h * hh % P;
  const v = u1 * hh % P;
  const x = mod(r * r - hhh - 2n * v);
  return [x, mod(r * (v - x) - s1 * hhh), h * a[2] % P * b[2] % P];
}

function mul(p: Point, k: bigint): Point {
  let r: Point = [0n, 1n, 0n];
  for (let i = BigInt(k.toString(2).length - 1); i >= 0n; i--) {
    r = double(r);
    if ((k >> i) & 1n) {
      r = add(r, p);
    }
  }
  return r;
}

function affine([x, y, z]: Point): [bigint, bigint] | null {
  if (z === 0n) {
    return null;
  }
  const zi = pow(z, P - 2n);
  const zi2 = zi * zi % P;
  return [x * zi2 % P, y * zi2 % P * zi % P];
}

const int = (b: Uint8Array): bigint => BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));

/** The point with this x and an even y (lift_x), or null when x is not on the curve */
function liftX(x: bigint): Point | null {
  if (x >= P) {
    return null;
  }
  const c = mod(x * x * x + 7n);
  const y = pow(c, (P + 1n) / 4n);
  if (y * y % P !== c) {
    return null;
  }
  return [x, y & 1n ? P - y : y, 1n];
}

/** Whether 64 hex characters are an x-only public key (an x on the curve) */
export function isXOnlyKey(hex: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(hex) && liftX(BigInt('0x' + hex)) !== null;
}

/** SHA256(SHA256(tag) ‖ SHA256(tag) ‖ msg) */
export function taggedHash(tag: string, ...parts: Uint8Array[]): Buffer {
  const t = createHash('sha256').update(tag).digest();
  const h = createHash('sha256').update(t).update(t);
  for (const p of parts) {
    h.update(p);
  }
  return h.digest();
}

/** Whether `sig` (64 bytes) is `pubkey`'s (32-byte x-only key) BIP340 signature of `msg` */
export function verifySchnorr(pubkey: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  if (pubkey.length !== 32 || sig.length !== 64) {
    return false;
  }
  const pk = liftX(int(pubkey));
  const r = int(sig.subarray(0, 32));
  const s = int(sig.subarray(32, 64));
  if (!pk || r >= P || s >= N) {
    return false;
  }
  const e = mod(int(taggedHash('BIP0340/challenge', sig.subarray(0, 32), pubkey, msg)), N);
  const R = affine(add(mul(G, s), mul(pk, N - e)));
  return !!R && (R[1] & 1n) === 0n && R[0] === r;
}
