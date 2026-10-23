import { createHash } from 'crypto';

/**
 * FreeBank's transactions, read from their raw hex: the credit operation of versions 11-17, the asset genesis of
 * version 10 and the peg and protocol outputs. freebankd's getrawtransaction names the op but leaves its payload as
 * bytes, and stock Bitcoin parsers refuse the serialization (the replay byte, the trailers).
 *
 * Ported from FreeBank's own explorer, mbdrivechains/freebank-explorer @ e3ad60793 (AGPL-3.0), backend/src/api/
 * freebank/: freebank-tx-parser.ts (ByteReader, readFreebankTx, decodeCreditPayload, the op names, keyIdToAddress),
 * peg-parser.ts (the peg outputs) and freebank-tx-flags.ts (the coinbase tags, the deposit payout rule). Changed
 * here: one module; decoded lists are arrays capped at LIST_MAX (the member addresses, a netting round's houses, a
 * bundle's payouts) where theirs were comma-joined strings; a payload that does not fit its layout is an error, not
 * {}; peg fields are camelCase; the other coinbase commitments (previous blocks, block version, witness) are named;
 * a deposit record names its payout output. Left out: the Goggles flag bits, custody tags, house badges and the
 * indexes. Layouts checked against freebank (MIT) src/primitives/transaction.h, bill.h, house.h, note.h, deposit.h,
 * pool.h, settle.h, oracle.h, token.h, sidechain.h and validation.cpp Generate*Commit.
 *
 *   int32   nVersion                 (little-endian)
 *   uint8   replay byte 0x3f         version 3 only (the default version); not 10-17
 *   [0x00, flags]                    segwit extended format, as Bitcoin Core
 *   vin, vout                        as Bitcoin Core
 *   witness                          one stack per input, when flags & 1
 *   uint32  nLockTime
 *   trailer, by version              10: string ticker, string headline, uint256 payload, uint8 decimals
 *                                    11-17: uint8 op, compact-size-length payload
 *
 * The txid is sha256d over the serialization without the witness, which keeps the replay byte and the trailer.
 */

export type CreditFamily = 'bill' | 'house' | 'note' | 'deposit' | 'pool' | 'settle' | 'oracle';

/** transaction.h: TRANSACTION_BILL_VERSION = 11 ... TRANSACTION_ORACLE_VERSION = 17 */
export const CREDIT_FAMILY_BY_VERSION: Readonly<Record<number, CreditFamily>> = {
  11: 'bill', 12: 'house', 13: 'note', 14: 'deposit', 15: 'pool', 16: 'settle', 17: 'oracle',
};

/** transaction.h TRANSACTION_BITASSET_CREATE_VERSION (v0.2.18) */
export const ASSET_GENESIS_VERSION = 10;

/** The most items a decoded list echoes (member addresses, a netting round's houses, a bundle's payouts) */
export const LIST_MAX = 20;

/**
 * Op bytes, named after the header constants without the family prefix, lower-cased (HOUSE_OP_ATTEST: attest).
 * settle 2 PRESENT and 3 DRAW are reserved, not live.
 */
export const CREDIT_OP_NAMES: Readonly<Record<CreditFamily, Readonly<Record<number, string>>>> = {
  bill: {
    1: 'issue', 2: 'endorse', 3: 'retire', 4: 'claim', 5: 'discount', 6: 'recourse', 7: 'hretire', 8: 'hclaim',
    9: 'hretire_notes', 10: 'hretire_escrow', 11: 'hclaim_escrow', // v0.2.27 repay in kind; v0.2.28 into the escrow
  },
  house: {
    1: 'register', 2: 'topup', 3: 'admit', 4: 'exit', 5: 'winddown', 6: 'reclaim', 7: 'attest', 8: 'defer', 9: 'renew',
    10: 'release', 11: 'register_mo', 12: 'member_add', 13: 'member_remove', 14: 'member_purge', // v0.2.19 members-only
    15: 'close', // v0.2.28 a failed house closed after its claim window
  },
  note: {
    1: 'mint', 2: 'transfer', 3: 'redeem', 4: 'lock', 5: 'unlock', 6: 'claim', 7: 'demand', 8: 'protest',
    9: 'token_keyset', 10: 'token_post', 11: 'token_claim', 12: 'token_collect', // v0.2.21 token.h
  },
  deposit: {
    1: 'originate', 2: 'transfer', 3: 'withdraw', 4: 'claim',
    5: 'demand', 6: 'protest', 7: 'discharge', // v0.2.29 forced payment of a matured deposit
  },
  pool: { 1: 'create', 2: 'add_liq', 3: 'remove_liq', 4: 'swap', 5: 'retire' },
  settle: { 1: 'exchange', 4: 'net' }, // 4: v0.2.22 multilateral netting
  oracle: { 1: 'bond', 2: 'submit' },
};

/** The op's name, or op_<n> for a byte the headers do not define */
export function creditOpName(family: CreditFamily, op: number): string {
  return CREDIT_OP_NAMES[family]?.[op] ?? `op_${op}`;
}

export class FreebankParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FreebankParseError';
  }
}

/** serialize.h MAX_SIZE: the largest compact size ReadCompactSize accepts */
const MAX_COMPACT_SIZE = 0x02000000;
const TWO_POW_32 = 0x100000000;

/** Little-endian reads over a Buffer, each bounds-checked */
export class ByteReader {
  public pos = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.buf.length) {
      throw new FreebankParseError(`truncated: need ${n} byte(s) at offset ${this.pos}, ${this.buf.length - this.pos} left`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  u16(): number {
    this.need(2);
    this.pos += 2;
    return this.buf.readUInt16LE(this.pos - 2);
  }

  u32(): number {
    this.need(4);
    this.pos += 4;
    return this.buf.readUInt32LE(this.pos - 4);
  }

  i32(): number {
    this.need(4);
    this.pos += 4;
    return this.buf.readInt32LE(this.pos - 4);
  }

  /** As a number: exact to 2^53, past every amount consensus allows (SETTLE_MAX_UNITS = 3 * MAX_MONEY) */
  u64(): number {
    this.need(8);
    this.pos += 8;
    return this.buf.readUInt32LE(this.pos - 4) * TWO_POW_32 + this.buf.readUInt32LE(this.pos - 8);
  }

  i64(): number {
    this.need(8);
    this.pos += 8;
    return this.buf.readInt32LE(this.pos - 4) * TWO_POW_32 + this.buf.readUInt32LE(this.pos - 8);
  }

  /** A view into the buffer (not a copy) */
  bytes(n: number): Buffer {
    this.need(n);
    this.pos += n;
    return this.buf.subarray(this.pos - n, this.pos);
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  /** serialize.h ReadCompactSize, with its canonical-encoding and MAX_SIZE checks */
  compactSize(): number {
    const first = this.u8();
    let v: number;
    if (first < 0xfd) {
      v = first;
    } else if (first === 0xfd) {
      v = this.u16();
      if (v < 0xfd) {
        throw new FreebankParseError('non-canonical compact size');
      }
    } else if (first === 0xfe) {
      v = this.u32();
      if (v < 0x10000) {
        throw new FreebankParseError('non-canonical compact size');
      }
    } else {
      v = this.u64();
      if (v < TWO_POW_32) {
        throw new FreebankParseError('non-canonical compact size');
      }
    }
    if (v > MAX_COMPACT_SIZE) {
      throw new FreebankParseError('compact size too large');
    }
    return v;
  }

  /** A std::vector<unsigned char> */
  varBytes(): Buffer {
    return this.bytes(this.compactSize());
  }

  /** A std::string */
  varString(): string {
    return this.varBytes().toString('utf8');
  }

  /** A std::vector of 64-bit values: its count and sum */
  u64VectorSum(): { count: number; sum: number } {
    const count = this.compactSize();
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += this.u64();
    }
    return { count, sum };
  }

  /** A uint256 as Core prints it (reversed) */
  hash256(): string {
    return reverseHex(this.bytes(32));
  }
}

function reverseHex(b: Buffer): string {
  return Buffer.from(b).reverse().toString('hex');
}

function sha256d(b: Buffer): Buffer {
  return createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
}

export interface ParsedTx {
  txid: string;
  version: number;
  vin: { txid: string; vout: number }[];
  vout: { value: number; scriptpubkey: string }[];
  /** v11-v17 */
  family: CreditFamily | null;
  op: number | null;
  payload: Buffer | null;
  /** v10 */
  asset: { ticker: string; headline: string; payload: string; decimals: number } | null;
}

/** Where a transaction's parts lie in its buffer */
interface TxSpan {
  start: number;
  /** after nVersion and the v3 replay byte */
  headerEnd: number;
  /** the vin count, after the segwit marker and flags */
  bodyStart: number;
  /** after the last output */
  bodyEnd: number;
  locktimeStart: number;
  /** after the trailer */
  end: number;
}

/** A whole FreeBank transaction from hex. Throws FreebankParseError. */
export function parseTx(hex: string): ParsedTx {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new FreebankParseError('not a hex string');
  }
  const buf = Buffer.from(hex, 'hex');
  const r = new ByteReader(buf);
  const { tx } = readTx(r, buf);
  if (r.remaining !== 0) {
    throw new FreebankParseError(`${r.remaining} trailing byte(s) after the transaction`);
  }
  return tx;
}

/** One transaction at the reader's position (also one inside a peg record), and where its parts lie */
function readTx(r: ByteReader, buf: Buffer): { tx: ParsedTx; span: TxSpan } {
  const start = r.pos;
  const version = r.i32();
  if (version === 3) {
    r.u8(); // the replay byte
  }
  const headerEnd = r.pos;

  // UnserializeTransaction: an empty vin then a non-zero flags byte is the extended format
  let bodyStart = headerEnd;
  let flags = 0;
  let vinCount = r.compactSize();
  let readVout = true;
  if (vinCount === 0) {
    flags = r.u8();
    if (flags !== 0) {
      bodyStart = r.pos;
      vinCount = r.compactSize();
    } else {
      readVout = false; // Core reads neither again in this degenerate case
    }
  }
  const vin: ParsedTx['vin'] = [];
  for (let i = 0; i < vinCount; i++) {
    const txid = r.hash256();
    const vout = r.u32();
    r.varBytes(); // scriptSig
    r.u32(); // nSequence
    vin.push({ txid, vout });
  }
  const vout: ParsedTx['vout'] = [];
  if (readVout) {
    const count = r.compactSize();
    for (let i = 0; i < count; i++) {
      const value = r.i64();
      vout.push({ value, scriptpubkey: r.varBytes().toString('hex') });
    }
  }
  const bodyEnd = r.pos;
  if (flags & 1) {
    flags ^= 1;
    for (let i = 0; i < vin.length; i++) {
      const items = r.compactSize();
      for (let j = 0; j < items; j++) {
        r.varBytes();
      }
    }
  }
  if (flags) {
    throw new FreebankParseError('unknown transaction optional data');
  }
  const locktimeStart = r.pos;
  r.u32();

  let family: CreditFamily | null = null;
  let op: number | null = null;
  let payload: Buffer | null = null;
  let asset: ParsedTx['asset'] = null;
  if (version === ASSET_GENESIS_VERSION) {
    const ticker = r.varString();
    const headline = r.varString();
    const assetPayload = r.hash256();
    asset = { ticker, headline, payload: assetPayload, decimals: r.u8() }; // decimals: v0.2.18, as v10 itself
  } else if (CREDIT_FAMILY_BY_VERSION[version]) {
    family = CREDIT_FAMILY_BY_VERSION[version];
    op = r.u8();
    payload = r.varBytes();
  }
  const end = r.pos;

  const stripped = bodyStart !== headerEnd || flags !== 0
    ? Buffer.concat([buf.subarray(start, headerEnd), buf.subarray(bodyStart, bodyEnd), buf.subarray(locktimeStart, end)])
    : buf.subarray(start, end);
  return {
    tx: { txid: reverseHex(sha256d(stripped)), version, vin, vout, family, op, payload, asset },
    span: { start, headerEnd, bodyStart, bodyEnd, locktimeStart, end },
  };
}

/** A coinbase: one input spending the null outpoint */
export function isCoinbase(tx: ParsedTx): boolean {
  return tx.vin.length === 1 && tx.vin[0].vout === 0xffffffff && /^0{64}$/.test(tx.vin[0].txid);
}

const FREEBANK_ADDRESS_VERSION = 75; // chainparams PUBKEY_ADDRESS: X...
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** The base58check address of a 20-byte key id (EncodeDestination(CKeyID)) */
export function keyIdToAddress(keyId: Buffer): string {
  const body = Buffer.concat([Buffer.from([FREEBANK_ADDRESS_VERSION]), keyId]);
  const full = Buffer.concat([body, sha256d(body).subarray(0, 4)]);
  let n = BigInt('0x' + full.toString('hex'));
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (let i = 0; i < full.length && full[i] === 0; i++) {
    out = '1' + out;
  }
  return out;
}

/** The address of a P2PKH script, or null for any other script */
function p2pkhAddress(script: Buffer): string | null {
  if (script.length !== 25 || script[0] !== 0x76 || script[1] !== 0xa9 || script[2] !== 0x14 || script[23] !== 0x88 || script[24] !== 0xac) {
    return null;
  }
  return keyIdToAddress(script.subarray(3, 23));
}

// ------------------------------------------------------------------------------------------------ credit payloads

export type FieldValue = number | string | boolean | null | number[] | string[];
export type Fields = { [field: string]: FieldValue };

/**
 * A credit payload's leading fields: which house, bill, pool or submitter the op touches and what it moves. Reads only
 * as far as it needs (signatures and undo priors after are not read). {} for an op byte the headers do not define.
 * Throws FreebankParseError when the payload does not fit its layout.
 *
 * Units: *_sats ECX in satoshis; *_units note units (1 unit of face = 1 sat, par by consensus); *_height heights.
 */
export function decodeCreditPayload(family: CreditFamily, op: number, payload: Buffer): Fields {
  const r = new ByteReader(payload);
  switch (family) {
    case 'bill': return decodeBill(r, op);
    case 'house': return decodeHouse(r, op);
    case 'note': return decodeNote(r, op);
    case 'deposit': return decodeDeposit(r, op);
    case 'pool': return decodePool(r, op);
    case 'settle': return decodeSettle(r, op);
    case 'oracle': return decodeOracle(r, op);
    default: return {};
  }
}

function decodeBill(r: ByteReader, op: number): Fields {
  switch (op) {
    case 1: { // BillIssue: the node assigns the bill id
      r.varBytes(); // vchEncryptedBody
      const face_sats = r.i64();
      const maturity_height = r.u32();
      return { face_sats, maturity_height, grace_blocks: r.u32() };
    }
    case 2: { // BillEndorse: nBillID, then the endorsement's from and to keys (nAtHeight, vchSig after)
      const bill_id = r.u32();
      const from_pubkey = r.varBytes().toString('hex');
      return { bill_id, from_pubkey, to_pubkey: r.varBytes().toString('hex') };
    }
    case 3: // BillRetire
    case 4: // BillClaim
    case 6: // BillRecourse
      return { bill_id: r.u32() };
    case 5: { // BillDiscount: a house buys the bill into its loan book, paying in its notes
      const bill_id = r.u32();
      const house_id = r.u32();
      const price_units = r.i64();
      const face_sats = r.i64();
      return { bill_id, house_id, price_units, face_sats, maturity_height: r.u32() };
    }
    case 7: // BillHRetire: the acceptor pays a house-held bill
    case 8: // BillHClaim: the house claims the escrow of a house-held bill
    case 11: // BillHClaimEscrow (v0.2.28): anyone moves a defaulted house-held bill's bond into the house's escrow
    case 9: // BillHRetireNotes (v0.2.27): op 7 paid partly or wholly in the house's own notes, burned
    case 10: { // the same payload (v0.2.28): the face into a failed house's escrow; units_burned may be 0
      const bill_id = r.u32();
      const house_id = r.u32(); // nOwnerHouseID
      const face_sats = r.i64();
      const maturity_height = r.u32();
      if (op === 9 || op === 10) {
        return { bill_id, house_id, face_sats, maturity_height, units_burned: r.u64() }; // at par; the rest in ECX
      }
      return { bill_id, house_id, face_sats, maturity_height };
    }
    default:
      return {};
  }
}

/** house.h HOUSE_FLAG_* (v0.2.19), fixed at registration */
function houseType(flags: number): string {
  return flags & 2 ? 'redeem' : flags & 1 ? 'members' : 'open';
}

function decodeHouse(r: ByteReader, op: number): Fields {
  switch (op) {
    case 1: { // HouseRegister: the node assigns the house id
      const tier = r.u8();
      const threshold = r.u32();
      const classid = r.varString();
      const denominationmggold = r.u64();
      r.varBytes(); // vchRedemptionDestPK
      const partners = r.compactSize(); // vPartnerPubKey
      for (let i = 0; i < partners; i++) {
        r.varBytes();
      }
      const pledges = r.compactSize(); // vPledgeAmount
      let pledge_sats = 0;
      for (let i = 0; i < pledges; i++) {
        pledge_sats += r.i64();
      }
      return { tier, threshold, classid, denominationmggold, partners, pledge_sats };
    }
    case 11: { // HouseRegisterMO (v0.2.19): a HouseRegister, the partners' signatures, then the house-type flags
      const register = decodeHouse(r, 1);
      const sigs = r.compactSize(); // vPartnerSig
      for (let i = 0; i < sigs; i++) {
        r.varBytes();
      }
      return { ...register, house_type: houseType(r.u8()) };
    }
    case 12: // HouseMemberOp: MEMBER_ADD
    case 13: // MEMBER_REMOVE (final MEMBER_REMOVE_DELAY blocks out)
    case 14: { // MEMBER_PURGE (deletes records whose removal is final)
      const house_id = r.u32();
      const members = r.compactSize(); // vKeyID
      const member_addresses: string[] = [];
      for (let i = 0; i < members; i++) {
        const keyId = r.bytes(20);
        if (i < LIST_MAX) {
          member_addresses.push(keyIdToAddress(keyId));
        }
      }
      return { house_id, members, member_addresses };
    }
    case 2: // HouseTopup
    case 4: // HouseExit
    case 6: { // HouseReclaim
      const house_id = r.u32();
      return { house_id, partner_index: r.u32() };
    }
    case 7: { // HouseAttest
      const house_id = r.u32();
      const schema = r.u8();
      const as_of_height = r.u32();
      // nPrevLastAttestHeight, nPrevStressSince, amountPrevReserves, then four defer priors
      r.skip(4 + 4 + 8 + 4 * 4);
      return schema === 1 ? { house_id, as_of_height, reserves_sats: r.i64() } : { house_id, as_of_height };
    }
    case 3: // HouseAdmit
    case 5: // HouseWinddown
    case 8: // HouseDefer
    case 9: // HouseRenew
    case 10: // HouseRelease
    case 15: // HouseClose (v0.2.28): the outputs are pinned (the partners' residual, then the mutual fund)
      return { house_id: r.u32() };
    default:
      return {};
  }
}

/** note.h NOTE_DEMAND_MODE_* (v0.2.18) */
const NOTE_DEMAND_MODES: Readonly<Record<number, string>> = { 0: 'plain', 1: 'preauth', 2: 'preauth_queue' };

function decodeNote(r: ByteReader, op: number): Fields {
  if (!CREDIT_OP_NAMES.note[op]) {
    return {};
  }
  const house_id = r.u32(); // every note payload leads with nHouseID
  switch (op) {
    case 1: // NoteMint
    case 2: // NoteTransfer
    case 8: { // NoteProtest
      const units = r.u64VectorSum(); // vUnits, one per note output
      return { house_id, units: units.sum, outputs: units.count };
    }
    case 4: { // NoteLock (v0.2.20): the token mint record; the spent notes back the house's tokens
      const units = r.u64();
      const change = r.u64VectorSum(); // vChangeUnits: change notes back to the holder
      return { house_id, units, change_units: change.sum, outputs: change.count };
    }
    case 5: { // NoteUnlock (v0.2.20): the token burn record; the backing back as note coins
      const units = r.u64VectorSum();
      return { house_id, units: units.sum, outputs: units.count };
    }
    case 7: { // NoteDemand
      const units = r.u64VectorSum();
      r.varBytes(); // vchHolderPubKey
      r.varBytes(); // vchHolderSig
      const mode = r.u8();
      const prior_demand_height = r.u32(); // non-zero only on the upgrade of a plain demand (keeps its clock)
      return { house_id, units: units.sum, outputs: units.count, demand_mode: NOTE_DEMAND_MODES[mode] ?? `mode_${mode}`, prior_demand_height };
    }
    case 9: { // NoteTokenKeyset (v0.2.21): a posting key, then one key per amount 2^i
      r.varBytes(); // vchPostingPubKey
      const keys = r.compactSize();
      let maxExp = 0;
      for (let i = 0; i < keys; i++) {
        maxExp = Math.max(maxExp, r.u8()); // nExp
        r.varBytes(); // vchPubKey
      }
      return { house_id, keys, largest_amount: keys ? 2 ** maxExp : 0 };
    }
    case 10: { // NoteTokenPost (v0.2.21): what the mint signed, and the tokens it marked spent
      const keyset_id = reverseHex(r.bytes(8)); // uint64, as gettokenclaims prints it (%016x)
      const issued = r.compactSize();
      let issued_units = 0;
      for (let i = 0; i < issued; i++) {
        r.varBytes(); // B_
        issued_units += r.u64();
      }
      const spent = r.compactSize();
      r.skip(32 * spent);
      return { house_id, keyset_id, issued, issued_units, spent };
    }
    case 11: { // NoteTokenClaim (v0.2.21): holders claim a failed house's token backing, token by token
      const tokens = r.compactSize();
      let claimed_units = 0;
      for (let i = 0; i < tokens; i++) {
        r.u64(); // nKeysetID
        claimed_units += r.u64();
        for (let f = 0; f < 6; f++) {
          r.varBytes(); // secret, B_, C_, DLEQ e, DLEQ s, payout script
        }
        r.u16(); // nFeeBps
        r.varBytes(); // relayer script
        r.varBytes(); // sig
      }
      return { house_id, tokens, claimed_units };
    }
    case 12: { // NoteTokenCollect (v0.2.21): after the window, the claims are paid ECX from the escrow
      const escrow_change = r.u8() !== 0;
      const claims = r.compactSize();
      r.skip(32 * claims);
      return { house_id, claims, escrow_change };
    }
    default: // NoteRedeem, NoteClaim
      return { house_id };
  }
}

/** note.h: a demand tag is the height with the mode bits on top (also on demanded deposit receipts, v0.2.29) */
const DEMAND_HEIGHT_MASK = 0x1fffffff;

function decodeDeposit(r: ByteReader, op: number): Fields {
  if (!CREDIT_OP_NAMES.deposit[op]) {
    return {};
  }
  const house_id = r.u32(); // every deposit payload leads with nHouseID
  switch (op) {
    case 1: { // DepositOriginate: one or more receipts
      const principal = r.u64VectorSum();
      return { house_id, principal_units: principal.sum, receipts: principal.count };
    }
    case 2: // DepositTransfer: one whole receipt changes hands
    case 5: // DepositDemand (v0.2.29): the matured receipt into custody, with a pre-authorised payout
    case 6: { // DepositProtest (v0.2.29): unpaid nDemandWindow blocks after the demand
      const principal_units = r.u64();
      const rate_bps = r.u32();
      const maturity_height = r.u32();
      if (op === 2) {
        return { house_id, principal_units, rate_bps, maturity_height };
      }
      const origination_height = r.u32();
      if (op === 5) {
        r.varBytes(); // vchHolderPubKey
        const payout_address = p2pkhAddress(r.varBytes()); // vchPayoutScript: where the house must pay
        return { house_id, principal_units, rate_bps, maturity_height, origination_height, payout_address };
      }
      const demand_height = r.u32() & DEMAND_HEIGHT_MASK; // nDemandTag
      return { house_id, principal_units, rate_bps, maturity_height, origination_height, demand_height };
    }
    case 7: { // DepositDischarge (v0.2.29): anyone pays a demanded receipt to its payout script at vout[0]
      r.varBytes(); // vchHolderPubKey
      return { house_id, payout_address: p2pkhAddress(r.varBytes()) };
    }
    default: // DepositWithdraw, DepositClaim
      return { house_id };
  }
}

function decodePool(r: ByteReader, op: number): Fields {
  if (!CREDIT_OP_NAMES.pool[op]) {
    return {};
  }
  const pool_id = r.u32(); // the house id (one pool per house)
  const base = { pool_id, house_id: pool_id };
  switch (op) {
    case 1: { // PoolCreate
      const fee_bps = r.u32();
      const note_units = r.u64();
      return { ...base, fee_bps, note_units, ecx_sats: r.i64() };
    }
    case 2: { // PoolAddLiq
      r.skip(8 * 3); // prior X, Y, S
      const note_units = r.u64();
      const ecx_sats = r.i64();
      return { ...base, note_units, ecx_sats, lp_minted: r.u64() };
    }
    case 3: { // PoolRemoveLiq
      r.skip(8 * 3);
      const lp_burned = r.u64();
      const note_units_out = r.u64();
      return { ...base, lp_burned, note_units_out, ecx_sats_out: r.i64() };
    }
    case 4: { // PoolSwap: direction 1 notes in, ECX out; 2 ECX in, notes out
      r.skip(8 * 3);
      const direction = r.u8();
      const amount_in = r.u64();
      r.skip(8); // nMinOut
      const amount_out = r.u64();
      const name = direction === 1 ? 'notes_for_ecx' : direction === 2 ? 'ecx_for_notes' : `direction_${direction}`;
      return { ...base, direction: name, amount_in, amount_out };
    }
    default: // PoolRetire
      return base;
  }
}

function decodeSettle(r: ByteReader, op: number): Fields {
  if (op === 4) {
    return decodeSettleNet(r);
  }
  if (op !== 1) {
    return {};
  }
  // SettleExchange: houses A (the lower id) and B present each other's notes at par; the house whose paper came home
  // more (the debtor) pays the difference in ECX to the other
  const house_a_id = r.u32();
  const house_b_id = r.u32();
  const mode = r.u8(); // 0 a pure swap, 1 with a residual payment
  const house_a_notes_units = r.u64(); // A's notes presented
  const house_b_notes_units = r.u64();
  r.skip(2 + 2); // bundle sizes
  r.varBytes(); // presentment key of the A-note bundle
  r.varBytes(); // of the B-note bundle
  const residual_sats = r.i64();
  r.skip(8 + 8 + 4 + 4); // undo priors: minted units A/B, last settle height A/B
  const expiry_height = r.u32();
  const diff = house_a_notes_units - house_b_notes_units;
  return {
    house_a_id, house_b_id, mode, house_a_notes_units, house_b_notes_units, residual_sats,
    debtor_house_id: diff > 0 ? house_a_id : diff < 0 ? house_b_id : null,
    creditor_house_id: diff > 0 ? house_b_id : diff < 0 ? house_a_id : null,
    expiry_height,
  };
}

/**
 * SettleNet (v0.2.22): N houses hand in each other's notes (all burned); only net positions are paid, at par, to each
 * net creditor. Per house, parallel to house_ids (ascending, the first LIST_MAX): units of its notes retired, its net
 * (presented less presented-of) and what it was paid.
 */
function decodeSettleNet(r: ByteReader): Fields {
  const houses = r.compactSize();
  const ids: number[] = [];
  for (let i = 0; i < houses; i++) {
    ids.push(r.u32());
  }
  const receive: number[] = [];
  const nReceive = r.compactSize();
  for (let i = 0; i < nReceive; i++) {
    receive.push(r.i64());
  }
  r.skip(8 * r.compactSize()); // vPrevMintedUnits
  r.skip(4 * r.compactSize()); // vPrevLastSettleHeight
  const keys = r.compactSize(); // vPresentKey
  for (let i = 0; i < keys; i++) {
    r.varBytes();
  }
  const retired = new Map<number, number>();
  const presented = new Map<number, number>();
  const bundles = r.compactSize();
  for (let i = 0; i < bundles; i++) {
    const presenter = r.u32();
    const issuer = r.u32();
    const units = r.u64();
    r.u16(); // coin count
    presented.set(presenter, (presented.get(presenter) ?? 0) + units);
    retired.set(issuer, (retired.get(issuer) ?? 0) + units);
  }
  const expiry_height = r.u32();
  const shown = ids.slice(0, LIST_MAX);
  let total_retired_units = 0;
  retired.forEach((u) => total_retired_units += u);
  return {
    houses,
    house_ids: shown,
    units_retired: shown.map((id) => retired.get(id) ?? 0),
    nets: shown.map((id) => (presented.get(id) ?? 0) - (retired.get(id) ?? 0)),
    received_sats: shown.map((_, i) => receive[i] ?? 0),
    total_retired_units,
    paid_sats: receive.reduce((s, v) => s + v, 0),
    bundles,
    expiry_height,
  };
}

function decodeOracle(r: ByteReader, op: number): Fields {
  if (!CREDIT_OP_NAMES.oracle[op]) {
    return {};
  }
  const submitter_id = r.u32(); // bond: 0 for a new submitter
  const target_height = r.u32();
  if (op === 1) { // OracleBond
    return { submitter_id, target_height, pubkey: r.varBytes().toString('hex') };
  }
  // OracleSubmit: milligrams of gold per 1000 ECX (the getgoldfix unit)
  return { submitter_id, target_height, price_mg: r.u64() };
}

// ------------------------------------------------------------------------------------------------ peg outputs

/**
 * Peg and protocol outputs: OP_RETURN then a raw 4-byte tag (not a push). sidechain.cpp SidechainObj::GetScript writes
 * the objects after acdcf66f and a type byte, serialized as the node stores them (a tx with its witness);
 * validation.cpp Generate*Commit the coinbase's commitments and GenerateWithdrawalRefundRequest the refund request.
 *
 *   deposit       acdcf66f 'D' | slot | dest | amount | eCash tx | burn index | tx index | eCash block   coinbase
 *   bundle        acdcf66f 'P' | slot | bundle tx | withdrawal ids | (status, heights, not read)        any tx
 *   withdrawal    acdcf66f 'W' | slot | dest | refund dest | amount | eCash fee | status | blind hash  any tx
 *   refund        fcd2e546 | withdrawal id | signature (65); 102 bytes                                  any tx
 *   bundle-hash   ef5d1dfe | hash (the current bundle); bundle-paid fb5345de; bundle-failed fa86c689    coinbase
 *   prev-blocks   fd7ad1ef | previous eCash block | previous FreeBank block                             coinbase
 *   block-version a7e67e1f | 4 bytes (CScriptNum of the version, copied 4 bytes wide)                   coinbase
 *   witness       aa21a9ed (a 36-byte push): the BIP 141 commitment                                    coinbase
 *
 * Deposit records count only in the coinbase (CheckBlock VerifyDeposit reads vtx[0]); one elsewhere is 'stray'.
 * Bundles, withdrawals and refund requests count in any tx (ConnectBlock reads every tx of a block). Hashes and txids
 * are printed reversed, as the node prints them.
 */

export type PegOutput =
  | { kind: 'deposit'; vout: number; slot: number; dest: string; amount: number; ecashTxid: string; ecashBlock: string;
      ecashTxIndex: number; burnIndex: number; treasuryValue: number | null; bundlePayment: boolean;
      payoutVout: number | null; ecashOutputs?: { value: number; scriptpubkey: string }[] }
  | { kind: 'bundle'; vout: number; slot: number; bundleHash: string; m6id: string; format: 'cusf' | 'legacy' | 'unknown';
      ecashFee: number | null; total: number; withdrawals: number; withdrawalIds: string[];
      payouts: { vout: number; value: number; scriptpubkey: string; withdrawalId: string | null }[] }
  | { kind: 'withdrawal'; vout: number; slot: number; id: string; destRaw: string; refundDest: string; amount: number;
      ecashFee: number; payout: number }
  | { kind: 'refund-request'; vout: number; withdrawalId: string }
  | { kind: 'bundle-hash' | 'bundle-paid' | 'bundle-failed'; vout: number; bundleHash: string }
  | { kind: 'prev-blocks'; vout: number; prevMainBlock: string; prevSideBlock: string }
  | { kind: 'block-version'; vout: number; data: string }
  | { kind: 'witness-commitment'; vout: number; commitment: string }
  | { kind: 'stray'; vout: number; object: 'deposit' }
  | { kind: 'unreadable'; vout: number; error: string };

const OBJECT_TAG = 'acdcf66f';
const COMMIT_TAGS: Readonly<Record<string, 'bundle-hash' | 'bundle-paid' | 'bundle-failed'>> = {
  ef5d1dfe: 'bundle-hash', fb5345de: 'bundle-paid', fa86c689: 'bundle-failed',
};
const PREV_BLOCKS_TAG = 'fd7ad1ef';
const BLOCK_VERSION_TAG = 'a7e67e1f';
const REFUND_TAG = 'fcd2e546';
const WITNESS_COMMITMENT = /^6a24aa21a9ed([0-9a-f]{64})/;
const ZERO_HASH = '0'.repeat(64);
const WITHDRAWAL_UNSPENT = 0x75; // 'u'
/** sidechain.h SIDECHAIN_DEPOSIT_FEE: 1,000 szats, kept by the block producer */
export const DEPOSIT_FEE = 1000;
/** sidechain.h SIDECHAIN_WITHDRAWAL_BUNDLE_RETURN_DEST: a record of a bundle paid on eCash, not a deposit */
const BUNDLE_RETURN_DEST = 'D';

/**
 * A tx's peg and protocol outputs, in output order (at most `max`). `addresses`: each output's address as the node
 * prints it, to find a deposit's payout in a coinbase.
 */
export function pegOutputs(tx: ParsedTx, addresses: (string | null)[] = [], max = Infinity): PegOutput[] {
  const coinbase = isCoinbase(tx);
  const out: PegOutput[] = [];
  for (let i = 0; i < tx.vout.length && out.length < max; i++) {
    const peg = pegOutput(tx.vout[i].scriptpubkey, i, coinbase);
    if (peg) {
      out.push(peg);
    }
  }
  if (coinbase) {
    claimDepositPayouts(out, tx.vout, addresses);
  }
  return out;
}

/** One output's script decoded, or null when it is no peg or protocol output */
export function pegOutput(script: string, vout: number, inCoinbase: boolean): PegOutput | null {
  if (!script.startsWith('6a') || script.length < 10) {
    return null;
  }
  const tag = script.slice(2, 10);
  if (COMMIT_TAGS[tag]) {
    if (!inCoinbase || script.length !== 74) {
      return null; // not one the node reads (it reads the coinbase's)
    }
    const bundleHash = reverseHex(Buffer.from(script.slice(10), 'hex'));
    return bundleHash === ZERO_HASH ? null : { kind: COMMIT_TAGS[tag], vout, bundleHash };
  }
  if (tag === PREV_BLOCKS_TAG) {
    return inCoinbase && script.length === 138 ? {
      kind: 'prev-blocks', vout,
      prevMainBlock: reverseHex(Buffer.from(script.slice(10, 74), 'hex')),
      prevSideBlock: reverseHex(Buffer.from(script.slice(74), 'hex')),
    } : null;
  }
  if (tag === BLOCK_VERSION_TAG) {
    return inCoinbase && script.length === 18 ? { kind: 'block-version', vout, data: script.slice(10) } : null;
  }
  const witness = inCoinbase ? WITNESS_COMMITMENT.exec(script) : null;
  if (witness) {
    return { kind: 'witness-commitment', vout, commitment: witness[1] };
  }
  if (tag === REFUND_TAG) {
    if (script.length !== 204) {
      return null; // script.cpp IsWithdrawalRefundRequest: exactly 102 bytes
    }
    const withdrawalId = reverseHex(Buffer.from(script.slice(10, 74), 'hex'));
    return withdrawalId === ZERO_HASH ? null : { kind: 'refund-request', vout, withdrawalId };
  }
  if (tag !== OBJECT_TAG || script.length < 12) {
    return null;
  }
  const type = script.slice(10, 12);
  if (type !== '44' && type !== '50' && type !== '57') {
    return null; // ParseSidechainObj: no object
  }
  if (type === '44' && !inCoinbase) {
    return { kind: 'stray', vout, object: 'deposit' };
  }
  try {
    const buf = Buffer.from(script, 'hex');
    const r = new ByteReader(buf);
    r.skip(6); // OP_RETURN, the tag, the type
    // the node reads the fields and ignores bytes after them (ParseSidechainObj), as these do
    return type === '44' ? readDeposit(r, buf, vout) : type === '50' ? readBundle(r, buf, vout) : readWithdrawal(r, buf, vout);
  } catch (e) {
    return { kind: 'unreadable', vout, error: e instanceof FreebankParseError ? e.message : 'unreadable' };
  }
}

/**
 * The txid eCash gives a deposit's tx: version, vin, vout, locktime; FreeBank's replay byte and trailer left out
 * (for a version 1 or 2 tx, the same as FreeBank's)
 */
function mainchainTxid(buf: Buffer, span: TxSpan): string {
  return reverseHex(sha256d(Buffer.concat([
    buf.subarray(span.start, span.start + 4),
    buf.subarray(span.bodyStart, span.bodyEnd),
    buf.subarray(span.locktimeStart, span.locktimeStart + 4),
  ])));
}

function compactSize(n: number): Buffer {
  if (n < 0xfd) {
    return Buffer.from([n]);
  }
  if (n <= 0xffff) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(5);
  b[0] = 0xfe;
  b.writeUInt32LE(n, 1);
  return b;
}

/** A bundle's m6id: the txid of the bundle tx without its (dummy) input (l1client.cpp BlindedM6IdForBundle) */
function bundleM6id(buf: Buffer, span: TxSpan, tx: ParsedTx): string {
  const outputs: Buffer[] = [compactSize(tx.vout.length)];
  for (const o of tx.vout) {
    const value = Buffer.alloc(8);
    const hi = Math.floor(o.value / TWO_POW_32);
    value.writeUInt32LE(o.value - hi * TWO_POW_32, 0);
    value.writeInt32LE(hi, 4);
    const script = Buffer.from(o.scriptpubkey, 'hex');
    outputs.push(value, compactSize(script.length), script);
  }
  return reverseHex(sha256d(Buffer.concat([
    buf.subarray(span.start, span.headerEnd), compactSize(0), ...outputs, buf.subarray(span.locktimeStart, span.end),
  ])));
}

function readDeposit(r: ByteReader, buf: Buffer, vout: number): PegOutput {
  const slot = r.u8();
  const dest = r.varString();
  const amount = r.i64();
  const { tx, span } = readTx(r, buf);
  const burnIndex = r.u32();
  const ecashTxIndex = r.u32();
  const ecashBlock = r.hash256();
  // a bundle's payment (its M6): destination 'D' and nothing to pay (ConnectBlock skips only those; a 'D' record of a
  // positive amount is a deposit to the address 'D', recorded and never paid)
  const bundlePayment = dest === BUNDLE_RETURN_DEST && amount <= 0;
  const burn = tx.vout[burnIndex];
  return {
    kind: 'deposit', vout, slot, dest, amount,
    ecashTxid: mainchainTxid(buf, span), ecashBlock, ecashTxIndex, burnIndex,
    treasuryValue: burn ? burn.value : null,
    bundlePayment,
    payoutVout: null,
    ...(bundlePayment ? { ecashOutputs: tx.vout.slice(0, LIST_MAX) } : {}),
  };
}

function readBundle(r: ByteReader, buf: Buffer, vout: number): PegOutput {
  const slot = r.u8();
  const { tx, span } = readTx(r, buf);
  const count = r.compactSize();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(r.hash256());
  }
  // status, nHeight and nFailHeight follow; the coinbase copy never sets nFailHeight, so none is read.
  // CreateWithdrawalBundleTx: CUSF puts OP_RETURN PUSH8(total fee, big-endian) at vout[0], the payouts after; legacy
  // OP_RETURN 'D' at vout[0], OP_RETURN PUSH8(fee, little-endian) at vout[1], the payouts after. In the ids' order.
  let format: 'cusf' | 'legacy' | 'unknown' = 'unknown';
  let ecashFee: number | null = null;
  let first = 0;
  const script0 = tx.vout[0]?.scriptpubkey ?? '';
  const script1 = tx.vout[1]?.scriptpubkey ?? '';
  if (/^6a08[0-9a-f]{16}$/.test(script0)) {
    format = 'cusf';
    const fee = Buffer.from(script0.slice(4), 'hex');
    ecashFee = fee.readUInt32BE(0) * TWO_POW_32 + fee.readUInt32BE(4);
    first = 1;
  } else if (script0 === '6a0144') {
    format = 'legacy';
    first = 2;
    if (/^6a08[0-9a-f]{16}$/.test(script1)) {
      ecashFee = new ByteReader(Buffer.from(script1.slice(4), 'hex')).i64();
    }
  }
  const payouts: { vout: number; value: number; scriptpubkey: string; withdrawalId: string | null }[] = [];
  let total = 0;
  let n = 0;
  tx.vout.forEach((o, i) => {
    if (format === 'unknown' ? o.value > 0 : i >= first) {
      total += o.value;
      if (payouts.length < LIST_MAX) {
        payouts.push({ vout: i, value: o.value, scriptpubkey: o.scriptpubkey, withdrawalId: ids[n] ?? null });
      }
      n++;
    }
  });
  return {
    kind: 'bundle', vout, slot, bundleHash: tx.txid, m6id: bundleM6id(buf, span, tx), format, ecashFee, total,
    withdrawals: count, withdrawalIds: ids.slice(0, LIST_MAX), payouts,
  };
}

function readWithdrawal(r: ByteReader, buf: Buffer, vout: number): PegOutput {
  const start = r.pos - 1; // the 'W'
  const slot = r.u8();
  const destRaw = r.varString(); // the eCash destination as stored (bech32 and P2SH in the node's carrier form)
  const refundDest = r.varString();
  const amount = r.i64(); // burned on FreeBank: payout and eCash fee
  const ecashFee = r.i64();
  const statusAt = r.pos;
  r.u8(); // status
  r.skip(32); // hashBlindTx
  // GetID: the hash of the object's fields with the status 'u'
  const object = Buffer.from(buf.subarray(start, r.pos));
  object[statusAt - start] = WITHDRAWAL_UNSPENT;
  return { kind: 'withdrawal', vout, slot, id: reverseHex(sha256d(object)), destRaw, refundDest, amount, ecashFee, payout: amount - ecashFee };
}

/**
 * The full deposit address s130_<address>_<first 6 hex of sha256("s130_<address>_")> pays <address> (v0.2.17,
 * sidechain.cpp ParseFullDepositAddress), or null when `dest` is not one
 */
export function unwrapFullDepositAddress(dest: string): string | null {
  const m = /^s130_([^_]+)_([0-9a-f]{6})$/.exec(dest);
  if (!m) {
    return null;
  }
  const body = dest.slice(0, dest.length - 6);
  return createHash('sha256').update(Buffer.from(body, 'latin1')).digest('hex').slice(0, 6) === m[2] ? m[1] : null;
}

/** the node's own spelling of a bech32 address */
const BECH32_ADDRESS = /^[a-z0-9]+1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/;
/** C isspace, which base58.cpp skips at both ends */
const C_SPACE_AT_ENDS = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/**
 * Whether a deposit's destination string names `output`, the address an output pays in the node's spelling, as
 * DecodeDestination reads the string: bech32 whole, in one case; base58 up to the first NUL, C whitespace at the ends
 * skipped; the full deposit address its inner address exactly.
 */
export function depositPaysTo(output: string | null | undefined, dest: string): boolean {
  if (!output || !dest) {
    return false;
  }
  const inner = unwrapFullDepositAddress(dest);
  if (inner !== null) {
    return output === inner;
  }
  if (BECH32_ADDRESS.test(output)) {
    return /^[\x21-\x7e]+$/.test(dest) && (dest === dest.toLowerCase() || dest === dest.toUpperCase()) && dest.toLowerCase() === output;
  }
  return dest.split('\0')[0].replace(C_SPACE_AT_ENDS, '') === output;
}

/**
 * The node's claim rule for a deposit's payout (sidechain.cpp ClaimDepositPayoutOutput): a deposit above the fee
 * claims one output other than vout[0] (the producer's) paying exactly its amount less the fee to its destination; an
 * output is claimed once. The builder puts it right before the record, so that one is tried first.
 */
function claimDepositPayouts(pegs: PegOutput[], vout: ParsedTx['vout'], addresses: (string | null)[]): void {
  const claimed = new Set<number>([0]);
  for (const peg of pegs) {
    if (peg.kind !== 'deposit' || peg.dest === BUNDLE_RETURN_DEST || peg.amount <= DEPOSIT_FEE) {
      continue;
    }
    const want = peg.amount - DEPOSIT_FEE;
    const matches = (j: number): boolean => !claimed.has(j) && vout[j]?.value === want && depositPaysTo(addresses[j], peg.dest);
    let found = peg.vout - 1 >= 1 && matches(peg.vout - 1) ? peg.vout - 1 : -1;
    for (let j = 1; found < 0 && j < vout.length; j++) {
      if (matches(j)) {
        found = j;
      }
    }
    if (found >= 0) {
      claimed.add(found);
      peg.payoutVout = found;
    }
  }
}
