import * as fs from 'fs';
import * as path from 'path';
import {
  BURN_ADDRESS, addressOfKey, blockHash, coinbaseTxid, depositAddress, formatDeposit, liftData, outPoint, txidOfCanonical,
  valueOf, zsideTxid,
} from '../../../chain/l2/codec';
import { thunderContent } from '../../../chain/modules/thunder';
import { bitnamesContent } from '../../../chain/modules/bitnames';
import { bitassetsContent } from '../../../chain/modules/bitassets';
import { hivemindContent } from '../../../chain/modules/hivemind';
import { coinshiftContent, coinshiftData } from '../../../chain/modules/coinshift';

// Fixtures: thunder-txhex.jsonl and bitnames-txhex.jsonl from backbone-{thunder,bitnames}/tests/data/betanet
// (the first 10 rows of BitNames'), zside-113.json: the one tx of zSide betanet block 113 (get_block(hash, true)).

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, name), 'utf8');
const jsonl = (name: string): any[] => fixture(name).split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const hexText = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

describe('L2 txids', () => {
  test('Thunder: blake3(canonical_bytes), every betanet vector', () => {
    const rows = jsonl('thunder-txhex.jsonl');
    expect(rows.length).toBe(34);
    for (const r of rows) {
      expect(txidOfCanonical(r.hex)).toBe(r.txid);
    }
  });

  test('BitNames: blake3(borsh(tx)) as get_block_index gives it', () => {
    for (const r of jsonl('bitnames-txhex.jsonl')) {
      expect(txidOfCanonical(r.hex)).toBe(r.txid);
    }
  });

  test('zSide: inputs ‖ outputs ‖ Option<bundle without auth>, not blake3(canonical_bytes)', () => {
    const z = JSON.parse(fixture('zside-113.json'));
    expect(zsideTxid(z.canonical_bytes, z.actions)).toBe(z.txid);
    expect(txidOfCanonical(z.canonical_bytes)).not.toBe(z.txid);
  });

  test('coinbase txid: blake3(merkle_root ‖ prev_main ‖ Option<prev_side>) (Hivemind betanet block 0, spent in block 2)', () => {
    expect(coinbaseTxid('984824aaa2883a8365cfa40df4b07b0f2caf2148256367a5e6147e331c575b1b',
      '0000000000000000cc7325c7048d6e0cb6eb87c35e8032917cddf70dd992b832', null))
      .toBe('a0a40e6a92a49d32254a93f713917d4080b8c28fc82d18ec07c00d893d16e228');
  });
});

describe('L2 block hashes (backbone-thunder/tests/test_thunder_types.cpp)', () => {
  const genesis = {
    merkle_root: '812c97082cde521a6128a777b45d9221259e8e3e33d6f84b7b496ef43ca6bdbb', prev_side_hash: null,
    prev_main_hash: '00000000000000039ead064d25bbb098555be80207c32ff493ec0fb0ec3f1113', roots: [],
  };
  test('Thunder genesis and block 1', () => {
    const g = blockHash(genesis, true);
    expect(g).toBe('8b52259afff825b7ccbbb35bb00de2a8cad00a7ced10ca6c58db14a21da1ec74');
    const b1 = { ...genesis, prev_side_hash: g, prev_main_hash: '0000000000000000ca123028c7f364b1991861777bcd6f529da94e5f588e3c24' };
    expect(blockHash(b1, true)).toBe('c5bd920a91d48a432f686bb7e21ed1c41777c063d1bf1ab07551c6cef7fbe14d');
  });
  test('roots: hex, {"Some": bytes}, Empty as zeros', () => {
    const r = 'ab'.repeat(32);
    const asHex = blockHash({ ...genesis, roots: [r, 'Empty'] }, true);
    expect(blockHash({ ...genesis, roots: [{ Some: [...Buffer.from(r, 'hex')] }, '00'.repeat(32)] }, true)).toBe(asHex);
    expect(blockHash({ ...genesis, roots: [r] }, false)).not.toBe(blockHash({ ...genesis, roots: [r] }, true));
  });
});

describe('L2 addresses of keys', () => {
  test('hex key (Thunder betanet block 240: the deposit spent by its key)', () => {
    expect(addressOfKey('622f11c8606ee9632f4be46fea0f22b75e5b3baa308ad6d51e578f46222b8c45')).toBe('NzSF1um4EJqobWRZbzZDPCbR32j');
    expect(addressOfKey('0x622f11c8606ee9632f4be46fea0f22b75e5b3baa308ad6d51e578f46222b8c45')).toBe('NzSF1um4EJqobWRZbzZDPCbR32j');
  });
  test('bech32m svk key', () => {
    // BitAssets betanet block 121: the key that spends deposit 4ae31197…:0, credited to this address
    expect(addressOfKey('ba-svk1ntdulzz796ltclckxgjj4s33y6a6hdmgdxxm7qm2gvq0cl6gsgzst5dkk8')).toBe('VC3WS5ERT4yLBp1AridaykefLTL');
  });
  test('not a key', () => {
    expect(addressOfKey('ba-svk1notbech32')).toBeNull();
    expect(addressOfKey('')).toBeNull();
    expect(addressOfKey('abcd')).toBeNull();
  });
});

describe('L2 deposit text', () => {
  const a = '3zTJGK3PZDUJjjoV7HtgRBJ1Q9y5';
  test('bare base58 credits it on every rule', () => {
    for (const rule of ['bare', 'prefix', 'checksum'] as const) {
      expect(depositAddress(hexText(a), rule, 9)).toBe(a);
    }
  });
  test("Thunder/zSide: the s9_ form burns (thunder_address_forms)", () => {
    const dep = formatDeposit(a, 9);
    expect(dep.startsWith(`s9_${a}_`)).toBe(true);
    expect(dep.length).toBe(`s9_${a}_`.length + 6);
    expect(depositAddress(hexText(dep), 'bare', 9)).toBe(BURN_ADDRESS);
  });
  test('BitNames/BitAssets/Coinshift: any non-empty prefix of the checksum, any case', () => {
    const dep = formatDeposit(a, 2);
    const sum = dep.slice(-6);
    expect(depositAddress(hexText(dep), 'prefix', 2)).toBe(a);
    expect(depositAddress(hexText(`s2_${a}_${sum.slice(0, 1).toUpperCase()}`), 'prefix', 2)).toBe(a);
    expect(depositAddress(hexText(`s2_${a}_`), 'prefix', 2)).toBe(BURN_ADDRESS);           // no checksum
    expect(depositAddress(hexText(`s2_${a}_zz`), 'prefix', 2)).toBe(BURN_ADDRESS);         // wrong checksum
    expect(depositAddress(hexText(formatDeposit(a, 4)), 'prefix', 2)).toBe(BURN_ADDRESS); // another slot
  });
  test('Hivemind: the full 6-hex checksum, any case', () => {
    const dep = formatDeposit(a, 13);
    expect(depositAddress(hexText(dep), 'checksum', 13)).toBe(a);
    expect(depositAddress(hexText(dep.toUpperCase().replace('S13_', 's13_').replace(a.toUpperCase(), a)), 'checksum', 13)).toBe(a);
    expect(depositAddress(hexText(dep.slice(0, -1)), 'checksum', 13)).toBe(BURN_ADDRESS);
  });
  test('not UTF-8, not an address', () => {
    expect(depositAddress('ff', 'prefix', 2)).toBe(BURN_ADDRESS);
    expect(depositAddress(hexText('hello'), 'bare', 9)).toBe(BURN_ADDRESS);
  });
});

describe('L2 outpoints', () => {
  test('the nodes\' JSON forms', () => {
    expect(outPoint({ Deposit: '51c133f7cdb5cf817bbb014306631c8f112ad9ecf052e350e31ab5eb88599d28:0' }))
      .toMatchObject({ kind: 'deposit', txid: '51c133f7cdb5cf817bbb014306631c8f112ad9ecf052e350e31ab5eb88599d28', vout: 0 });
    expect(outPoint({ Regular: { txid: 'aa'.repeat(32), vout: 3 } })).toMatchObject({ kind: 'regular', vout: 3, key: `r:${'aa'.repeat(32)}:3` });
    expect(outPoint({ Coinbase: { merkle_root: 'bb'.repeat(32), vout: 0 } })).toMatchObject({ kind: 'coinbase', txid: 'bb'.repeat(32) });
    expect(outPoint({ MarketFunds: { market_id: [1, 2, 3, 4, 5, 6], block_height: 7, is_fee: true } }))
      .toMatchObject({ kind: 'marketFunds', txid: null, vout: null, key: 'm:010203040506:7:1' });
    expect(outPoint({ Payout: { hash: 'cc'.repeat(32), vout: 1 } })).toMatchObject({ kind: 'payout', txid: 'cc'.repeat(32), vout: 1 });
  });
});

describe('L2 content and data', () => {
  test('Thunder', () => {
    expect(thunderContent({ Value: 5226439 })).toMatchObject({ type: 'value', value: 5226439 });
    const w = thunderContent({ Withdrawal: { value: 89000, main_fee: 10000, main_address: 'bc1qaw84063ptkynlelkj4l6jff2erhnru93kcdg96' } });
    expect(w).toMatchObject({ type: 'withdrawal', value: 89000, mainFee: 10000, mainAddress: 'bc1qaw84063ptkynlelkj4l6jff2erhnru93kcdg96' });
    expect(valueOf(w)).toBe(99000);
  });
  test('BitNames, unfilled and filled', () => {
    expect(bitnamesContent({ BitcoinSats: 1000 })).toMatchObject({ type: 'value', value: 1000 });
    expect(bitnamesContent('BitNameReservation')).toMatchObject({ type: 'bitnameReservation' });
    expect(bitnamesContent({ BitName: 'ab'.repeat(32) })).toMatchObject({ type: 'bitname', name: 'ab'.repeat(32) });
    expect(bitnamesContent({ Withdrawal: { value_sats: 5, main_fee_sats: 1, main_address: 'bc1x' } })).toMatchObject({ type: 'withdrawal', value: 5, mainFee: 1 });
    expect(valueOf(bitnamesContent('BitName'))).toBe(0);
  });
  test('BitAssets', () => {
    expect(bitassetsContent({ BitAsset: 21000000 })).toMatchObject({ type: 'bitasset', amount: 21000000 });
    expect(bitassetsContent({ BitAsset: ['e6'.repeat(32), 7] })).toMatchObject({ type: 'bitasset', assetId: 'e6'.repeat(32), amount: 7 });
    expect(bitassetsContent({ AmmLpToken: { asset0: '00', asset1: 'e6', amount: 3 } })).toMatchObject({ type: 'ammLpToken', amount: 3 });
    expect(bitassetsContent('BitAssetControl')).toMatchObject({ type: 'bitassetControl' });
    expect(bitassetsContent({ BitcoinWithdrawal: { value_sats: 189000, main_fee_sats: 10000, main_address: 'bc1q' } }))
      .toMatchObject({ type: 'withdrawal', value: 189000, mainFee: 10000 });
  });
  test('Hivemind market funds hold sats', () => {
    const c = hivemindContent({ MarketFunds: { market_id: [97, 94, 213, 19, 245, 102], amount: 1000000, is_fee: false } });
    expect(c).toMatchObject({ type: 'marketFunds', value: 1000000, name: '615ed513f566' });
    expect(valueOf(c)).toBe(1000000);
  });
  test('Coinshift: SwapPending holds sats, swap ids as hex', () => {
    const id = Array.from({ length: 32 }, (_, i) => 88 + i);
    const c = coinshiftContent({ SwapPending: { value: 10000, swap_id: id } });
    expect(c).toMatchObject({ type: 'swapPending', value: 10000, swapId: Buffer.from(id).toString('hex') });
    expect(valueOf(c)).toBe(10000);
    expect(coinshiftData('Regular')).toEqual({ type: 'Regular' });
    expect(coinshiftData({ SwapAccept: { swap_id: id, l2_claimer_address: 'x' } })).toEqual({ type: 'SwapAccept', swap_id: Buffer.from(id).toString('hex'), l2_claimer_address: 'x' });
  });
  test('TxData lifted', () => {
    expect(liftData({ BitNameReservation: { commitment: 'ab' } })).toEqual({ type: 'BitNameReservation', commitment: 'ab' });
    expect(liftData(null)).toBeNull();
  });
});

// Coinshift: its node is not indexed live yet; these come from backbone-coinshift/tests/data (oracle/json_cases.txt,
// a few rows; betanet/twpd255.json, the deposits' OP_RETURN text).
describe('L2 Coinshift (repo test data)', () => {
  const cases: Record<string, any> = Object.fromEntries(fixture('coinshift-json-cases.txt').split('\n').filter(l => l.trim())
    .map(l => [l.slice(0, l.indexOf(' ')), JSON.parse(l.slice(l.indexOf(' ') + 1))]));

  test('txid = blake3(borsh(tx)): get_block_index raw', () => {
    const tx = cases.block_index.txs[0];
    expect(txidOfCanonical(tx.raw)).toBe(tx.txid);
  });
  test('outputs', () => {
    expect(coinshiftContent(cases.output_value.content)).toMatchObject({ type: 'value', value: 12345 });
    expect(coinshiftContent(cases.output_withdrawal_main.content)).toMatchObject({ type: 'withdrawal', value: 89000, mainFee: 10000 });
    expect(coinshiftContent(cases.output_swap_pending.content))
      .toMatchObject({ type: 'swapPending', value: 10000, swapId: '58595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f7071727374757677' });
  });
  test('coinbase outpoints by merkle root, block index deposits and bundle spends', () => {
    expect(outPoint(cases.outpoint_1)).toMatchObject({ kind: 'coinbase', txid: '02030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2021', vout: 0 });
    expect(outPoint(cases.block_index.deposits[0].outpoint)).toMatchObject({ kind: 'deposit', vout: 7 });
    expect(outPoint(cases.block_index.bundle_spends[0].outpoint)).toMatchObject({ kind: 'regular', vout: 3 });
  });
  test('TxData', () => {
    expect(coinshiftData(cases.txdata_regular)).toEqual({ type: 'Regular' });
    expect(coinshiftData(cases.txdata_claim)).toMatchObject({ type: 'SwapClaim', swap_id: '030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122', proof_data: '0908' });
    expect(coinshiftData(cases.txdata_create_open)).toMatchObject({ type: 'SwapCreate' });
    expect(coinshiftData(cases.txdata_accept)).toMatchObject({ type: 'SwapAccept' });
  });
  test('betanet deposits are bare base58: credited, not burned', () => {
    const deps: { text: string }[] = JSON.parse(fixture('coinshift-deposits.json'));
    expect(deps.length).toBe(6);
    for (const d of deps) {
      expect(depositAddress(d.text, 'prefix', 255)).toBe(Buffer.from(d.text, 'hex').toString('utf8'));
    }
  });
});
