import bitcoinClient from '../../../api/bitcoin/bitcoin-client';
import flushTokens from '../../../chain/modules/flush/tokens';

// GET address/:address/utxo's token field on Flush: confirmed outputs from gettxout (7.0.1's token, or nothing on an
// older node), unconfirmed ones from the marker (decodeassettx), a pending result not spendable.

jest.mock('../../../api/bitcoin/bitcoin-client', () => ({ __esModule: true, default: { call: jest.fn() } }));
const call = bitcoinClient.call as jest.Mock;

const ID = 'ab'.repeat(32);
const MARKER = { scriptPubKey: { hex: '6a0542415354' + '00' } };
const confirmed = (txid: string, vout: number) => ({ txid, vout, value: 1000, status: { confirmed: true, block_hash: 'h' + txid } });
const unconfirmed = (txid: string, vout: number) => ({ txid, vout, value: 1000, status: { confirmed: false } });

beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (method: string, ...p: any[]) => {
    if (method === 'gettxout') {
      if (p[0] === 'old') return { value: 0.00001 }; // a node without the field
      if (p[0] === 'plain') return { value: 0.00001, token: null };
      return { value: 0.00001, token: { kind: 0, kind_name: 'asset', id: ID, amount_units: '157000000000000000' } };
    }
    if (method === 'getrawtransaction') {
      return p[0] === 'm-plain' ? { hex: '00', vout: [{ n: 0, scriptPubKey: { hex: '0014' + '00'.repeat(20) } }] }
        : { hex: 'ff', vout: [MARKER, { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] };
    }
    if (method === 'decodeassettx') {
      return { marker: true, outputs: [
        { n: 1, carries: 'asset', id: ID, amount: 5 },
        { n: 2, carries: 'result' },
        { n: 3, carries: 'lp', id: ID, amount: 2 ** 60 }, // past 2^53, no amount_units: not exact
        { n: 4, carries: 'position', id: ID, amount: 1, amount_units: '1' },
      ] };
    }
    throw new Error('unexpected ' + method);
  });
});

describe('Flush UTXO tokens', () => {
  test('confirmed outputs: the node state token, null, or absent on an older node', async () => {
    const [a, b, c] = await flushTokens.annotate([confirmed('tok', 0), confirmed('plain', 1), confirmed('old', 0)] as any);
    expect(a.token).toEqual({ kind: 0, id: ID, amount_units: '157000000000000000' });
    expect(a.spendable).toBe(true);
    expect(b.token).toBeNull();
    expect('token' in c).toBe(false);
    expect('spendable' in c).toBe(false);
  });

  test('unconfirmed outputs: from the marker; a result pending, an inexact amount not spendable', async () => {
    const r = await flushTokens.annotate([1, 2, 3, 4, 5].map(n => unconfirmed('m-tok', n)) as any);
    expect(r[0]).toMatchObject({ token: { kind: 0, id: ID, amount_units: '5' }, spendable: true });
    expect(r[1]).toMatchObject({ token: null, spendable: false });
    expect(r[2]).toMatchObject({ token: null, spendable: false });
    expect(r[3]).toMatchObject({ token: { kind: 5, id: ID, amount_units: '1' }, spendable: true });
    expect(r[4]).toMatchObject({ token: null, spendable: true }); // not listed by the marker: plain ECX
    const [p] = await flushTokens.annotate([unconfirmed('m-plain', 0)] as any);
    expect(p).toMatchObject({ token: null, spendable: true });
  });

  test('a node error leaves the output as it was', async () => {
    call.mockRejectedValue(new Error('down'));
    const [u] = await flushTokens.annotate([confirmed('fresh', 7)] as any);
    expect('token' in u).toBe(false);
  });
});
