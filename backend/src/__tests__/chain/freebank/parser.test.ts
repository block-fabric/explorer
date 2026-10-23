import {
  ByteReader, CreditFamily, FreebankParseError, LIST_MAX, ParsedTx, creditOpName, decodeCreditPayload, keyIdToAddress, parseTx,
} from '../../../chain/modules/freebank/parser';

// FreeBank's credit payloads and asset genesis, on real transactions and gate runs of freebankd (fixtures from
// mbdrivechains/freebank-explorer @ e3ad60793, src/__tests__/api/test-data, AGPL-3.0; each file's `source` says where
// it came from), and on payloads built from the node's headers (note.h, token.h).

const fixtures = require('./test-data/txs.json');

interface CreditFixture {
  txid: string;
  height: number;
  version: number;
  family: string;
  op: number;
  op_name: string;
  decoded: { [field: string]: unknown };
  hex: string;
}

const credit: CreditFixture[] = fixtures.credit;
const byKind = (family: string, opName: string): CreditFixture[] => credit.filter((t) => t.family === family && t.op_name === opName);
const decode = (tx: ParsedTx): Record<string, any> => decodeCreditPayload(tx.family as CreditFamily, tx.op as number, tx.payload as Buffer);
const opOf = (tx: ParsedTx): string => creditOpName(tx.family as CreditFamily, tx.op as number);

describe('FreeBank parser: credit transactions (v11-v17)', () => {
  test('the fixtures cover every credit family', () => {
    expect([...new Set(credit.map((t) => t.family))].sort()).toEqual(['bill', 'deposit', 'house', 'note', 'oracle', 'pool', 'settle']);
  });

  test.each(credit.map((t): [string, CreditFixture] => [`${t.family} ${t.op_name} at ${t.height} (${t.txid.slice(0, 12)})`, t]))(
    '%s: txid, op and payload',
    (_label, t) => {
      const tx = parseTx(t.hex);
      // sha256d of the no-witness serialization, the credit trailer included
      expect(tx.txid).toEqual(t.txid);
      expect(tx.version).toEqual(t.version);
      expect(tx.family).toEqual(t.family);
      expect(tx.op).toEqual(t.op);
      expect(opOf(tx)).toEqual(t.op_name);
      expect(decode(tx)).toEqual(t.decoded);
    },
  );

  test('settle exchange: both houses, both note amounts, the residual and its direction', () => {
    expect(decode(parseTx(byKind('settle', 'exchange')[0].hex))).toEqual({
      house_a_id: 1, house_b_id: 2, mode: 1, house_a_notes_units: 60000, house_b_notes_units: 45000,
      residual_sats: 15000, debtor_house_id: 1, creditor_house_id: 2, expiry_height: 140,
    });
  });

  test('house register carries the class ids listhouses reports', () => {
    expect(byKind('house', 'register').map((t) => decode(parseTx(t.hex)).classid)).toEqual(['hone', 'htwo', 'hthree']);
  });

  test('house attest: reserves equal gethouse lastattestreserves (27.675566 ECX at 452)', () => {
    const attest = byKind('house', 'attest').find((t) => t.height === 452) as CreditFixture;
    expect(decode(parseTx(attest.hex))).toEqual({ house_id: 1, as_of_height: 451, reserves_sats: 2767556600 });
  });

  test('bill discount: bill 3 into house 1\'s loan book', () => {
    expect(decode(parseTx(byKind('bill', 'discount')[0].hex))).toEqual({
      bill_id: 3, house_id: 1, price_units: 90000000, face_sats: 100000000, maturity_height: 519,
    });
  });

  test('oracle submits at 113: the three prices whose median is the gold fix', () => {
    const prices = byKind('oracle', 'submit').filter((t) => t.height === 113).map((t) => decode(parseTx(t.hex)).price_mg);
    expect(prices.sort()).toEqual([790000000, 800000000, 810000000]);
  });

  test('pool swaps in both directions', () => {
    expect(byKind('pool', 'swap').map((t) => decode(parseTx(t.hex)).direction)).toEqual(['notes_for_ecx', 'ecx_for_notes']);
  });
});

describe('FreeBank parser: other transactions', () => {
  test.each<[string, any]>(fixtures.other.map((t: any): [string, any] => [`v${t.version}${t.has_witness ? ' with witness' : ''} at ${t.height}`, t]))(
    '%s: txid and outputs',
    (_label, t: any) => {
      const tx = parseTx(t.hex);
      expect(tx.txid).toEqual(t.txid); // a segwit tx: marker, flags and witness left out
      expect(tx.version).toEqual(3);
      expect(tx.vout.map((o) => o.value)).toEqual(t.output_values);
      expect([tx.family, tx.op, tx.payload, tx.asset]).toEqual([null, null, null, null]);
    },
  );
});

describe('FreeBank parser: v0.2.18 (asset genesis, note demand modes)', () => {
  const v0218: any[] = require('./test-data/v0218-txs.json').txs;
  const get = (label: string): any => v0218.find((t) => t.label === label);

  test.each(v0218.map((t): [string, any] => [t.label, t]))('%s reads whole, with the node\'s txid', (_label, t) => {
    const tx = parseTx(t.hex);
    expect(tx.txid).toEqual(t.txid);
    expect(tx.version).toEqual(t.version);
  });

  test('an asset genesis (v10): ticker, headline, payload and the decimals byte, as the node prints them', () => {
    const t = get('asset-gold');
    const tx = parseTx(t.hex);
    expect(tx.asset).toEqual({ ticker: 'GOLD', headline: t.asset_genesis.headline, payload: t.asset_genesis.payload, decimals: 3 });
    expect(tx.txid).toEqual(t.asset_genesis.asset_id);
    expect(tx.vout[1].value).toEqual(t.asset_genesis.supply);
  });

  test('note demands: the mode (plain, pre-authorised, queue) and an upgrade\'s prior height', () => {
    const mode = (label: string): unknown[] => {
      const d = decode(parseTx(get(label).hex));
      return [d.demand_mode, d.prior_demand_height];
    };
    expect(mode('demand-plain-b')).toEqual(['plain', 0]);
    expect(mode('demand-preauth')).toEqual(['preauth', 0]);
    expect(mode('demand-queue')).toEqual(['preauth_queue', 0]);
    const [upgrade, prior] = mode('demand-upgrade-d');
    expect(upgrade).toEqual('preauth_queue');
    expect(prior).toBeGreaterThan(0);
  });
});

describe('FreeBank parser: v0.2.19 members-only houses', () => {
  const fx = require('./test-data/v0219-txs.json');
  const decoded = (label: string): Record<string, any> => {
    const tx = parseTx(fx.txs.find((t: any) => t.label === label).hex);
    return { op: opOf(tx), ...decode(tx) };
  };

  test('every fixture reads whole', () => {
    for (const t of fx.txs) {
      expect(parseTx(t.hex).txid).toEqual(t.txid);
    }
  });

  test('REGISTER_MO: the register fields and the house type', () => {
    expect(decoded('register-mo-members')).toMatchObject({ op: 'register_mo', classid: 'coop', house_type: 'members' });
    expect(decoded('register-mo-redeem')).toMatchObject({ op: 'register_mo', classid: 'rcoop', house_type: 'redeem' });
    expect(decoded('register-open')).toMatchObject({ op: 'register', classid: 'plain' });
  });

  test('member ops: the house, the count and the first LIST_MAX addresses, which the node lists', () => {
    const members: string[] = fx.members_of_house_1;
    const alice = decoded('member-add-alice');
    expect(alice).toMatchObject({ op: 'member_add', house_id: 1, members: 1 });
    expect(alice.member_addresses).toHaveLength(1);
    expect(members).toContain(alice.member_addresses[0]);
    const batch = decoded('member-add-batch-1');
    expect(batch).toMatchObject({ op: 'member_add', house_id: 1, members: 50 });
    expect(batch.member_addresses).toHaveLength(LIST_MAX);
    expect(batch.member_addresses.every((a: string) => members.includes(a))).toBe(true);
    expect(decoded('member-remove')).toMatchObject({ op: 'member_remove', house_id: 1, members: 1 });
    expect(decoded('member-purge')).toMatchObject({ op: 'member_purge', house_id: 1, members: 1 });
  });
});

describe('FreeBank parser: v0.2.20 token records', () => {
  const fx = require('./test-data/v0220-txs.json');
  const read = (label: string): Record<string, any> => {
    const t = fx.txs.find((x: any) => x.label === label);
    const tx = parseTx(t.hex);
    expect(tx.txid).toEqual(t.txid);
    return { op: opOf(tx), ...decode(tx) };
  };

  test('LOCK and UNLOCK: locks less burns is the node\'s tokenunits', () => {
    expect(read('lock-1')).toMatchObject({ op: 'lock', house_id: 1, units: 500000 });
    expect(read('lock-2')).toMatchObject({ op: 'lock', house_id: 1, units: 120000 });
    expect(read('unlock-1')).toMatchObject({ op: 'unlock', house_id: 1, units: 200000, outputs: 1 });
    expect(read('lock-1').units + read('lock-2').units - read('unlock-1').units).toEqual(fx.house.tokenunits);
  });
});

describe('FreeBank parser: v0.2.21 token claims', () => {
  const fx = require('./test-data/v0221-txs.json');
  const read = fx.txs.map((t: any) => {
    const tx = parseTx(t.hex);
    expect(tx.txid).toEqual(t.txid);
    return { op: opOf(tx), d: decode(tx) };
  });
  const ops = (name: string): any[] => read.filter((t: any) => t.op === name);
  const claims = fx.gettokenclaims;

  test('the gate\'s note txs, in order', () => {
    expect(read.map((t: any) => t.op)).toEqual(['mint', 'lock', 'token_keyset', 'token_post', 'unlock', 'token_claim', 'token_claim', 'token_collect']);
    expect(read.every((t: any) => t.d.house_id === fx.house_id)).toBe(true);
  });

  test('KEYSET, POST, CLAIM and COLLECT agree with gettokenclaims', () => {
    const [keyset] = ops('token_keyset');
    expect(keyset.d.keys).toEqual(claims.keysets[0].keys.length);
    expect(keyset.d.largest_amount).toEqual(Math.max(...claims.keysets[0].keys.map((k: any) => k.amount)));
    expect(ops('token_post')[0].d).toMatchObject({ keyset_id: claims.keysets[0].id, issued: 6, spent: 1 });
    expect(ops('token_claim').reduce((s: number, t: any) => s + t.d.tokens, 0)).toEqual(claims.claims);
    expect(ops('token_claim').reduce((s: number, t: any) => s + t.d.claimed_units, 0)).toEqual(claims.claimed);
    expect(ops('token_collect')[0].d.claims).toEqual(claims.collected);
  });
});

describe('FreeBank parser: v0.2.22 netting rounds', () => {
  const fx = require('./test-data/v0222-txs.json');

  test.each<[string, any]>(fx.txs.map((t: any): [string, any] => [t.txid.slice(0, 12), t]))('round %s matches listsettlements', (_l, t: any) => {
    const tx = parseTx(t.hex);
    expect(tx.txid).toEqual(t.txid);
    expect(opOf(tx)).toEqual('net');
    const d = decode(tx);
    const node = fx.listsettlements_net.find((s: any) => s.txid === t.txid);
    expect(d.houses).toEqual(node.houses.length);
    expect(d.house_ids).toEqual(node.houses.map((h: any) => h.house));
    expect(d.units_retired).toEqual(node.houses.map((h: any) => h.units_retired));
    expect(d.nets).toEqual(node.houses.map((h: any) => h.net));
    expect(d.received_sats).toEqual(node.houses.map((h: any) => h.received_sats));
    expect(d.paid_sats).toEqual(node.houses.reduce((s: number, h: any) => s + h.received_sats, 0));
  });
});

describe('FreeBank parser: v0.2.27-v0.2.29 (repay in kind, failed house, deposit demands)', () => {
  const read = (file: string): any[] => require(file).txs.map((t: any) => {
    const tx = parseTx(t.hex);
    expect(tx.txid).toEqual(t.txid);
    return { ...t, op: opOf(tx), d: decode(tx) };
  });

  test('repay in kind: op 9, part and all in notes', () => {
    const fx = require('./test-data/v0229-repay-txs.json');
    const txs = read('./test-data/v0229-repay-txs.json');
    for (const t of txs) {
      expect(t.op).toEqual(t.node.credit.op_name);
    }
    const bill = (id: number): any => fx.bills.find((b: any) => b.id === id);
    const op9 = txs.filter((t) => t.op === 'hretire_notes').map((t) => t.d).sort((a, b) => a.bill_id - b.bill_id);
    expect(op9).toEqual([
      { bill_id: 1, house_id: 1, face_sats: 100000000, maturity_height: bill(1).maturity_height, units_burned: 95000000 },
      { bill_id: 2, house_id: 1, face_sats: 50000000, maturity_height: bill(2).maturity_height, units_burned: 50000000 },
    ]);
  });

  test('a failed house: ops 10 and 11 into the escrow, house op 15 closes it', () => {
    const fx = require('./test-data/v0229-failed-txs.json');
    const txs = read('./test-data/v0229-failed-txs.json');
    expect(txs.map((t) => t.op)).toEqual(['register', 'issue', 'issue', 'discount', 'issue', 'discount', 'defer', 'hretire_escrow', 'hclaim_escrow', 'claim', 'close']);
    for (const t of txs) {
      expect(t.op).toEqual(t.node.credit.op_name);
    }
    const bill = (id: number): any => fx.bills.find((b: any) => b.id === id);
    const sats = (ecx: number): number => Math.round(ecx * 1e8);
    expect(txs.find((t) => t.op === 'hretire_escrow').d).toEqual({ bill_id: 2, house_id: 1, face_sats: sats(bill(2).amount), maturity_height: bill(2).maturity_height, units_burned: 0 });
    expect(txs.find((t) => t.op === 'hclaim_escrow').d).toEqual({ bill_id: 3, house_id: 1, face_sats: sats(bill(3).amount), maturity_height: bill(3).maturity_height });
    expect(txs.find((t) => t.op === 'close').d).toEqual({ house_id: 1 });
  });

  test('deposit demands: terms, the payout address, protests and discharges', () => {
    const txs = read('./test-data/v0229-demand-txs.json');
    expect(txs.map((t) => t.op)).toEqual(['originate', 'originate', 'originate', 'demand', 'discharge', 'demand', 'demand', 'protest', 'protest', 'discharge', 'claim']);
    for (const t of txs) {
      expect(t.op).toEqual(t.node.credit.op_name);
      expect(t.d.house_id).toEqual(1);
    }
    const receipts = [20000000, 10000000, 5000000];
    const demands = txs.filter((t) => t.op === 'demand');
    expect(demands.map((t) => t.d.principal_units).sort((a, b) => b - a)).toEqual(receipts);
    for (const t of demands) {
      expect(t.d).toMatchObject({ rate_bps: 500, maturity_height: 61 });
      expect(t.d.payout_address).toMatch(/^X[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    }
    const demandAt = new Map<number, number>(demands.map((t): [number, number] => [t.d.principal_units, t.height]));
    for (const t of txs.filter((x) => x.op === 'protest')) {
      expect(t.d.demand_height).toEqual(demandAt.get(t.d.principal_units));
    }
    for (const t of txs.filter((x) => x.op === 'discharge')) {
      const script: string = t.node.vout[0].script;
      expect(t.d.payout_address).toEqual(keyIdToAddress(Buffer.from(script.slice(6, 46), 'hex')));
      expect(demands.some((d) => d.d.payout_address === t.d.payout_address && d.height < t.height)).toBe(true);
    }
  });
});

describe('FreeBank parser: payloads built from the headers', () => {
  const u16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const u64 = (n: number | bigint): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const vec = (items: Buffer[]): Buffer => Buffer.concat([Buffer.from([items.length]), ...items]);
  const bytes = (len: number, fill = 1): Buffer => Buffer.concat([Buffer.from([len]), Buffer.alloc(len, fill)]);

  test('note LOCK and UNLOCK (note.h)', () => {
    const lock = Buffer.concat([u32(3), u64(500000), vec([u64(1000), u64(2000)]), bytes(33), bytes(71), vec([u32(0)]), vec([bytes(71)])]);
    expect(decodeCreditPayload('note', 4, lock)).toEqual({ house_id: 3, units: 500000, change_units: 3000, outputs: 2 });
    const unlock = Buffer.concat([u32(3), vec([u64(300000), u64(100000)]), vec([u32(0)]), vec([bytes(71)])]);
    expect(decodeCreditPayload('note', 5, unlock)).toEqual({ house_id: 3, units: 400000, outputs: 2 });
  });

  test('TOKEN_KEYSET, TOKEN_POST, TOKEN_CLAIM, TOKEN_COLLECT (token.h)', () => {
    const approvals = Buffer.concat([vec([u32(0)]), vec([bytes(71)])]);
    const keys = [0, 1, 2, 10].map((e) => Buffer.concat([Buffer.from([e]), bytes(33)]));
    expect(decodeCreditPayload('note', 9, Buffer.concat([u32(2), bytes(33), vec(keys), approvals]))).toEqual({ house_id: 2, keys: 4, largest_amount: 1024 });

    const post = Buffer.concat([u32(2), u64(0x0123456789abcdefn), vec([Buffer.concat([bytes(33), u64(64)]), Buffer.concat([bytes(33), u64(8)])]),
      vec([Buffer.alloc(32, 7), Buffer.alloc(32, 8), Buffer.alloc(32, 9)]), bytes(64)]);
    const before = Buffer.from(post);
    expect(decodeCreditPayload('note', 10, post)).toEqual({ house_id: 2, keyset_id: '0123456789abcdef', issued: 2, issued_units: 72, spent: 3 });
    expect(post.equals(before)).toBe(true); // the keyset id is read from a copy

    const entry = (amount: number): Buffer => Buffer.concat([u64(1), u64(amount), bytes(64), bytes(33), bytes(33), bytes(32), bytes(32),
      bytes(25), u16(100), bytes(25), bytes(64)]);
    expect(decodeCreditPayload('note', 11, Buffer.concat([u32(2), vec([entry(32), entry(4)])]))).toEqual({ house_id: 2, tokens: 2, claimed_units: 36 });
    expect(decodeCreditPayload('note', 12, Buffer.concat([u32(2), Buffer.from([1]), vec([Buffer.alloc(32, 1), Buffer.alloc(32, 2)])])))
      .toEqual({ house_id: 2, claims: 2, escrow_change: true });
  });
});

describe('FreeBank parser: malformed input', () => {
  const settleHex: string = byKind('settle', 'exchange')[0].hex;

  test('a truncated tx, trailing bytes and non-hex throw FreebankParseError', () => {
    expect(() => parseTx(settleHex.slice(0, -2))).toThrow(FreebankParseError);
    expect(() => parseTx('10000000')).toThrow(FreebankParseError);
    expect(() => parseTx(settleHex + '00')).toThrow(/trailing/);
    expect(() => parseTx('zz')).toThrow(FreebankParseError);
    expect(() => parseTx('abc')).toThrow(FreebankParseError);
  });

  test('a payload that does not fit its layout throws; an op the headers do not define decodes to {}', () => {
    expect(() => decodeCreditPayload('settle', 1, Buffer.from('0100', 'hex'))).toThrow(FreebankParseError);
    expect(() => decodeCreditPayload('house', 7, Buffer.alloc(0))).toThrow(FreebankParseError);
    expect(decodeCreditPayload('settle', 2, Buffer.alloc(64))).toEqual({}); // reserved
    expect(decodeCreditPayload('note', 99, Buffer.alloc(0))).toEqual({});
  });

  test('a member list of a million keys is cut short by the payload, not read', () => {
    const payload = Buffer.concat([Buffer.from('01000000', 'hex'), Buffer.from('fe40420f00', 'hex'), Buffer.alloc(20 * 30)]);
    expect(() => decodeCreditPayload('house', 12, payload)).toThrow(/truncated/);
  });

  test('op names, and a neutral name for an undefined op', () => {
    expect(creditOpName('house', 7)).toEqual('attest');
    expect(creditOpName('pool', 2)).toEqual('add_liq');
    expect(creditOpName('settle', 9)).toEqual('op_9');
  });
});

describe('FreeBank parser: ByteReader and addresses', () => {
  test('compact sizes: canonical encodings only, at most MAX_SIZE', () => {
    expect(new ByteReader(Buffer.from('fc', 'hex')).compactSize()).toEqual(0xfc);
    expect(new ByteReader(Buffer.from('fdfd00', 'hex')).compactSize()).toEqual(0xfd);
    expect(() => new ByteReader(Buffer.from('fd1000', 'hex')).compactSize()).toThrow(/non-canonical/);
    expect(() => new ByteReader(Buffer.from('fe00000003', 'hex')).compactSize()).toThrow(/too large/);
  });

  test('64-bit values, signed and unsigned', () => {
    expect(new ByteReader(Buffer.from('00e1f50500000000', 'hex')).u64()).toEqual(100000000);
    expect(new ByteReader(Buffer.from('ffffffffffffffff', 'hex')).i64()).toEqual(-1);
  });

  test('keyIdToAddress: base58check with version 75', () => {
    const keyId = Buffer.from('165bc14d8e64c1141cb7ed71b4230564a9c515ee', 'hex'); // the payout of deposit-coinbases.json
    expect(keyIdToAddress(keyId)).toEqual('XDPTdcwkAe8ToyugJaNxU8BXoLcyUVaZK5');
  });
});
