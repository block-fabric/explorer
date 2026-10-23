import { createHash } from 'crypto';
import { LIST_MAX, PegOutput, depositPaysTo, parseTx, pegOutput, pegOutputs, unwrapFullDepositAddress } from '../../../chain/modules/freebank/parser';
import { describeTx } from '../../../chain/modules/freebank/tx';

// FreeBank's peg and protocol outputs and the tx route's answer: real coinbases of the explorer spike's chain (fixtures
// from mbdrivechains/freebank-explorer @ e3ad60793, AGPL-3.0), and objects built byte by byte from freebank
// src/sidechain.h (the objects' field order), sidechain.cpp GetScript, validation.cpp Generate*Commit and
// primitives/transaction.h, independent of the parser.

const sha256d = (b: Buffer): Buffer => createHash('sha256').update(createHash('sha256').update(b).digest()).digest();
const display = (b: Buffer): string => Buffer.from(b).reverse().toString('hex');
const internal = (hex: string): Buffer => Buffer.from(hex, 'hex').reverse();
const hash32 = (seed: string): string => display(sha256d(Buffer.from(seed)));
const compactSize = (n: number): Buffer => n < 0xfd ? Buffer.from([n]) : Buffer.from([0xfd, n & 0xff, n >> 8]);
const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const i32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const i64 = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const varBytes = (b: Buffer): Buffer => Buffer.concat([compactSize(b.length), b]);
const varString = (s: string): Buffer => varBytes(Buffer.from(s, 'utf8'));
const P2PKH = (seed: string): string => '76a914' + sha256d(Buffer.from(seed)).subarray(0, 20).toString('hex') + '88ac';
const P2WPKH = (seed: string): string => '0014' + sha256d(Buffer.from(seed)).subarray(0, 20).toString('hex');

interface TxSpec {
  version?: number;
  vin?: { txid: string; vout: number; scriptsig?: string; witness?: string[] }[];
  vout: { value: number; scriptpubkey: string }[];
}

function outputsBytes(vout: TxSpec['vout']): Buffer {
  return Buffer.concat([compactSize(vout.length), ...vout.map((o) => Buffer.concat([i64(o.value), varBytes(Buffer.from(o.scriptpubkey, 'hex'))]))]);
}

function inputsBytes(vin: NonNullable<TxSpec['vin']>): Buffer {
  return Buffer.concat([compactSize(vin.length), ...vin.map((i) => Buffer.concat([internal(i.txid), u32(i.vout), varBytes(Buffer.from(i.scriptsig ?? '', 'hex')), u32(0xffffffff)]))]);
}

/** FreeBank's serialization (with the witness when an input has one; the replay byte on v3) */
function txBytes(spec: TxSpec): Buffer {
  const version = spec.version ?? 2;
  const vin = spec.vin ?? [];
  const segwit = vin.some((i) => i.witness?.length);
  const parts = [i32(version)];
  if (version === 3) {
    parts.push(Buffer.from([0x3f]));
  }
  if (segwit) {
    parts.push(Buffer.from([0, 1]));
  }
  parts.push(inputsBytes(vin), outputsBytes(spec.vout));
  if (segwit) {
    for (const i of vin) {
      parts.push(compactSize(i.witness?.length ?? 0), ...(i.witness ?? []).map((w) => varBytes(Buffer.from(w, 'hex'))));
    }
  }
  parts.push(u32(0));
  return Buffer.concat(parts);
}

/** The txid eCash computes: version, vin, vout, locktime */
const ecashTxid = (spec: TxSpec): string => display(sha256d(Buffer.concat([i32(spec.version ?? 2), inputsBytes(spec.vin ?? []), outputsBytes(spec.vout), u32(0)])));

const OBJECT = '6aacdcf66f';
const depositScript = (d: { dest: string; amount: number; dtx: TxSpec; burn: number; block: string }): string => OBJECT + Buffer.concat([
  Buffer.from('D'), Buffer.from([130]), varString(d.dest), i64(d.amount), txBytes(d.dtx), u32(d.burn), u32(7), internal(d.block),
]).toString('hex');
const bundleScript = (tx: TxSpec, ids: string[]): string => OBJECT + Buffer.concat([
  Buffer.from('P'), Buffer.from([130]), txBytes(tx), compactSize(ids.length), ...ids.map(internal), Buffer.from('c'), i32(5), Buffer.from('deadbeef', 'hex'),
]).toString('hex');
const withdrawalFields = (status: string): Buffer => Buffer.concat([
  Buffer.from('W'), Buffer.from([130]), varString('ecash:qdest'), varString('XRefund'), i64(1_000_000), i64(3000), Buffer.from(status), internal(hash32('blind')),
]);
const cusfFee = (fee: number): string => '6a08' + Buffer.from([0, 0, 0, 0, fee >>> 24, (fee >> 16) & 0xff, (fee >> 8) & 0xff, fee & 0xff]).toString('hex');
const COINBASE_IN = [{ txid: '00'.repeat(32), vout: 0xffffffff, scriptsig: '0101' }];
const ECASH_BLOCK = hash32('ecash block');

const real = require('./test-data/peg-coinbases.json');
const depositCoinbases = require('./test-data/deposit-coinbases.json');

describe('FreeBank peg: real coinbases (spike chain)', () => {
  test.each<[number, any]>(real.coinbases.map((c: any): [number, any] => [c.height, c]))('block %i: the deposit record and the coinbase commitments', (_h, c: any) => {
    const e = c.expected;
    const record = pegOutput(c.vout[e.record_vout].scriptpubkey, e.record_vout, true);
    expect(record).toEqual({
      kind: 'deposit', vout: e.record_vout, slot: 130, dest: e.dest, amount: e.amount, ecashTxid: e.ecash_txid, ecashBlock: e.ecash_block,
      ecashTxIndex: e.ecash_tx_index, burnIndex: e.burn_index, treasuryValue: e.treasury_value, bundlePayment: false, payoutVout: null,
    });
    const kinds = c.vout.map((o: any, i: number) => pegOutput(o.scriptpubkey, i, true)?.kind ?? null);
    expect(kinds.filter((k: string | null) => k)).toEqual(expect.arrayContaining(['prev-blocks', 'block-version', 'deposit', 'witness-commitment']));
    expect(pegOutput(c.vout[e.record_vout].scriptpubkey, e.record_vout, false)).toEqual({ kind: 'stray', vout: e.record_vout, object: 'deposit' });
  });

  test.each<[number, any]>(depositCoinbases.coinbases.map((c: any): [number, any] => [c.height, c]))('block %i: the deposit names its payout', (_h, c: any) => {
    const tx = parseTx(c.hex);
    const addresses = tx.vout.map((_o, i) => (i === c.payout_vout ? c.payout_address : null));
    const deposits = pegOutputs(tx, addresses).filter((p) => p.kind === 'deposit');
    expect(deposits).toHaveLength(1);
    expect(deposits[0]).toMatchObject({ payoutVout: c.payout_vout, dest: c.payout_address });
    expect(tx.vout[c.payout_vout].value).toEqual((deposits[0] as any).amount - 1000);
    // without the addresses nothing is claimed
    expect(pegOutputs(tx).find((p) => p.kind === 'deposit')).toMatchObject({ payoutVout: null });
  });
});

describe('FreeBank peg: objects built from sidechain.h', () => {
  const dtx: TxSpec = {
    vin: [{ txid: hash32('prev ctip'), vout: 0 }],
    vout: [{ value: 25_000, scriptpubkey: P2WPKH('change') }, { value: 7_000_000_000, scriptpubkey: 'b7018251' }],
  };

  test('a deposit record: the eCash txid leaves the witness and FreeBank\'s replay byte out', () => {
    const segwit: TxSpec = { ...dtx, vin: dtx.vin!.map((i) => ({ ...i, witness: ['3044' + '00'.repeat(70)] })) };
    expect(pegOutput(depositScript({ dest: 'fbk1qdest', amount: 2e9, dtx: segwit, burn: 1, block: ECASH_BLOCK }), 5, true)).toMatchObject({
      kind: 'deposit', ecashTxid: ecashTxid(segwit), ecashTxIndex: 7, ecashBlock: ECASH_BLOCK, burnIndex: 1, treasuryValue: 7e9,
    });
    const v3: TxSpec = { ...dtx, version: 3 };
    expect(pegOutput(depositScript({ dest: 'x', amount: 1, dtx: v3, burn: 9, block: ECASH_BLOCK }), 1, true)).toMatchObject({ ecashTxid: ecashTxid(v3), treasuryValue: null });
  });

  test('a bundle payment ("D", amount 0 or less) keeps the M6\'s outputs; a positive "D" is a deposit', () => {
    expect(pegOutput(depositScript({ dest: 'D', amount: 0, dtx, burn: 1, block: ECASH_BLOCK }), 3, true)).toMatchObject({ bundlePayment: true, ecashOutputs: dtx.vout });
    const positive = pegOutput(depositScript({ dest: 'D', amount: 5, dtx, burn: 1, block: ECASH_BLOCK }), 3, true) as any;
    expect(positive.bundlePayment).toBe(false);
    expect(positive.ecashOutputs).toBeUndefined();
  });

  test('a CUSF bundle: fee, payouts in id order, m6id = txid without the input; lists capped', () => {
    const ids = Array.from({ length: 25 }, (_, i) => hash32('w' + i));
    const tx: TxSpec = { vin: [{ txid: '00'.repeat(32), vout: 0, scriptsig: '00' }], vout: [{ value: 0, scriptpubkey: cusfFee(3000) }, ...ids.map((_, i) => ({ value: 1000 + i, scriptpubkey: P2PKH('p' + i) }))] };
    const b = pegOutput(bundleScript(tx, ids), 4, false) as Extract<PegOutput, { kind: 'bundle' }>;
    expect(b).toMatchObject({ kind: 'bundle', slot: 130, format: 'cusf', ecashFee: 3000, withdrawals: 25, bundleHash: ecashTxid(tx), m6id: ecashTxid({ ...tx, vin: [] }) });
    expect(b.total).toEqual(25 * 1000 + (24 * 25) / 2);
    expect(b.withdrawalIds).toEqual(ids.slice(0, LIST_MAX));
    expect(b.payouts).toHaveLength(LIST_MAX);
    expect(b.payouts[1]).toEqual({ vout: 2, value: 1001, scriptpubkey: P2PKH('p1'), withdrawalId: ids[1] });
  });

  test('a legacy bundle: OP_RETURN "D", the fee little-endian, payouts from vout 2', () => {
    const tx: TxSpec = { vin: [{ txid: '00'.repeat(32), vout: 0 }], vout: [{ value: 0, scriptpubkey: '6a0144' }, { value: 0, scriptpubkey: '6a08' + i64(2500).toString('hex') }, { value: 9, scriptpubkey: P2PKH('a') }] };
    expect(pegOutput(bundleScript(tx, [hash32('w')]), 0, true)).toMatchObject({ format: 'legacy', ecashFee: 2500, total: 9, payouts: [{ vout: 2, withdrawalId: hash32('w') }] });
  });

  test('a withdrawal: its id is the hash of the object with status "u"', () => {
    const expected = { kind: 'withdrawal', vout: 1, slot: 130, id: display(sha256d(withdrawalFields('u'))), destRaw: 'ecash:qdest', refundDest: 'XRefund', amount: 1_000_000, ecashFee: 3000, payout: 997_000 };
    expect(pegOutput(OBJECT + withdrawalFields('s').toString('hex'), 1, false)).toEqual(expected);
    expect(pegOutput(OBJECT + withdrawalFields('u').toString('hex') + 'ff', 1, true)).toEqual(expected); // bytes after are ignored
  });

  test('a refund request, in any tx: exactly 102 bytes, a non-null id', () => {
    const id = hash32('withdrawal');
    const script = '6afcd2e546' + internal(id).toString('hex') + '11'.repeat(65);
    expect(pegOutput(script, 0, false)).toEqual({ kind: 'refund-request', vout: 0, withdrawalId: id });
    expect(pegOutput(script.slice(0, -2), 0, false)).toBeNull();
    expect(pegOutput('6afcd2e546' + '00'.repeat(32) + '11'.repeat(65), 0, false)).toBeNull();
  });

  test('bundle commitments: coinbase only, a null hash is none', () => {
    const hash = hash32('bundle');
    for (const [tag, kind] of [['ef5d1dfe', 'bundle-hash'], ['fb5345de', 'bundle-paid'], ['fa86c689', 'bundle-failed']]) {
      const script = '6a' + tag + internal(hash).toString('hex');
      expect(pegOutput(script, 2, true)).toEqual({ kind, vout: 2, bundleHash: hash });
      expect(pegOutput(script, 2, false)).toBeNull();
    }
    expect(pegOutput('6afb5345de' + '00'.repeat(32), 0, true)).toBeNull();
  });

  test.each([
    ['a record cut short', depositScript({ dest: 'x', amount: 5, dtx, burn: 0, block: ECASH_BLOCK }).slice(0, 60), true],
    ['a record with a huge string length', '6aacdcf66f4482fe00000001', true],
    ['a bundle cut inside its tx', '6aacdcf66f5082' + i32(2).toString('hex') + '05', true],
    ['a withdrawal cut short', '6aacdcf66f5782036162', false],
  ])('%s is unreadable, without throwing', (_label, script, coinbase) => {
    expect(pegOutput(script as string, 0, coinbase as boolean)?.kind).toEqual('unreadable');
  });

  test('an unknown object type or a plain OP_RETURN is no peg output', () => {
    expect(pegOutput('6aacdcf66f4182', 0, true)).toBeNull();
    expect(pegOutput('6a0474657374', 0, true)).toBeNull();
    expect(pegOutput('', 0, true)).toBeNull();
  });
});

describe('FreeBank peg: the full deposit address (v0.2.17)', () => {
  const ADDR = 'XCA6v5sypMCL8MVK1Ludm67zSqAhW6fnGn';
  const FULL = 's130_XCA6v5sypMCL8MVK1Ludm67zSqAhW6fnGn_e8cc6c'; // beta block 211

  test('unwrapped to the address it pays, and nothing else', () => {
    expect(unwrapFullDepositAddress(FULL)).toEqual(ADDR);
    expect(unwrapFullDepositAddress(FULL.slice(0, -1) + 'd')).toBeNull();
    expect(unwrapFullDepositAddress(FULL.slice(0, -6) + 'E8CC6C')).toBeNull();
    expect(unwrapFullDepositAddress(FULL + '\n')).toBeNull();
    expect(unwrapFullDepositAddress(ADDR)).toBeNull();
    expect(depositPaysTo(ADDR, FULL)).toBe(true);
    expect(depositPaysTo(ADDR, ' ' + ADDR + '\n')).toBe(true); // base58: C whitespace at the ends skipped
    expect(depositPaysTo('fbk1qw508d6qejxtdg4y5r3zarvary0c5xw7kh7x9s0', 'FBK1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KH7X9S0')).toBe(true);
    expect(depositPaysTo('fbk1qw508d6qejxtdg4y5r3zarvary0c5xw7kh7x9s0', 'fbk1QW508d6qejxtdg4y5r3zarvary0c5xw7kh7x9s0')).toBe(false);
  });
});

describe('FreeBank tx route: describeTx', () => {
  const fixtures = require('./test-data/txs.json');
  const settle = fixtures.credit.find((t: any) => t.family === 'settle');

  test('a credit tx: the operation and its fields', () => {
    expect(describeTx({ txid: settle.txid, version: 16, hex: settle.hex })).toEqual({
      version: 16, family: 'settle', assetGenesis: false,
      credit: { family: 'settle', op: 1, opName: 'exchange', fields: settle.decoded },
      asset: null, peg: null, error: null,
    });
  });

  test('an asset genesis: the asset, its id the txid, its supply vout[1]', () => {
    const t = require('./test-data/v0218-txs.json').txs.find((x: any) => x.label === 'asset-gold');
    const m = describeTx({ txid: t.txid, version: 10, hex: t.hex });
    expect(m).toMatchObject({ version: 10, family: null, assetGenesis: true, credit: null, error: null });
    expect(m.asset).toEqual({
      assetId: t.asset_genesis.asset_id, ticker: 'GOLD', headline: t.asset_genesis.headline, payload: t.asset_genesis.payload, decimals: 3, supply: t.asset_genesis.supply,
    });
  });

  test('a coinbase: its peg outputs, the deposit\'s payout from the node\'s addresses', () => {
    const c = depositCoinbases.coinbases[0];
    const tx = parseTx(c.hex);
    const vout = tx.vout.map((_o, i) => ({ scriptPubKey: i === c.payout_vout ? { addresses: [c.payout_address] } : {} }));
    const m = describeTx({ txid: tx.txid, version: 3, hex: c.hex, vout });
    expect(m.credit).toBeNull();
    expect(m.peg?.map((p) => p.kind)).toEqual(expect.arrayContaining(['deposit']));
    expect(m.peg?.find((p) => p.kind === 'deposit')).toMatchObject({ payoutVout: c.payout_vout });
  });

  test('never throws: our own error text for a payload or a tx that does not parse', () => {
    expect(describeTx(null)).toMatchObject({ credit: null, error: 'The raw transaction is missing or too large' });
    expect(describeTx({ version: 16, hex: 'zz' })).toMatchObject({ version: 16, family: 'settle', credit: null, error: expect.stringMatching(/^The raw transaction does not parse/) });
    expect(describeTx({ version: 16, hex: settle.hex.slice(0, -2) }).error).toMatch(/does not parse/);
    expect(describeTx({ txid: '00'.repeat(32), version: 16, hex: settle.hex }).error).toEqual('The raw transaction does not match its txid');
    // an empty v16 tx (no inputs, no outputs) carrying settle op 1 with a 2-byte payload: the op is named, the fields not
    const cut = Buffer.concat([Buffer.from('10000000', 'hex'), Buffer.from([0, 0]), u32(0), Buffer.from([1]), Buffer.from('020100', 'hex')]).toString('hex');
    expect(describeTx({ version: 16, hex: cut })).toMatchObject({
      credit: { family: 'settle', op: 1, opName: 'exchange', fields: {} }, error: 'The settle exchange payload does not fit its layout',
    });
  });
});
