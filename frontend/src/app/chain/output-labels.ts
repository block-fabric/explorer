import { PROFILE, profileBySlot, slotColor } from '@app/chain/profiles';

/**
 * Labels for the outputs of a transaction, read from their scripts (what the transaction page shows in place of a
 * raw OP_RETURN):
 *   BIP300/301 messages: M1 proposal, M2 ack, M3 bundle, M4 votes, M7 BMM accept, M8 BMM request
 *   M5/M6: a sidechain's escrow output, a deposit's destination, a withdrawal's payouts
 *   the witness commitment
 * Sidechain names come from the drivechain API (setSidechainNames, called by DrivechainLiveService).
 */

export interface OutputLabel {
  /** short tag: M7, M5, ... */
  tag: string;
  text: string;
  /** sidechain slot it concerns, for the colour and mark */
  slot?: number;
  color: string;
  /** longer explanation for the tooltip */
  help?: string;
}

interface Vout { scriptpubkey?: string; scriptpubkey_type?: string; value?: number }
interface Vin { prevout?: { scriptpubkey?: string } | null; is_coinbase?: boolean }

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) { out[i] = parseInt(hex.substr(i * 2, 2), 16); }
  return out;
};
const toHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const reversedHex = (b: Uint8Array): string => toHex(Uint8Array.from(b).reverse());
const ascii = (b: Uint8Array): string => Array.from(b, x => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '')).join('');

/** the data pushed by an OP_RETURN script (one push), or null */
export function opReturnData(scriptHex: string): Uint8Array | null {
  if (!scriptHex || !scriptHex.startsWith('6a') || scriptHex.length < 4) { return null; }
  const s = hexToBytes(scriptHex);
  let i = 1;
  const op = s[i++];
  let n: number;
  if (op < 0x4c) { n = op; } else if (op === 0x4c) { n = s[i++]; } else if (op === 0x4d) { n = s[i] | (s[i + 1] << 8); i += 2; } else { return null; }
  if (i + n > s.length) { return null; }
  return s.subarray(i, i + n);
}

/** the slot of an escrow output script (OP_DRIVECHAIN 0x01 <slot> OP_TRUE; eCash's OP_DRIVECHAIN is OP_NOP8, 0xb7), or null */
export function escrowSlot(scriptHex: string): number | null {
  return scriptHex && scriptHex.length === 8 && scriptHex.startsWith('b701') && scriptHex.endsWith('51') ? parseInt(scriptHex.substr(4, 2), 16) : null;
}

let sidechainNames: Record<number, string> = {};

/** The active sidechains' names by slot (their titles, from the enforcer) */
export function setSidechainNames(names: Record<number, string>): void {
  sidechainNames = { ...names };
}

/** a sidechain's name by its slot (the enforcer's title, else the profile's, else 'slot N') */
export function sidechainName(slot: number): string {
  return sideName(slot);
}

function sideName(slot: number): string {
  return sidechainNames[slot] ?? profileBySlot(slot)?.name ?? `slot ${slot}`;
}

function colorOf(slot?: number): string {
  return slot !== undefined ? slotColor(slot) : PROFILE.color;
}

const VOTE_FORMS = ['repeats the previous votes', 'one byte per sidechain', 'two bytes per sidechain', 'upvotes the leaders by 50'];

function bip300(data: Uint8Array): OutputLabel | null {
  if (data.length < 4) { return null; }
  const tag = toHex(data.subarray(0, 4));
  if (tag.startsWith('00bf00') && data.length >= 36) {
    const slot = data[3];
    const block = reversedHex(data.subarray(4, 36));
    return { tag: 'M8', slot, color: colorOf(slot), text: `bid for ${sideName(slot)} ${block.slice(0, 8)}`,
      help: `A bid to have the ${sideName(slot)} block ${block} committed by the miner of this block (BIP301 M8); the bid is this transaction's fee.` };
  }
  switch (tag) {
    case 'd1617368': {
      // M7 BMM accept
      const slot = data[4];
      const block = data.length >= 37 ? reversedHex(data.subarray(5, 37)) : '';
      return { tag: 'M7', slot, color: colorOf(slot), text: `${sideName(slot)} block ${block.slice(0, 8)}`,
        help: `This block commits to the ${sideName(slot)} block ${block} (BIP301 M7).` };
    }
    case 'd77d1776': {
      const form = data[4] ?? 0;
      const votes = Array.from(data.subarray(5));
      const cast = form === 1 ? votes.filter(v => v !== 0xff) : [];
      return { tag: 'M4', color: PROFILE.color, text: form === 1 ? `votes · ${cast.length} cast` : `votes · ${VOTE_FORMS[form] ?? 'form ' + form}`,
        help: `The vote of this block on the pending withdrawal bundles (BIP300 M4, ${VOTE_FORMS[form] ?? 'form ' + form}). The block page lists them.` };
    }
    case 'd45aa943': {
      const slot = data[4];
      const bundle = data.length >= 37 ? reversedHex(data.subarray(5, 37)) : '';
      return { tag: 'M3', slot, color: colorOf(slot), text: `${sideName(slot)} bundle ${bundle.slice(0, 8)}`, help: `BIP300 M3: bundle ${bundle}.` };
    }
    case 'd6e1c5df': {
      const slot = data[4];
      return { tag: 'M2', slot, color: colorOf(slot), text: `ack · slot ${slot}`, help: 'BIP300 M2: this block acks the sidechain proposal for this slot.' };
    }
    case 'd5e0c4af': {
      const slot = data[4];
      const decl = data.subarray(5);
      const title = decl[0] === 0 && decl.length > 2 ? ascii(decl.subarray(2, 2 + decl[1])) : '';
      return { tag: 'M1', slot, color: colorOf(slot), text: `proposal · ${title || 'slot ' + slot}`, help: 'BIP300 M1: a sidechain proposed for this slot.' };
    }
    case 'aa21a9ed':
      return { tag: 'SegWit', color: '#9a9788', text: 'Witness commitment' };
  }
  return null;
}

/** The label of an input that spends a sidechain's escrow */
export function labelEscrowInput(scriptHex: string | undefined): OutputLabel | null {
  const slot = escrowSlot(scriptHex ?? '');
  return slot === null ? null : { tag: 'escrow', slot, color: colorOf(slot), text: `${sideName(slot)} escrow`,
    help: `The previous escrow output of ${sideName(slot)}: deposits and withdrawals each spend it and create the next one.` };
}

const ecx = (sats: number): string => (sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 }) + ' ' + PROFILE.unit;

interface VinFull extends Vin { prevout?: { scriptpubkey?: string; value?: number } | null }

/** Labels for every output of a transaction (null where there is nothing to say) */
export function labelOutputs(vin: VinFull[], vout: Vout[]): (OutputLabel | null)[] {
  const out: (OutputLabel | null)[] = vout.map(() => null);
  const escrowIn = (vin ?? []).find(v => escrowSlot(v?.prevout?.scriptpubkey ?? '') !== null);
  const escrowInSlot = escrowIn ? escrowSlot(escrowIn.prevout!.scriptpubkey!) : null;
  // a withdrawal (M6) spends the escrow and nothing else; a deposit (M5) spends it along with the depositor's coins
  const withdrawal = escrowInSlot !== null && (vin ?? []).length === 1;
  for (let i = 0; i < vout.length; i++) {
    const script = vout[i].scriptpubkey ?? '';
    const slot = escrowSlot(script);
    if (slot !== null) {
      if (withdrawal) {
        const paid = (escrowIn?.prevout?.value ?? 0) - (vout[i].value ?? 0);
        out[i] = { tag: 'M6', slot, color: colorOf(slot), text: `${sideName(slot)} escrow, ${ecx(paid)} out`,
          help: `The escrow of ${sideName(slot)} after this withdrawal: ${ecx(paid)} left it for the payouts and the fee (BIP300 M6).` };
      } else {
        const added = (vout[i].value ?? 0) - (escrowIn?.prevout?.value ?? 0);
        out[i] = { tag: 'M5', slot, color: colorOf(slot), text: `${sideName(slot)} escrow, +${ecx(added)}`,
          help: `A deposit of ${ecx(added)} into the escrow of ${sideName(slot)} (BIP300 M5), credited on the sidechain to the destination in the next output.` };
        const dest = i + 1 < vout.length ? opReturnData(vout[i + 1].scriptpubkey ?? '') : null;
        if (dest) {
          const text = ascii(dest);
          const m = /^s(\d+)_(.+)_([0-9a-f]{6})$/.exec(text);
          out[i + 1] = { tag: 'M5', slot, color: colorOf(slot), text: `to ${m ? m[2] : text}`, help: `The address on ${sideName(slot)} that receives the deposit (${text}).` };
          i++;
        }
      }
      continue;
    }
    const data = opReturnData(script);
    if (data) {
      out[i] = bip300(data)
        ?? (withdrawal ? { tag: 'M6', slot: escrowInSlot!, color: colorOf(escrowInSlot!), text: 'Withdrawal bundle data', help: 'Data the sidechain attached to this withdrawal bundle.' } : null);
      continue;
    }
    if (withdrawal && (vout[i].value ?? 0) > 0) {
      out[i] = { tag: 'M6', slot: escrowInSlot!, color: colorOf(escrowInSlot!), text: `Withdrawal from ${sideName(escrowInSlot!)}`,
        help: 'Paid out of the sidechain escrow by a withdrawal bundle the miners voted for (BIP300 M6).' };
    }
  }
  return out;
}
