import { createHash } from 'crypto';

/**
 * BIP300 / BIP301 messages as the bip300301_enforcer reads them (lib/messages.rs), on eCash as on Chains. Every
 * message is an OP_RETURN output holding one data push that starts with a 4-byte tag; a slot is one byte.
 *
 *   M1 propose sidechain  d5e0c4af | slot | version(0) | title_len | title | description | hash_id1(32) | hash_id2(20)
 *   M2 ack proposal       d6e1c5df | slot | sha256d(M1 description)       (coinbase)
 *   M3 propose bundle     d45aa943 | slot | M6 id                          (coinbase)
 *   M4 vote on bundles    d77d1776 | form | votes                          (coinbase)
 *   M7 accept BMM         d1617368 | slot | sidechain block hash           (coinbase)
 *   M8 request BMM        00bf00   | slot | sidechain block hash | previous mainchain block hash (output 0 of a tx)
 *
 * Hashes on the wire are in internal byte order; everything returned here is in display order (reversed), the
 * order the node's RPCs print them in and chain/enforcer.ts returns them in.
 */

export type Bip300Kind = 'M1' | 'M2' | 'M3' | 'M4' | 'M7' | 'M8';

export const VOTE_FORMS: Record<number, string> = {
  0: 'repeat-previous',
  1: 'one-byte',
  2: 'two-bytes',
  3: 'leading-by-50',
};

export interface Bip300Message {
  kind: Bip300Kind;
  slot?: number;
  hash?: string;          // M1: proposal id; M2: acked proposal; M3: bundle (M6 id); M7/M8: sidechain block
  prevMainBlock?: string; // M8
  title?: string;         // M1
  description?: string;   // M1
  version?: number;       // M1
  hashId1?: string;       // M1
  hashId2?: string;       // M1
  form?: number;          // M4
  votes?: number[];       // M4: raw entries (one or two bytes each), one per active sidechain in slot order
}

const TAGS: Record<string, Bip300Kind> = {
  d5e0c4af: 'M1',
  d6e1c5df: 'M2',
  d45aa943: 'M3',
  d77d1776: 'M4',
  d1617368: 'M7',
};

export const VOTE_ABSTAIN = 0xffff;
export const VOTE_DOWNVOTE = 0xfffe;

export function reverseHex(hex: string): string {
  return Buffer.from(hex, 'hex').reverse().toString('hex');
}

function sha256d(b: Buffer): Buffer {
  return createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
}

/** The data an OP_RETURN script pushes (one push, any push opcode), or null. */
export function opReturnPayload(script: Buffer): Buffer | null {
  if (script.length < 2 || script[0] !== 0x6a) {
    return null;
  }
  let i = 1;
  const op = script[i++];
  let n: number;
  if (op < 0x4c) {
    n = op;
  } else if (op === 0x4c) {
    if (i >= script.length) { return null; }
    n = script[i++];
  } else if (op === 0x4d) {
    if (i + 2 > script.length) { return null; }
    n = script[i] | (script[i + 1] << 8);
    i += 2;
  } else {
    return null;
  }
  if (i + n > script.length) {
    return null;
  }
  return script.subarray(i, i + n);
}

export function parseBip300Script(scriptHex: string): Bip300Message | null {
  if (!scriptHex || !scriptHex.startsWith('6a')) {
    return null;
  }
  const body = opReturnPayload(Buffer.from(scriptHex, 'hex'));
  if (!body || body.length < 4) {
    return null;
  }
  const tag = body.subarray(0, 4).toString('hex');

  // M8: the slot is the 4th byte of the tag
  if (tag.startsWith('00bf00')) {
    if (body.length < 4 + 32) {
      return null;
    }
    return {
      kind: 'M8',
      slot: body[3],
      hash: reverseHex(body.subarray(4, 36).toString('hex')),
      prevMainBlock: body.length >= 68 ? reverseHex(body.subarray(36, 68).toString('hex')) : undefined,
    };
  }

  const kind = TAGS[tag];
  if (!kind) {
    return null;
  }
  switch (kind) {
    case 'M4': {
      const form = body.length > 4 ? body[4] : 0;
      const raw = body.subarray(5);
      const votes: number[] = [];
      if (form === 1) {
        for (const b of raw) {
          votes.push(b === 0xff ? VOTE_ABSTAIN : b === 0xfe ? VOTE_DOWNVOTE : b);
        }
      } else if (form === 2) {
        for (let i = 0; i + 1 < raw.length; i += 2) {
          votes.push(raw.readUInt16LE(i));
        }
      }
      return { kind, form, votes };
    }
    case 'M2':
    case 'M3':
    case 'M7': {
      if (body.length < 4 + 1 + 32) {
        return null;
      }
      return { kind, slot: body[4], hash: reverseHex(body.subarray(5, 37).toString('hex')) };
    }
    case 'M1': {
      if (body.length < 6) {
        return null;
      }
      const decl = body.subarray(5);
      const msg: Bip300Message = { kind, slot: body[4], hash: sha256d(decl).reverse().toString('hex'), version: decl[0] };
      if (decl[0] === 0 && decl.length >= 2) {
        const n = decl[1];
        if (2 + n <= decl.length) {
          msg.title = decl.subarray(2, 2 + n).toString('utf8');
          let rest = decl.subarray(2 + n);
          if (rest.length >= 52) {
            msg.hashId1 = reverseHex(rest.subarray(rest.length - 52, rest.length - 20).toString('hex'));
            msg.hashId2 = reverseHex(rest.subarray(rest.length - 20).toString('hex'));
            rest = rest.subarray(0, rest.length - 52);
          }
          msg.description = rest.toString('utf8');
        }
      }
      return msg;
    }
  }
  return null;
}

/**
 * eCash's OP_DRIVECHAIN: OP_NOP8 (0xb7). The escrow (treasury) output of each sidechain is
 * OP_DRIVECHAIN 0x01 <slot> OP_TRUE (the enforcer's OpDrivechain::script).
 */
export const OP_DRIVECHAIN = 0xb7;

/** The slot of an escrow output script, or null */
export function escrowSlot(scriptHex: string): number | null {
  const prefix = OP_DRIVECHAIN.toString(16) + '01';
  if (scriptHex && scriptHex.length === 8 && scriptHex.startsWith(prefix) && scriptHex.endsWith('51')) {
    return parseInt(scriptHex.substring(4, 6), 16);
  }
  return null;
}

export function isDrivechainScript(scriptHex: string): boolean {
  return escrowSlot(scriptHex) !== null;
}
