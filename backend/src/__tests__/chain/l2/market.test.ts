import bs58 from 'bs58';
import { L2Index, StoredBlock } from '../../../chain/l2/index';
import { CoreView } from '../../../chain/l2/core';
import { CoreFacade, RpcError } from '../../../chain/l2/facade';
import rpc, { SidechainRpcError } from '../../../chain/l2/rpc';
import { MAX_SUBMIT_BYTES, SubmitError, parseSubmission, sanitizeReason, submit } from '../../../chain/l2/submit';
import { outPoint } from '../../../chain/l2/codec';
import truthcoin, { truthcoinMarket } from '../../../chain/modules/truthcoin';
import thunder from '../../../chain/modules/thunder';
import coinshift from '../../../chain/modules/coinshift';
import { L2Chain } from '../../../chain/l2/types';

// Truthcoin's market txs in the index (chain/l2/index.ts, modules/truthcoin), the broadcast of a signed tx
// (chain/l2/submit.ts, POST /api/v1/l2/tx, the Core facade's sendrawtransaction) and an address's mempool txs.

const chain = truthcoin.l2 as L2Chain;
const h = (c: string) => c.repeat(64);
const addr = (n: number) => bs58.encode(Buffer.alloc(20, n));
const value = (n: number) => ({ Value: n });

describe('Truthcoin market rules: the Payout outpoints of a trade (betanet)', () => {
  // 36dd15eb… (height 539) bought 10000 shares of 9fdc6b8f5ed5 with a 10,000,000 sat payout; e342ec89… (540) sold
  // them: the node's outpoints of their change and proceeds (get_stxos of ispufcrwqoChxvNzG5Tnhxh4sDG)
  const trader = 'ispufcrwqoChxvNzG5Tnhxh4sDG';
  const market = [159, 220, 107, 143, 94, 213];

  test('terms of Trade and AmplifyBeta, none of other txs', () => {
    expect(truthcoinMarket.terms({ Trade: { market_id: market, outcome_index: 0, shares: -10000, trader, limit_sats: 2012 } }))
      .toEqual({ action: 'sell', marketId: '9fdc6b8f5ed5', outcome: 0, shares: -10000, limit: 2012, trader });
    expect(truthcoinMarket.terms({ AmplifyBeta: { market_id: market, market_author: trader, amount: 5 } }))
      .toMatchObject({ action: 'amplify', outcome: null, limit: null, trader });
    expect(truthcoinMarket.terms({ SubmitVote: {} })).toBeNull();
    expect(truthcoinMarket.terms(null)).toBeNull();
  });

  test('BUY_CHANGE, SELL_INPUT_CHANGE and SELL_PAYOUT as the node derives them', () => {
    const buy = truthcoinMarket.terms({ Trade: { market_id: market, outcome_index: 0, shares: 10000, trader, limit_sats: 8013 } })!;
    expect(truthcoinMarket.payouts('36dd15eb145c36cb8152c13649a38f156b73546cc171338d84f0b94ba342cde5', buy)).toEqual([
      { outpoint: { Payout: { hash: '596edce5a9e6fc5b6ca00f7b5b31f0bfa89261c766928cdcedd0e5e78bf3117c', vout: 0 } }, address: trader, kind: 'buyChange' },
    ]);
    const sell = truthcoinMarket.terms({ Trade: { market_id: market, outcome_index: 0, shares: -10000, trader, limit_sats: 2012 } })!;
    expect(truthcoinMarket.payouts('e342ec8922c38fc2b9a78bcbfb00a68c675c7a7d4912f2d6d9795e93f4677627', sell).map(p => [p.kind, p.outpoint.Payout.hash])).toEqual([
      ['sellChange', '2409375a19f9d86b5c3c1bc20095474a803d0a22b3772a0b1eab1e7971970f91'],
      ['sellProceeds', '416de1a4ba2fdd56b29a52bdaf86c96764b653b05a63d5f957ca88cf9b49a6e6'],
    ]);
  });
});

// A small Truthcoin chain:
//   block 0: deposits of 10,000,000 to P and 5,000 to Q
//   block 1: BUY (P pays, trader T): change 9,992,000 to T, cost 7,000, fee 1000; SKIP: a trade by Q over its limit
//   block 2: SELL by T spending the buy's change: change 9,991,000 and proceeds 4,000 to T; a tx by R spending a payout
//            the index never saw (S1, valued 300 by get_stxos) to 300 to Q
const [P, Q, T, R] = [1, 2, 3, 4].map(addr);
const MID = [1, 2, 3, 4, 5, 6];
const [BUY, SKIP, SELL, SPEND] = ['1', '2', '3', '4'].map(h);
const trade = (shares: number, trader: string, limit: number) => ({ Trade: { market_id: MID, outcome_index: 1, shares, trader, limit_sats: limit } });
const payout = (txid: string, shares: number, kind: string) => truthcoinMarket.payouts(txid, truthcoinMarket.terms(trade(shares, T, 0))!)
  .find(p => p.kind === kind)!.outpoint;
const S1 = { Payout: { hash: h('9'), vout: 0 } };

function blocks(): StoredBlock[] {
  const base = { prevMainHash: h('0'), prevMainHeight: 0, deposits: [], bundleSpends: [], events: [], coinbase: { txid: h('c'), outputs: [] } };
  return [
    {
      ...base, height: 0, hash: h('a'), prevHash: null, merkleRoot: h('5'), main: { hash: h('7'), height: 10, time: 1000 }, txs: [],
      deposits: [
        { outpoint: { Deposit: `${h('d')}:1` }, output: { address: P, content: value(10000000), memo: null } },
        { outpoint: { Deposit: `${h('e')}:1` }, output: { address: Q, content: value(5000), memo: null } },
      ],
    },
    {
      ...base, height: 1, hash: h('b'), prevHash: h('a'), merkleRoot: h('6'), main: { hash: h('8'), height: 11, time: 1100 },
      coinbase: { txid: h('f'), outputs: [{ address: P, content: value(1000), memo: null }] },
      txs: [
        {
          txid: BUY, size: 158, inputs: [{ Deposit: `${h('d')}:1` }], outputs: [], data: trade(10000, T, 8013), signers: [P], shielded: null,
          market: { applied: true, payouts: [{ outpoint: payout(BUY, 1, 'buyChange'), output: { address: T, content: value(9992000), memo: null }, kind: 'buyChange' }] },
        },
        {
          txid: SKIP, size: 158, inputs: [{ Deposit: `${h('e')}:1` }], outputs: [], data: trade(10, Q, 1001), signers: [Q], shielded: null,
          market: { applied: false, payouts: [] },
        },
      ],
    },
    {
      ...base, height: 2, hash: h('c'), prevHash: h('b'), merkleRoot: h('8'), main: { hash: h('9'), height: 12, time: 1200 },
      coinbase: { txid: h('e'), outputs: [{ address: P, content: value(1000), memo: null }] },
      txs: [
        {
          txid: SELL, size: 158, inputs: [payout(BUY, 1, 'buyChange')], outputs: [], data: trade(-10000, T, 2000), signers: [T], shielded: null,
          market: {
            applied: true, payouts: [
              { outpoint: payout(SELL, -1, 'sellChange'), output: { address: T, content: value(9991000), memo: null }, kind: 'sellChange' },
              { outpoint: payout(SELL, -1, 'sellProceeds'), output: { address: T, content: value(4000), memo: null }, kind: 'sellProceeds' },
            ],
          },
        },
        {
          txid: SPEND, size: 100, inputs: [S1], outputs: [{ address: Q, content: value(300), memo: null }], data: null, signers: [R], shielded: null,
          prevouts: [{ address: R, content: value(300), memo: null }],
        },
      ],
    },
  ];
}

function setup(): { index: L2Index; view: CoreView } {
  const index = new L2Index(chain);
  index.loadBlocks(blocks());
  return { index, view: new CoreView(index) };
}

describe('Truthcoin market txs in the index', () => {
  test('a buy: inputs = change + cost + miner fee', () => {
    const { index } = setup();
    const t = index.tx(BUY);
    expect(t.fee).toBe(1000);
    expect(t.inputs[0].value).toBe(10000000);
    expect(t.market).toMatchObject({ action: 'buy', marketId: '010203040506', outcome: 1, shares: 10000, limit: 8013, applied: true, cost: 7000 });
    expect(t.market.payouts).toEqual([expect.objectContaining({ kind: 'buyChange', address: T, value: 9992000, vout: 0, spent: expect.objectContaining({ txid: SELL }) })]);
    expect(t.market.trader).toBeUndefined();
  });

  test('a sell: its cost is minus its proceeds; its inputs pay the change and the fee', () => {
    const { index } = setup();
    const t = index.tx(SELL);
    expect(t.inputs[0]).toMatchObject({ address: T, value: 9992000 });
    expect(t.fee).toBe(1000);
    expect(t.market).toMatchObject({ action: 'sell', cost: -4000, applied: true });
    expect(t.market.payouts.map((p: any) => [p.kind, p.value, p.vout])).toEqual([['sellChange', 9991000, 0], ['sellProceeds', 4000, 1]]);
  });

  test('a skipped trade spends nothing and pays no fee', () => {
    const { index } = setup();
    const t = index.tx(SKIP);
    expect(t).toMatchObject({ fee: 0, market: { applied: false, cost: 0, payouts: [] } });
    expect(index.address(Q, null, 10)).toMatchObject({ balance: 5300, utxos: expect.arrayContaining([expect.objectContaining({ value: 5000 })]) });
    expect(index.address(Q, null, 10).txs.find((x: any) => x.txid === SKIP)).toMatchObject({ delta: 0 });
  });

  test('an input spending a state output the index never saw takes its value from get_stxos', () => {
    const { index } = setup();
    const t = index.tx(SPEND);
    expect(t.inputs[0]).toMatchObject({ address: R, value: 300 });
    expect(t.fee).toBe(0);
    expect(index.address(R, null, 10)).toMatchObject({ balance: 0, funded: { count: 1, sum: 300 }, spent: { count: 1, sum: 300 } });
    expect(index.address(R, null, 10).txs.map((x: any) => x.kind)).toEqual(['tx', 'state']); // newest first
  });

  test('balances: deposits = addresses + the fees the coinbases took', () => {
    const { index } = setup();
    expect(index.address(T, null, 10).balance).toBe(9995000);
    expect(index.address(P, null, 10).balance).toBe(2000); // the coinbases
    // 10,005,000 deposited, 7,000 into the market, 4,000 out of it, 300 paid out by the state (R's payout)
    expect(index.balanceSum()).toBe(9995000 + 5300 + 2000);
    expect(index.balanceSum()).toBe(10005000 - 7000 + 4000 + 300);
    expect(index.blockSummaries(2, 1)[0]).toMatchObject({ fees: 1000, volume: 9992000 });
  });

  test('the Core view: payouts after the outputs, an OP_RETURN of the market cost, the miner fee; a skipped trade spends nothing', () => {
    const { view } = setup();
    const j = view.txJson(view.tx(BUY)!.tx, null, 2);
    expect(j.vout.map((o: any) => [o.value, o.scriptPubKey.address ?? o.scriptPubKey.type])).toEqual([[0.09992, T], [0.00007, 'nulldata']]);
    expect(j.vout[1].scriptPubKey.hex).toBe('6a' + '13' + Buffer.from('market:010203040506').toString('hex'));
    expect(j.fee).toBeCloseTo(0.00001, 10);
    expect(j.market).toMatchObject({ cost: 7000 });
    const s = view.txJson(view.tx(SELL)!.tx, null, 2);
    expect(s.vin[0]).toMatchObject({ txid: BUY, vout: 0, kind: 'payout', prevout: { value: 0.09992 } });
    expect(s.vout.map((o: any) => o.value)).toEqual([0.09991, 0.00004]);
    const k = view.txJson(view.tx(SKIP)!.tx, null, 2);
    expect(k.vin).toEqual([expect.objectContaining({ coinbase: expect.any(String) })]);
    expect(k.vout).toEqual([]);
    expect(k.fee).toBe(0);
    expect(view.output(SELL, 1)?.out.value).toBe(4000);
  });
});

describe('Truthcoin: what the node says of a market tx (get_utxos, get_stxos)', () => {
  afterEach(() => jest.restoreAllMocks());

  function stored(applied: boolean): any {
    const tx: any = { txid: BUY, size: 158, inputs: [{ Deposit: `${h('d')}:1` }], outputs: [], data: trade(10000, T, 8013), signers: [P], shielded: null };
    const change = payout(BUY, 1, 'buyChange');
    jest.spyOn(rpc, 'callLimited').mockImplementation(async (method: string, _max: number, addrs: any) => {
      expect(addrs).toEqual([P, T]);
      if (method === 'get_utxos') {
        return applied ? [{ outpoint: change, output: { address: T, content: value(9992000) } }]
          : [{ outpoint: { Deposit: `${h('d')}:1` }, output: { address: P, content: value(10000000) } }];
      }
      return applied ? [{ outpoint: { Deposit: `${h('d')}:1` }, output: { output: { address: P, content: value(10000000) }, inpoint: { Regular: { txid: BUY, vin: 0 } } } }] : [];
    });
    return tx;
  }

  test('applied: its inputs spent by it, its change found', async () => {
    const index = new L2Index(chain);
    index.loadBlocks(blocks().slice(0, 1));
    const tx = stored(true);
    await (index as any).stateOfTx(tx, new Set());
    expect(tx.market).toEqual({ applied: true, payouts: [{ outpoint: payout(BUY, 1, 'buyChange'), output: { address: T, content: value(9992000), memo: null }, kind: 'buyChange' }] });
    expect(tx.prevouts).toBeUndefined(); // the deposit is in the index
  });

  test('skipped: its inputs still unspent', async () => {
    const index = new L2Index(chain);
    index.loadBlocks(blocks().slice(0, 1));
    const tx = stored(false);
    await (index as any).stateOfTx(tx, new Set());
    expect(tx.market).toEqual({ applied: false, payouts: [] });
  });

  test('a reply too large to read leaves its state unknown: it spends and pays nothing', async () => {
    const index = new L2Index(chain);
    index.loadBlocks(blocks().slice(0, 1));
    const tx = stored(true);
    jest.spyOn(rpc, 'callLimited').mockRejectedValue(new Error('maxContentLength size of 8388608 exceeded'));
    await (index as any).stateOfTx(tx, new Set());
    expect(tx.market).toEqual({ applied: false, payouts: [], unknown: true });
  });

  test('a node that does not answer is not taken for an unknown state: the error goes up', async () => {
    const index = new L2Index(chain);
    index.loadBlocks(blocks().slice(0, 1));
    const tx = stored(true);
    jest.spyOn(rpc, 'callLimited').mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect((index as any).stateOfTx(tx, new Set())).rejects.toThrow('ECONNREFUSED');
  });

  test('a retry that fails leaves the state unknown, and the retries take turns', async () => {
    const index = new L2Index(chain);
    const unknownTx = (n: number): any => ({ txid: h(String(n)), inputs: [], outputs: [], data: trade(10000, T, 8013), signers: [P],
      market: { applied: false, payouts: [], unknown: true } });
    const txs = Array.from({ length: 7 }, (_, i) => unknownTx(i + 1));
    (index as any).stored = [{ txs }];
    const asked: string[] = [];
    jest.spyOn(rpc, 'callLimited').mockImplementation(async () => { throw new Error('connect ECONNREFUSED'); });
    jest.spyOn(index as any, 'stateOfTx').mockImplementation(async (tx: any) => { asked.push(tx.txid); throw new Error('connect ECONNREFUSED'); });
    await (index as any).retryUnknown();
    await (index as any).retryUnknown();
    expect(txs.every(t => t.market?.unknown === true)).toBe(true); // nothing lost to the failures
    expect(asked.slice(0, 5)).toEqual(txs.slice(0, 5).map(t => t.txid));
    expect(asked.slice(5, 7)).toEqual([txs[5].txid, txs[6].txid]); // the second round starts where the first stopped
  });

  test('another chain\'s txs ask nothing', async () => {
    const spy = jest.spyOn(rpc, 'callLimited');
    const index = new L2Index(thunder.l2 as L2Chain);
    const tx: any = { txid: BUY, inputs: [{ Regular: { txid: h('0'), vout: 0 } }], outputs: [], data: null, signers: [P] };
    await (index as any).stateOfTx(tx, new Set());
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('An address\'s mempool txs (list_mempool)', () => {
  test('inputs it owns and outputs to it, and the net delta; a market tx pays the miner fee', () => {
    const { index } = setup();
    const change = payout(SELL, -1, 'sellChange');
    const entries = [
      { txid: h('5'), size: 100, tx: { inputs: [[change, h('0')]], outputs: [{ address: Q, content: value(9990000) }], data: null } },
      { txid: h('6'), size: 150, tx: { inputs: [[payout(SELL, -1, 'sellProceeds'), h('0')]], outputs: [], data: trade(5, T, 4000) } },
      { txid: h('7'), size: 100, tx: { inputs: [], outputs: [{ address: R, content: value(1) }], data: null } },
    ];
    const m = index.addressMempool(T, entries);
    expect(m.txs.map(t => [t.txid, t.delta, t.fee])).toEqual([[h('5'), -9991000, 1000], [h('6'), -4000, 1000]]);
    expect(m.delta).toBe(-9995000);
    expect(m.txs[1].market).toMatchObject({ action: 'buy', cost: null, applied: null });
    expect(index.addressMempool(P, entries)).toEqual({ txs: [], delta: 0 });
  });
});

describe('Broadcast (POST /api/v1/l2/tx, sendrawtransaction)', () => {
  test('request bodies: hex text, {hex}, the node\'s Authorized JSON; else 400', () => {
    expect(parseSubmission(' 0xABcd\n')).toEqual({ hex: 'abcd' });
    expect(parseSubmission({ hex: '0102' })).toEqual({ hex: '0102' });
    const authorized = { transaction: { inputs: [], outputs: [] }, authorizations: [] };
    expect(parseSubmission(authorized)).toEqual({ json: authorized });
    for (const bad of ['', 'abc', 'zz', { hex: 5 }, { transaction: {} }, [], null, 'ab'.repeat(MAX_SUBMIT_BYTES / 2 + 1)]) {
      expect(() => parseSubmission(bad)).toThrow(SubmitError);
    }
  });

  test('the node\'s rejection text is kept, cleaned up', () => {
    expect(sanitizeReason('invalid transaction: Input value 5 sats insufficient for limit_sats 9 sats')).toBe('invalid transaction: Input value 5 sats insufficient for limit_sats 9 sats');
    expect(sanitizeReason('connect ECONNREFUSED 216.128.183.114:16013 at http://node.internal:6013/x /opt/app/x.cpp')).toBe('connect ECONNREFUSED <host> at <url> <path>');
    expect(sanitizeReason('a\u0000b\n' + 'x'.repeat(300))!.length).toBe(200);
    expect(sanitizeReason('  ')).toBeNull();
  });

  test('to the node: push_tx for hex, submit_transaction for JSON; its txid', async () => {
    const node = { call: jest.fn(async () => h('A')) };
    expect(await submit(chain, node, { hex: '00' })).toBe(h('a'));
    expect(node.call).toHaveBeenLastCalledWith('push_tx', '00');
    await submit(chain, node, { json: { transaction: {}, authorizations: [] } });
    expect(node.call).toHaveBeenLastCalledWith('submit_transaction', { transaction: {}, authorizations: [] });
  });

  test('a rejection is a 400 with the reason; no answer a 502 without; a chain without a submit method 404', async () => {
    const reject = { call: async () => { throw new SidechainRpcError('push_tx', -1, 'failed to deserialize AuthorizedTransaction: unexpected end of input', true); } };
    await expect(submit(chain, reject, { hex: '00' })).rejects.toMatchObject({ status: 400, message: 'The node rejected the transaction',
      reason: 'failed to deserialize AuthorizedTransaction: unexpected end of input' });
    const down = { call: async () => { throw new SidechainRpcError('push_tx', 502, 'HTTP 502'); } };
    await expect(submit(chain, down, { hex: '00' })).rejects.toMatchObject({ status: 502, reason: null });
    const weird = { call: async () => 'not a txid' };
    await expect(submit(chain, weird, { hex: '00' })).rejects.toMatchObject({ status: 502 });
    await expect(submit(thunder.l2 as L2Chain, weird, { hex: '00' })).rejects.toMatchObject({ status: 400 });
    await expect(submit(coinshift.l2 as L2Chain, weird, { hex: '00' })).rejects.toMatchObject({ status: 404 });
  });

  test('the Core facade\'s sendrawtransaction: the txid, or Core\'s codes (-22 malformed, -26 rejected)', async () => {
    const { index } = setup();
    let answer: any = h('b');
    const facade = new CoreFacade(index, { call: async (m: string) => {
      if (m === 'list_mempool') {
        return [];
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    } });
    expect(await facade.call('sendrawtransaction', ['00ff'])).toBe(h('b'));
    const code = (p: any[]) => facade.call('sendrawtransaction', p).then(() => 0, (e: RpcError) => [e.code, e.message]);
    expect(await code(['xyz'])).toEqual([-22, 'TX decode failed']);
    answer = new SidechainRpcError('push_tx', -1, 'utxo regular:abcd:0 doesn\'t exist', true);
    expect(await code(['00'])).toEqual([-26, 'The node rejected the transaction: utxo regular:abcd:0 doesn\'t exist']);
    answer = new Error('socket hang up');
    expect((await code(['00']) as any[])[0]).toBe(-1);
    expect(outPoint(S1).key).toBe(`p:${h('9')}:0`);
  });
});
