import { verifySchnorr } from '../../chain/bip340';
const vectors: { i: number; pubkey: string; msg: string; sig: string; ok: boolean }[] = require('./bip340-vectors.json');

// bitcoin/bips bip-0340/test-vectors.csv: every verification vector, the invalid ones included
describe('BIP340 verification', () => {
  for (const v of vectors) {
    test(`vector ${v.i}: ${v.ok ? 'valid' : 'invalid'}`, () => {
      const hex = (s: string) => Buffer.from(s, 'hex');
      expect(verifySchnorr(hex(v.pubkey), hex(v.msg), hex(v.sig))).toBe(v.ok);
    });
  }
});
