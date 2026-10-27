import * as bitcoin from 'bitcoinjs-lib';
import { bech32 } from 'bech32';
import { AddressContext, TAGS, assetMarker, assetMarkerKind, decodeMarkers, decodeOutput, hasAssetMarker, taggedPush } from '../../../chain/modules/flush/markers';
import { ArgsError, MAX_ARGS_TEXT, RPC_METHODS, logoAsset, parseRpcArgs } from '../../../chain/modules/flush/allowlist';
import { rpcFailure } from '../../../chain/modules/flush/routes';

// Flush's peg and stake markers, crafted from their layouts in backbone-flush (sidechain/script.cpp, pos/bond.h,
// pos/evidence.h, pos/feesplit.h), with the BIP173 key hash so that the addresses are known ones; and the RPC
// allowlist's argument checks.

const KEYHASH = '751e76e8199196d454941c45d1b3a323f1433bd6'; // BIP173: bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4
const CTX: AddressContext = { flushHrp: 'bflx', main: { ...bitcoin.networks.bitcoin, bech32: 'bc' } };
const XONLY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const TXID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00';
const rev = (h: string) => Buffer.from(h, 'hex').reverse().toString('hex');
const le64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b.toString('hex'); };
const le32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b.toString('hex'); };
const SIG = '1f'.repeat(65);

/** OP_RETURN with one push of `hex`, as CScript() << OP_RETURN << data writes it */
function opReturn(hex: string): string {
  const n = hex.length / 2;
  const len = n <= 0x4b ? n.toString(16).padStart(2, '0') : n <= 0xff ? '4c' + n.toString(16).padStart(2, '0') : '4d' + Buffer.from([n & 0xff, n >> 8]).toString('hex');
  return '6a' + len + hex;
}

describe('Flush markers: the script form', () => {
  test('one push to the end of the script, of any push opcode', () => {
    expect(taggedPush(Buffer.from('6a04de56504c', 'hex'))?.toString('hex')).toBe('de56504c');
    expect(taggedPush(Buffer.from('6a4c04de56504c', 'hex'))?.toString('hex')).toBe('de56504c');
    expect(taggedPush(Buffer.from('6a4d0400de56504c', 'hex'))?.toString('hex')).toBe('de56504c');
    expect(taggedPush(Buffer.from('6a4e04000000de56504c', 'hex'))?.toString('hex')).toBe('de56504c');
    expect(taggedPush(Buffer.from('6a04de56504c51', 'hex'))).toBeNull(); // something after the push
    expect(taggedPush(Buffer.from('6a05de56504c', 'hex'))).toBeNull(); // short
    expect(taggedPush(Buffer.from('0004de56504c', 'hex'))).toBeNull(); // not OP_RETURN
    expect(taggedPush(Buffer.from('6a51', 'hex'))).toBeNull(); // OP_1 is not a push of data
  });
});

describe('Flush markers: the peg (sidechain/state.h)', () => {
  test('a withdrawal: fee, refund key, the eCash destination; amount = value - fee', () => {
    const script = opReturn(TAGS.withdrawal + le64(1000n) + KEYHASH + '0014' + KEYHASH);
    const d = decodeOutput(script, 1, 100000, CTX);
    expect(d?.peg).toEqual({
      kind: 'withdrawal', vout: 1, value: 100000, amount: 99000, mainFee: 1000, refundKeyHash: KEYHASH,
      refundAddress: bech32.encode('bflx', [0, ...bech32.toWords(Buffer.from(KEYHASH, 'hex'))]),
      mainScript: '0014' + KEYHASH, mainAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', valid: true,
    });
    expect((d?.peg as any).refundAddress).toMatch(/^bflx1q/);
  });

  test('a withdrawal the node would not take: fee not below the value, a destination no node relays', () => {
    const w1 = decodeOutput(opReturn(TAGS.withdrawal + le64(5000n) + KEYHASH + '0014' + KEYHASH), 0, 5000, CTX)?.peg as any;
    expect([w1.valid, w1.amount]).toEqual([false, 0]);
    const w2 = decodeOutput(opReturn(TAGS.withdrawal + le64(10n) + KEYHASH + '51'), 0, 5000, CTX)?.peg as any;
    expect([w2.valid, w2.mainAddress]).toEqual([false, null]);
    // no destination, or one longer than 80 bytes: not a withdrawal at all
    expect(decodeOutput(opReturn(TAGS.withdrawal + le64(10n) + KEYHASH), 0, 5000, CTX)).toBeNull();
    expect(decodeOutput(opReturn(TAGS.withdrawal + le64(10n) + KEYHASH + '00'.repeat(81)), 0, 5000, CTX)).toBeNull();
  });

  test('a refund: the withdrawal it takes back (txid in display order)', () => {
    const d = decodeOutput(opReturn(TAGS.refund + rev(TXID) + le32(3) + SIG), 0, 0, CTX);
    expect(d?.peg).toEqual({ kind: 'refund', vout: 0, withdrawal: { txid: TXID, vout: 3 } });
    expect(decodeOutput(opReturn(TAGS.refund + rev(TXID) + le32(3) + SIG.slice(2)), 0, 0, CTX)).toBeNull();
  });

  test('a bundle commitment', () => {
    expect(decodeOutput(opReturn(TAGS.bundle + rev(TXID)), 2, 0, CTX)?.peg).toEqual({ kind: 'bundle', vout: 2, hash: TXID });
    expect(decodeOutput(opReturn(TAGS.bundle + rev(TXID) + '00'), 2, 0, CTX)).toBeNull();
  });
});

describe('Flush markers: stake (pos/bond.h, evidence.h, feesplit.h)', () => {
  test('a bond, with and without the owner\'s signature; the amount is the output\'s value', () => {
    const body = TAGS.bond + XONLY + KEYHASH + '22'.repeat(64);
    const signed = decodeOutput(opReturn(body + SIG), 0, 5e9, CTX)?.stake as any;
    expect(signed).toMatchObject({ kind: 'bond', amount: 5e9, pubkey: XONLY, owner: KEYHASH, signed: true });
    expect(signed.ownerAddress).toMatch(/^bflx1q/);
    expect((decodeOutput(opReturn(body), 0, 5e9, CTX)?.stake as any).signed).toBe(false);
    expect(decodeOutput(opReturn(body + '00'), 0, 5e9, CTX)).toBeNull();
  });

  test('an unbond: an amount, or all (0)', () => {
    expect(decodeOutput(opReturn(TAGS.unbond + XONLY + le64(250000000n) + le32(7) + SIG), 1, 0, CTX)?.stake)
      .toEqual({ kind: 'unbond', vout: 1, pubkey: XONLY, amount: 250000000, all: false, sequence: 7 });
    expect(decodeOutput(opReturn(TAGS.unbond + XONLY + le64(0n) + le32(0) + SIG), 1, 0, CTX)?.stake)
      .toEqual({ kind: 'unbond', vout: 1, pubkey: XONLY, amount: null, all: true, sequence: 0 });
  });

  test('evidence: two headers, plain or extended (hash = sha256d of the 80 bytes, plus hashSections if extended)', () => {
    // Bitcoin's genesis header: hash 000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f
    const genesis = '01000000' + '00'.repeat(32) + '3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a' + '29ab5f49' + 'ffff001d' + '1dac2b7c';
    const ext = '00000120' + 'ab'.repeat(32) + 'cd'.repeat(32) + le32(1792758000) + '00000000' + '00000000' + 'ee'.repeat(32) + '99'.repeat(64);
    const d = decodeOutput(opReturn(TAGS.evidence + genesis + ext), 0, 0, CTX)?.stake as any;
    expect(d.kind).toBe('evidence');
    expect(d.headers[0]).toEqual({ hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f', prevHash: '00'.repeat(32), time: 1231006505 });
    expect(d.headers[1].prevHash).toBe('ab'.repeat(32));
    expect(d.headers[1].time).toBe(1792758000);
    // the signature is not hashed, hashSections is
    const ext2 = ext.slice(0, -128) + '98'.repeat(64);
    const ext3 = ext.slice(0, 160) + 'ef'.repeat(32) + '99'.repeat(64);
    const h = (x: string) => (decodeOutput(opReturn(TAGS.evidence + genesis + x), 0, 0, CTX)?.stake as any).headers[1].hash;
    expect(h(ext2)).toBe(d.headers[1].hash);
    expect(h(ext3)).not.toBe(d.headers[1].hash);
    expect(decodeOutput(opReturn(TAGS.evidence + genesis + ext.slice(0, -2)), 0, 0, CTX)).toBeNull();
    expect(decodeOutput(opReturn(TAGS.evidence + genesis), 0, 0, CTX)).toBeNull();
  });

  test('the validator pool and its shares', () => {
    expect(decodeOutput('6a04de56504c', 3, 12345, CTX)?.stake).toEqual({ kind: 'validatorPool', vout: 3, amount: 12345 });
    expect(decodeOutput('6a08de565053' + le32(5), 4, 0, CTX)?.stake).toEqual({ kind: 'validatorShares', vout: 4, count: 5 });
    expect(decodeOutput('6a05de56504c00', 3, 0, CTX)).toBeNull();
  });

  test('not markers: other scripts, unknown tags, junk', () => {
    expect(decodeOutput('0014' + KEYHASH, 0, 1, CTX)).toBeNull();
    expect(decodeOutput(opReturn('d1617368' + '00'.repeat(32)), 0, 0, CTX)).toBeNull(); // a BIP300 M7
    expect(decodeOutput('6a', 0, 0, CTX)).toBeNull();
    expect(decodeOutput('6azz', 0, 0, CTX)).toBeNull();
    expect(decodeOutput(undefined as any, 0, 0, CTX)).toBeNull();
  });

  test('a transaction: every marker in output order; the asset marker is seen, not decoded', () => {
    const tx = { vout: [
      { n: 0, value: 0.001, scriptPubKey: { hex: opReturn(TAGS.withdrawal + le64(1000n) + KEYHASH + '0014' + KEYHASH) } },
      { n: 1, value: 1, scriptPubKey: { hex: '0014' + KEYHASH } },
      { n: 2, value: 0.5, scriptPubKey: { hex: '6a04de56504c' } },
      { n: 3, value: 0, scriptPubKey: { hex: opReturn('42415354' + '0006') } },
    ] };
    const m = decodeMarkers(tx, CTX);
    expect(m.peg.map(p => [p.kind, p.vout])).toEqual([['withdrawal', 0]]);
    expect(m.stake).toEqual([{ kind: 'validatorPool', vout: 2, amount: 50000000 }]);
    expect(hasAssetMarker(tx)).toBe(true);
    expect(hasAssetMarker({ vout: [tx.vout[0], tx.vout[1]] })).toBe(false);
    expect(hasAssetMarker({ vout: [{ scriptPubKey: { hex: '6a4c0642415354aabb' } }] })).toBe(true);
    expect(hasAssetMarker({ vout: [{ scriptPubKey: { hex: '6a514241535400' } }] })).toBe(false);
    expect(assetMarkerKind({ vout: [{ scriptPubKey: { hex: '6a4c06424153540015' } }] })).toBe(21);
    expect(assetMarkerKind({ vout: [{ scriptPubKey: { hex: '6a4c06424153540021' } }] })).toBe(33);
    expect(assetMarkerKind({ vout: [{ scriptPubKey: { hex: '6a4c0542415354' } }] })).toBeNull();
    // betanet swap_pools 0944a245…: CHN in, one pool, 5 ECX in, a CHN destination, one result output
    const swap = { vout: [{ scriptPubKey: { hex: '6a4c6a424153540015000000000000000000000000000000000000000000000000000000000000000001fa28c799cd0f705d0b9629e2d5324c824eb43a5ae50de27bbf426cc505ad1e6e81b09540879fd08d7b1600149c0bf667fb15c6221b25c7341091f55a66566d2e0100ff' } }] };
    expect(assetMarker(swap)).toEqual({ markerKind: 21, chnTo: '00149c0bf667fb15c6221b25c7341091f55a66566d2e' });
  });
});

describe('Flush: the node RPC allowlist', () => {
  test('read methods only', () => {
    for (const m of ['sendrawtransaction', 'getnewaddress', 'stop', 'setbmm', 'createbmmblock', 'submitevidence', 'setstaking',
      'signbondpop', 'syncmainchain', 'requestbmmblock', 'simulateclearing', 'previewpool', 'decodeassettx', 'getassetlogo',
      'listwallets', 'dumpprivkey', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(() => parseRpcArgs(m, undefined)).toThrow(ArgsError);
    }
    expect(Object.keys(RPC_METHODS)).toEqual(expect.arrayContaining(['getlaunch', 'getpoolcandles', 'getposinfo', 'listwithdrawals', 'quoteroute']));
    expect(Object.keys(RPC_METHODS).some(m => /^(send|sign|set|create|submit|import|dump|stop|wallet)/.test(m))).toBe(false);
  });

  test('arguments: a JSON array of plain values, objects and arrays two levels deep, bounded', () => {
    expect(parseRpcArgs('getposinfo', undefined)).toEqual([]);
    expect(parseRpcArgs('getposinfo', '')).toEqual([]);
    expect(parseRpcArgs('getasset', '["MOON", 12]')).toEqual(['MOON', 12]);
    expect(parseRpcArgs('listlaunches', '[{"status":"curve","limit":20}]')).toEqual([{ status: 'curve', limit: 20 }]);
    expect(parseRpcArgs('getverifications', '["MOON", ["a","b"]]')).toEqual(['MOON', ['a', 'b']]);
    expect(parseRpcArgs('listauctions', '[true, 10, 0, null]')).toEqual([true, 10, 0, null]);
    // the search RPCs: query, filters (with a keyword list inside), sort, cursor, limit
    expect(parseRpcArgs('searchassets', '["moon", {"exclude_keywords":["scam"]}, "volume", "", 20]'))
      .toEqual(['moon', { exclude_keywords: ['scam'] }, 'volume', '', 20]);
    for (const [m, a] of [
      ['getposinfo', '["x"]'], ['getasset', '["a",1,2]'], ['getasset', '{"asset":"MOON"}'], ['getasset', 'MOON'],
      ['getasset', '[{"a":{"b":{"c":1}}}]'], ['getasset', '[[[[1]]]]'], ['searchassets', '[1,2,3,4,5,6]'], ['getasset', `["${'x'.repeat(257)}"]`], ['getasset', '["a\\u0000"]'],
      ['getverifications', `["a", [${Array(21).fill('"x"').join(',')}]]`], ['listlaunches', '[{"bad key":1}]'],
      ['getasset', '[1e999]'], ['getasset', 'x'.repeat(MAX_ARGS_TEXT + 1)], ['getasset', ['a'] as any],
    ] as [string, string][]) {
      expect(() => parseRpcArgs(m, a)).toThrow(ArgsError);
    }
  });

  test('logo ids: a 64-hex id goes as 0x<id>, a ticker as is', () => {
    expect(logoAsset('d105afe28f328260cf6397b5dbb38bfa7a15a74c721533ed9b2c39f13094dfad')).toBe('0xd105afe28f328260cf6397b5dbb38bfa7a15a74c721533ed9b2c39f13094dfad');
    expect(logoAsset('MOON')).toBe('MOON');
    expect(logoAsset('../x')).toBeNull();
    expect(logoAsset('')).toBeNull();
  });

  test('node errors: unknown 404, malformed 400, refused 501, the rest 503, never the node\'s text', () => {
    expect(rpcFailure({ code: -8, message: 'No such asset is registered' }).status).toBe(404);
    expect(rpcFailure({ code: -5, message: 'No such mempool or blockchain transaction' }).status).toBe(404);
    expect(rpcFailure({ code: -32601, message: 'Method not found' }).status).toBe(404);
    expect(rpcFailure({ code: -1, message: 'help text' }).status).toBe(400);
    expect(rpcFailure({ code: -3, message: 'Expected type number' }).status).toBe(400);
    expect(rpcFailure({ code: -32602, message: 'Invalid params, response status code: 401' }).status).toBe(503);
    // the node's rpcwhitelist refuses the method to our user
    expect(rpcFailure({ code: -32602, message: 'Invalid params, response status code: 403' }).status).toBe(501);
    expect(rpcFailure({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.1:38994' }).status).toBe(503);
    expect(rpcFailure({ code: -28, message: 'Loading block index' }).publicMessage).not.toMatch(/index/);
  });
});
