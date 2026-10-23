/*
 * Numbers as Flush's pages show them: amounts in whole units (the API's display numbers: ECX to 8 decimals, launched
 * tokens to 6), prices to four significant digits without exponents (a token's price in ECX is often 0.000002...),
 * large figures compact in tiles. Plain strings for interpolation.
 */

const nf = new Map<string, Intl.NumberFormat>();
function fmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = JSON.stringify(opts);
  let f = nf.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-US', opts);
    nf.set(k, f);
  }
  return f;
}

function ok(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** an amount: up to `decimals` places, fewer as it grows */
export function amount(n: number | null | undefined, decimals = 8): string {
  if (!ok(n)) {
    return '–';
  }
  const a = Math.abs(n);
  const d = a >= 1e6 ? 0 : a >= 1000 ? Math.min(2, decimals) : a >= 1 ? Math.min(4, decimals) : decimals;
  return fmt({ maximumFractionDigits: d }).format(n);
}

/** a price: four significant digits, never an exponent */
export function price(n: number | null | undefined): string {
  if (!ok(n)) {
    return '–';
  }
  if (n === 0) {
    return '0';
  }
  return Math.abs(n) >= 10000 ? fmt({ maximumFractionDigits: 0 }).format(n) : fmt({ maximumSignificantDigits: 4 }).format(n);
}

/** 1.2k, 3.45M, 1.2B */
export function compact(n: number | null | undefined): string {
  if (!ok(n)) {
    return '–';
  }
  return Math.abs(n) < 1000 ? amount(n, Math.abs(n) >= 1 ? 2 : 4) : fmt({ notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

/** a percentage of 0..100 */
export function pct(n: number | null | undefined, digits = 2): string {
  return ok(n) ? fmt({ maximumFractionDigits: digits }).format(n) + '%' : '–';
}

/** a signed change in percent (+1.2%, −3.4%) */
export function change(n: number | null | undefined): string {
  if (!ok(n)) {
    return '–';
  }
  return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt({ maximumFractionDigits: 2 }).format(Math.abs(n)) + '%';
}

/** basis points as a percentage (30 -> 0.3%) */
export function bps(n: number | null | undefined): string {
  return ok(n) ? fmt({ maximumFractionDigits: 3 }).format(n / 100) + '%' : '–';
}

/** millionths as a percentage (3000 -> 0.3%) */
export function ppm(n: number | null | undefined): string {
  return ok(n) ? fmt({ maximumFractionDigits: 4 }).format(n / 10000) + '%' : '–';
}

export function shortId(s: string | null | undefined, keep = 8): string {
  const t = String(s ?? '');
  return t.length > keep * 2 + 1 ? t.slice(0, keep) + '…' + t.slice(-keep) : t;
}

/** a pool kind as words */
export const KIND_LABEL: Record<string, string> = {
  constant_product: 'constant product', stable: 'stable', weighted: 'weighted', concentrated: 'concentrated',
  launch: 'launch curve', book: 'order book',
};
export function kindLabel(k: string | null | undefined): string {
  return KIND_LABEL[String(k)] ?? String(k ?? '').replace(/_/g, ' ');
}

/** a fee share's recipient as words */
export function shareLabel(to: string): string {
  return ({ liquidity_providers: 'liquidity providers', security: 'chain security (BMM bidder and validators)', treasury: 'treasury', creator: 'creator' } as Record<string, string>)[to] ?? to.replace(/_/g, ' ');
}

/** an https:// link of a creator's text that the API passed as safe, checked again here; else null */
export function safeLink(url: string | null | undefined): string | null {
  const u = String(url ?? '');
  if (u.length > 512 || !/^https:\/\/[^\s"'<>\\@]+$/.test(u)) {
    return null;
  }
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && !p.username && !p.password && !!p.hostname ? p.href : null;
  } catch {
    return null;
  }
}

/** a 64-hex id */
export function isId(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

/** an address's shape: bech32 (flx1, bflx1, tflx1, or a regtest prefix) or base58 */
export function isAddress(s: string): boolean {
  return /^[a-z]{2,6}1[ac-hj-np-z02-9]{20,90}$/.test(s) || /^[A-Z]{2,6}1[AC-HJ-NP-Z02-9]{20,90}$/.test(s)
    || /^[1-9A-HJ-NP-Za-km-z]{26,35}$/.test(s) && !/^[A-Z0-9]{2,12}$/.test(s);
}

/** a ticker's shape: 2 to 12 of A-Z and 0-9 (any case typed) */
export function isTicker(s: string): boolean {
  return /^[A-Za-z0-9]{2,12}$/.test(s);
}

/** an asset as the node's RPCs take it: a ticker as is, an id as 0x<id> (a bare 64-hex string is read as a name) */
export function assetArg(s: string): string {
  const t = String(s ?? '').trim();
  return isId(t) ? '0x' + t.toLowerCase() : t;
}
