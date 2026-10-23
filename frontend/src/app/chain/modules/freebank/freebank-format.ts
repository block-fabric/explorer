/*
 * Numbers and words as FreeBank's pages show them: ECX to 8 decimals (fewer as they grow), sats as ECX, note units as
 * whole numbers, basis points as percentages, house and bill statuses as words. Plain strings for interpolation.
 */
import { Bill, House, HouseStatus } from './freebank.interfaces';

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

/** an ECX amount (the node's decimal ECX) */
export function ecx(n: number | null | undefined, decimals = 8): string {
  if (!ok(n)) {
    return '–';
  }
  const a = Math.abs(n);
  const d = a >= 1e6 ? 2 : a >= 1000 ? Math.min(4, decimals) : decimals;
  return fmt({ maximumFractionDigits: d }).format(n);
}

/** sats as ECX */
export function sats(n: number | null | undefined): string {
  return ok(n) ? ecx(n / 1e8) : '–';
}

/** a count (note units, members, heights) */
export function num(n: number | null | undefined): string {
  return ok(n) ? fmt({ maximumFractionDigits: 0 }).format(n) : '–';
}

/** 1.2k, 3.45M */
export function compact(n: number | null | undefined): string {
  if (!ok(n)) {
    return '–';
  }
  return Math.abs(n) < 10000 ? fmt({ maximumFractionDigits: 2 }).format(n) : fmt({ notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

/** basis points as a percentage (10000 -> 100%) */
export function bps(n: number | null | undefined): string {
  return ok(n) ? fmt({ maximumFractionDigits: 2 }).format(n / 100) + '%' : '–';
}

export function shortId(s: string | null | undefined, keep = 8): string {
  const t = String(s ?? '');
  return t.length > keep * 2 + 1 ? t.slice(0, keep) + '…' + t.slice(-keep) : t;
}

/** "txid:n" -> [txid, n] (an outpoint of the node's JSON), null when it is not one */
export function outpoint(s: string | null | undefined): [string, number] | null {
  const m = /^([0-9a-f]{64}):(\d+)$/i.exec(String(s ?? ''));
  return m && !/^0{64}$/.test(m[1]) ? [m[1], Number(m[2])] : null;
}

/** a house status as a pill's tone */
export function statusTone(s: HouseStatus | string | null | undefined): 'ok' | 'warn' | 'bad' | '' {
  return s === 'open' ? 'ok' : s === 'stressed' || s === 'deferred' ? 'warn' : s === 'insolvent' || s === 'wounddown' ? 'bad' : '';
}

export const HOUSE_STATUS: Record<string, string> = {
  open: 'open', stressed: 'stressed', deferred: 'suspended (option clause)', insolvent: 'insolvent', wounddown: 'wound down',
};
export function houseStatus(s: string | null | undefined): string {
  return HOUSE_STATUS[String(s)] ?? String(s ?? '–');
}

export const HOUSE_TYPE: Record<string, string> = {
  open: 'open', members: 'members only', redeem: 'redeem only',
};
export function houseType(t: string | null | undefined): string {
  return HOUSE_TYPE[String(t)] ?? String(t ?? '–');
}

/** a house that failed (its claims and token claims matter): insolvent by status or by derivation, or closed */
export function failed(h: House): boolean {
  return h.effective_status === 'insolvent' || h.status === 'insolvent' || h.effective_status === 'wounddown' || !!h.insolvent_since || !!h.closed;
}

/** the bill statuses on chain (freebank src/bill.h BILL_STATUS_*: issued and endorsed both count as active) */
export const BILL_STATUS: Record<string, string> = { a: 'active', r: 'retired', d: 'defaulted', x: 'disputed' };
export function billStatus(s: string | null | undefined): string {
  return BILL_STATUS[String(s)] ?? String(s ?? '–');
}
export function billTone(s: string | null | undefined): 'ok' | 'warn' | 'bad' | 'on' | '' {
  return s === 'a' ? 'on' : s === 'r' ? 'ok' : s === 'd' ? 'bad' : s === 'x' ? 'warn' : '';
}

/** where an active bill stands against the tip: running, in its grace, or past its grace */
export function billTerm(b: Bill, tip: number | null | undefined): { label: string; tone: 'ok' | 'warn' | 'bad' | '' } {
  if (b.status !== 'a' || !ok(tip)) {
    return { label: '', tone: '' };
  }
  if (tip < b.maturity_height) {
    return { label: `matures in ${num(b.maturity_height - tip)} blocks`, tone: '' };
  }
  const graceEnd = b.maturity_height + (b.grace_blocks || 0);
  if (tip < graceEnd) {
    return { label: `matured · ${num(graceEnd - tip)} blocks of grace left`, tone: 'warn' };
  }
  return { label: `past its grace by ${num(tip - graceEnd)} blocks`, tone: 'bad' };
}

/** a node field name as words: words of an underscored or run-together key, with the known ones named */
const LABELS: Record<string, string> = {
  house_id: 'House', bill_id: 'Bill', pool_id: 'Pool', submitter_id: 'Oracle submitter', face_sats: 'Face', amount_sats: 'Amount',
  escrow_sats: 'Escrow', price_units: 'Price (note units)', maturity_height: 'Maturity', grace_blocks: 'Grace (blocks)',
  from_pubkey: 'From (key)', to_pubkey: 'To (key)', units: 'Note units', op: 'Operation', op_name: 'Operation',
};
export function label(key: string): string {
  if (LABELS[key]) {
    return LABELS[key];
  }
  const t = key.replace(/_/g, ' ').replace(/sats$/, '').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : key;
}
