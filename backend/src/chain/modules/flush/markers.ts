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
