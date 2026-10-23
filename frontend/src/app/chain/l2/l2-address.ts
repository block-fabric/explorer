/**
 * Sidechain addresses (the Thunder family of sidechains: Thunder, BitNames, BitAssets, Truthcoin, zSide, Coinshift):
 * 20 raw bytes (the hash of a verifying key) in base58 with Bitcoin's alphabet, with no version byte and no checksum,
 * e.g. "2z9GMfc3GeFxu7xaJyigxxxxxxx". With no checksum, an address is valid when it is in the alphabet and decodes to
 * exactly 20 bytes: 20 to 28 characters (a leading '1' per leading zero byte).
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** the shape alone (alphabet and length), for regular expressions; isL2Address checks the decoded length */
export const L2_ADDRESS_CHARS = '[1-9A-HJ-NP-Za-km-z]{20,28}';
const SHAPE = new RegExp('^' + L2_ADDRESS_CHARS + '$');

/** the number of bytes a base58 string decodes to (null: not base58) */
export function base58DecodedLength(s: string): number | null {
  let n = 0n;
  let zeros = 0;
  let leading = true;
  for (const c of s) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) {
      return null;
    }
    if (leading && v === 0) {
      zeros++;
      continue;
    }
    leading = false;
    n = n * 58n + BigInt(v);
  }
  let bytes = 0;
  while (n > 0n) {
    n >>= 8n;
    bytes++;
  }
  return zeros + bytes;
}

export function isL2Address(s: string | null | undefined): boolean {
  return typeof s === 'string' && SHAPE.test(s) && base58DecodedLength(s) === 20;
}

/**
 * A RegExp that matches sidechain addresses only (its shape, then the decoded length): it stands in for upstream's
 * address regular expressions on a sidechain explorer (shared/regex.utils.ts), wherever they are tested or executed.
 */
export class L2AddressRegExp extends RegExp {
  constructor() {
    super('^' + L2_ADDRESS_CHARS + '$');
  }

  override exec(s: string): RegExpExecArray | null {
    const m = super.exec(s);
    return m && base58DecodedLength(m[0]) === 20 ? m : null;
  }

  override test(s: string): boolean {
    return this.exec(String(s)) !== null;
  }
}
