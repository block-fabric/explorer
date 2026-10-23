import * as bitcoinjs from 'bitcoinjs-lib';
import bs58 from 'bs58';
import { L2Index, StoredBlock } from '../../../chain/l2/index';
import { CoreView, addressOfScript, header, scriptOf } from '../../../chain/l2/core';
import { CoreFacade, RpcError } from '../../../chain/l2/facade';
import thunder from '../../../chain/modules/thunder';
import { L2Chain } from '../../../chain/l2/types';

// The Core JSON-RPC view of a sidechain index (chain/l2/core.ts, facade.ts) on a small synthetic Thunder chain:
//   block 0: coinbase 1000 to A; deposit (eCash D:1) of 5000 to B
//   block 1: T1 spends the coinbase output and the deposit: 5500 to C and a withdrawal of 300 + 100 main fee by W,
//            fee 100; its coinbase pays 100 to A
//   block 2: the bundle M spends the withdrawal (no sidechain tx)

const addr = (n: number) => bs58.encode(Buffer.alloc(20, n));
const [A, B, C, W] = [1, 2, 3, 4].map(addr);
const h = (c: string) => c.repeat(64);
const D = h('d');
const M = h('e');
const T1 = h('1');
const CB0 = h('a');
const CB1 = h('b');
const value = (n: number) => ({ Value: n });

function chain(): StoredBlock[] {
  const base = { prevMainHash: h('0'), prevMainHeight: 0, deposits: [], bundleSpends: [], events: [] };
  return [
    {
      ...base, height: 0, hash: h('2'), prevHash: null, merkleRoot: h('5'), main: { hash: h('7'), height: 10, time: 1000 },
      coinbase: { txid: CB0, outputs: [{ address: A, content: value(1000), memo: null }] }, txs: [],
      deposits: [{ outpoint: { Deposit: `${D}:1` }, output: { address: B, content: value(5000), memo: null } }],
    },
    {
      ...base, height: 1, hash: h('3'), prevHash: h('2'), merkleRoot: h('6'), main: { hash: h('8'), height: 11, time: 900 },
      coinbase: { txid: CB1, outputs: [{ address: A, content: value(100), memo: null }] },
      txs: [{
        txid: T1, size: 150, inputs: [{ Coinbase: { txid: CB0, vout: 0 } }, { Deposit: `${D}:1` }],
        outputs: [
          { address: C, content: value(5500), memo: null },
          { address: W, content: { Withdrawal: { value: 300, main_fee: 100, main_address: 'bc1qmain' } }, memo: null },
        ],
        data: null, signers: [A, B], shielded: null,
      }],
    },
    {
      ...base, height: 2, hash: h('4'), prevHash: h('3'), merkleRoot: h('9'), main: { hash: h('f'), height: 12, time: 1200 },
      coinbase: { txid: h('c'), outputs: [] }, txs: [], bundleSpends: [{ outpoint: { Regular: { txid: T1, vout: 1 } }, m6id: M }],
      events: [{ m6id: M, kind: 'submitted', mainHeight: 12 }],
    },
  ];
}

function setup(module: L2Chain = thunder.l2 as L2Chain): { index: L2Index; view: CoreView; facade: CoreFacade; node: jest.Mock } {
  const index = new L2Index(module);
  index.loadBlocks(chain());
  const node = jest.fn(async () => []);
  const facade = new CoreFacade(index, { call: node as any });
  return { index, view: facade.view, facade, node };
}

describe('L2 Core view: scripts and headers', () => {
  test('an address as a P2PKH-shaped script and back', () => {
    const s = scriptOf(A);
    expect(s.hex).toBe('76a914' + '01'.repeat(20) + '88ac');
    expect(s.type).toBe('pubkeyhash');
    expect(s.address).toBe(A);
    expect(addressOfScript(s.hex)).toBe(A);
  });

  test('the 80-byte header: version 1, reversed hashes, time, bits 1d00ffff, nonce 0', () => {
    const hdr = Buffer.from(header(h('3'), h('6'), 1234), 'hex');
    expect(hdr.length).toBe(80);
    const b = bitcoinjs.Block.fromBuffer(hdr);
    expect(b.version).toBe(1);
    expect(Buffer.from(b.prevHash as Buffer).reverse().toString('hex')).toBe(h('3'));
    expect(Buffer.from(b.merkleRoot as Buffer).reverse().toString('hex')).toBe(h('6'));
    expect(b.timestamp).toBe(1234);
    expect(b.bits).toBe(0x1d00ffff);
    expect(b.nonce).toBe(0);
  });
});

describe('L2 Core view: blocks and transactions', () => {
  test('block 0: the coinbase, then a deposit tx with the eCash txid and the deposit at its eCash vout', () => {
    const { view } = setup();
    const b = view.block(0)!;
    expect(b.txs.map(t => t.txid)).toEqual([CB0, D]);
    const j = view.blockJson(b, 2);
    expect(j.tx[0].vin[0].coinbase).toBeDefined();
    expect(j.tx[0].fee).toBeUndefined();
    const dep = j.tx[1];
    expect(dep.peg).toBe('deposit');
    expect(dep.mainTxid).toBe(D);
    expect(dep.vout).toHaveLength(2);
    expect(dep.vout[0]).toMatchObject({ value: 0, n: 0, scriptPubKey: { type: 'nulldata' } });
    expect(dep.vout[1]).toMatchObject({ value: 0.00005, n: 1, scriptPubKey: { address: B, type: 'pubkeyhash' } });
    expect(dep.fee).toBe(0);
  });

  test('block 1: inputs name the coinbase and the deposit, prevouts at verbosity 3, the fee, the withdrawal', () => {
    const { view } = setup();
    const j = view.blockJson(view.block(1)!, 3);
    expect(j.tx.map((t: any) => t.txid)).toEqual([CB1, T1]);
    const t = j.tx[1];
    expect(t.vin[0]).toMatchObject({ txid: CB0, vout: 0, scriptSig: { asm: '', hex: '' }, sequence: 0xffffffff });
    expect(t.vin[0].prevout).toMatchObject({ generated: true, height: 0, value: 0.00001, scriptPubKey: { address: A } });
    expect(t.vin[1]).toMatchObject({ txid: D, vout: 1, deposit: true, prevout: { generated: false, height: 0, value: 0.00005 } });
    expect(t.fee).toBeCloseTo(0.000001, 10);
    expect(t.size).toBe(150);
    expect(t.vsize).toBe(150);
    expect(t.weight).toBe(600);
    expect(t.vout[1].value).toBeCloseTo(0.000004, 10);
    expect(t.vout[1].withdrawal).toEqual({ main_address: 'bc1qmain', value: 300, main_fee: 100 });
    expect(t.vout[1].content.type).toBe('withdrawal');
    expect(t.vout[0].content).toBeUndefined();
    // verbosity 2: no prevouts
    expect(view.blockJson(view.block(1)!, 2).tx[1].vin[0].prevout).toBeUndefined();
    expect(view.blockJson(view.block(1)!, 1).tx).toEqual([CB1, T1]);
  });

  test('block 2: the bundle as a withdrawal tx (txid = M6 id) spending the withdrawal into OP_RETURN', () => {
    const { view } = setup();
    const j = view.blockJson(view.block(2)!, 3);
    const w = j.tx[1];
    expect(w).toMatchObject({ txid: M, peg: 'withdrawal', m6id: M, fee: 0 });
    expect(w.vin).toHaveLength(1);
    expect(w.vin[0]).toMatchObject({ txid: T1, vout: 1, prevout: { value: 0.000004, height: 1 } });
    expect(w.vout).toEqual([{ value: 0.000004, n: 0, scriptPubKey: { asm: `OP_RETURN ${M}`, hex: '6a20' + M, type: 'nulldata' } }]);
  });

  test('times are the BMM times kept non-decreasing; the median of the last 11', () => {
    const { view } = setup();
    expect([0, 1, 2].map(x => view.block(x)!.time)).toEqual([1000, 1000, 1200]);
    expect(view.headerJson(view.block(2)!)).toMatchObject({
      height: 2, confirmations: 1, previousblockhash: h('3'), merkleroot: h('9'), mediantime: 1000, bits: '1d00ffff', difficulty: 1, nTx: 2,
      chainwork: '0000000000000000000000000000000000000000000000000000000300030003',
    });
    expect(view.headerJson(view.block(0)!).nextblockhash).toBe(h('3'));
  });

  test('raw txs and blocks are Bitcoin serializations of the same inputs and outputs', () => {
    const { view } = setup();
    const b = view.block(1)!;
    const t = b.txs[1];
    const tx = bitcoinjs.Transaction.fromHex(t.hex);
    expect(tx.ins.map(i => [Buffer.from(i.hash).reverse().toString('hex'), i.index])).toEqual([[CB0, 0], [D, 1]]);
    expect(tx.outs.map(o => o.value)).toEqual([5500, 400]);
    expect(tx.outs[0].script.toString('hex')).toBe(scriptOf(C).hex);
    const raw = view.blockJson(b, 0) as string;
    const block = bitcoinjs.Block.fromHex(raw);
    expect(block.transactions!.length).toBe(2);
    expect(block.transactions![0].isCoinbase()).toBe(true);
    expect(block.transactions![1].toHex()).toBe(t.hex);
    expect(raw.slice(0, 160)).toBe(b.header);
  });

  test('getblockstats: Core fields, the coinbase and peg txs left out of fees', () => {
    const { view } = setup();
    const s = view.blockStats(view.block(1)!);
    expect(s).toMatchObject({ txs: 2, ins: 2, outs: 3, totalfee: 100, total_out: 5900, total_size: 150, subsidy: 0, minfee: 100, maxfee: 100 });
    expect(s.feerate_percentiles).toHaveLength(5);
    expect(view.blockStats(view.block(2)!)).toMatchObject({ txs: 2, ins: 1, totalfee: 0, total_size: 0 });
  });
});

describe('L2 Core view: what the chain state moves (Truthcoin, stateUtxos)', () => {
  function stateSetup(): { index: L2Index; view: CoreView } {
    const index = new L2Index({ ...(thunder.l2 as L2Chain), stateUtxos: true });
    (index as any).stateOutputs = new Map([['m:abc:1:0', {
      outpoint: { MarketFunds: { market_id: 'abc', block_height: 1, is_fee: false } }, output: { address: C, content: value(700), memo: null }, height: 2,
    }]]);
    (index as any).stateSpent = new Map([[`r:${T1}:0`, 2]]);
    index.loadBlocks(chain());
    return { index, view: new CoreView(index) };
  }

  test('a state tx after the peg txs: the outputs the state consumed in, those it made out', () => {
    const { view } = stateSetup();
    const j = view.blockJson(view.block(2)!, 3);
    expect(j.tx.map((t: any) => t.peg ?? null)).toEqual([null, 'withdrawal', 'state']);
    const st = j.tx[2];
    expect(st.vin).toHaveLength(1);
    expect(st.vin[0]).toMatchObject({ txid: T1, vout: 0, prevout: { value: 0.000055, scriptPubKey: { address: C } } });
    expect(st.vout).toEqual([expect.objectContaining({ value: 0.000007, n: 0, scriptPubKey: expect.objectContaining({ address: C }) })]);
    expect(st.fee).toBe(0);
    expect(view.output(st.txid, 0)?.out.value).toBe(700);
  });

  test('blocks above the height list_utxos was followed at are not shown', () => {
    const { index, view } = stateSetup();
    (index as any).settled = 1;
    expect(view.tipHeight()).toBe(1);
    expect(view.block(2)).toBeNull();
    expect(view.heightOf(h('4'))).toBeNull();
    expect(view.tx(M)).toBeNull();
    expect(view.headerJson(view.block(1)!).nextblockhash).toBeUndefined();
    expect(view.spender(view.output(T1, 1)!.ref)).toBeNull(); // its bundle is in block 2
  });
});

describe('L2 Core facade (JSON-RPC methods)', () => {
  test('chain info and block lookups', async () => {
    const { facade } = setup();
    expect(await facade.call('getblockcount', [])).toBe(2);
    expect(await facade.call('getbestblockhash', [])).toBe(h('4'));
    expect(await facade.call('getblockhash', [1])).toBe(h('3'));
    expect(await facade.call('getblockchaininfo', [])).toMatchObject({
      chain: 'main', blocks: 2, headers: 2, bestblockhash: h('4'), verificationprogress: 1, initialblockdownload: false, pruned: false, time: 1200,
    });
    expect(await facade.call('getblockheader', [h('3'), false])).toBe(header(h('2'), h('6'), 1000));
    expect((await facade.call('getblock', [h('3')])).tx).toEqual([CB1, T1]);
    expect((await facade.call('getblock', [h('3'), true])).tx).toEqual([CB1, T1]);
    expect(await facade.call('getchaintips', [])).toEqual([{ height: 2, hash: h('4'), branchlen: 0, status: 'active' }]);
  });

  test('getrawtransaction: hex, verbose 1 (no prevouts), 2 (fee, prevouts), the block, synthetic txs', async () => {
    const { facade, view } = setup();
    expect(await facade.call('getrawtransaction', [T1])).toBe(view.block(1)!.txs[1].hex);
    const v1 = await facade.call('getrawtransaction', [T1, true]);
    expect(v1).toMatchObject({ txid: T1, blockhash: h('3'), confirmations: 2, blocktime: 1000, height: 1 });
    expect(v1.fee).toBeUndefined();
    expect(v1.vin[0].prevout).toBeUndefined();
    const v2 = await facade.call('getrawtransaction', [T1, 2]);
    expect(v2.vin[1].prevout.scriptPubKey.address).toBe(B);
    expect(v2.fee).toBeCloseTo(0.000001, 10);
    expect((await facade.call('getrawtransaction', [D, 1])).peg).toBe('deposit');
    expect((await facade.call('getrawtransaction', [M, 1, h('4')])).in_active_chain).toBe(true);
  });

  test('outputs: gettxout (unspent only) and gettxspendingprevout (the tx, the bundle)', async () => {
    const { facade } = setup();
    expect(await facade.call('gettxout', [T1, 0])).toMatchObject({ bestblock: h('4'), confirmations: 2, value: 0.000055, coinbase: false });
    expect(await facade.call('gettxout', [T1, 1])).toBeNull();
    expect(await facade.call('gettxout', [CB0, 0])).toBeNull();
    expect(await facade.call('gettxspendingprevout', [[{ txid: CB0, vout: 0 }, { txid: T1, vout: 1 }, { txid: T1, vout: 0 }, { txid: D, vout: 1 }]]))
      .toEqual([
        { txid: CB0, vout: 0, spendingtxid: T1, blockhash: h('3') },
        { txid: T1, vout: 1, spendingtxid: M, blockhash: h('4') },
        { txid: T1, vout: 0 },
        { txid: D, vout: 1, spendingtxid: T1, blockhash: h('3') },
      ]);
    expect(await facade.call('gettxoutsetinfo', [])).toMatchObject({ txouts: 2, total_amount: 0.000056 });
  });

  test('neutral mining figures, address validation, decoding', async () => {
    const { facade, view } = setup();
    expect(await facade.call('getmininginfo', [])).toMatchObject({ blocks: 2, difficulty: 1, networkhashps: 0 });
    expect(await facade.call('getnetworkhashps', [120, 2])).toBe(0);
    expect(await facade.call('estimatesmartfee', [2])).toEqual({ feerate: 0.00001, blocks: 2 });
    expect(await facade.call('validateaddress', [C])).toMatchObject({ isvalid: true, scriptPubKey: scriptOf(C).hex });
    expect((await facade.call('validateaddress', ['nope'])).isvalid).toBe(false);
    const d = await facade.call('decoderawtransaction', [view.block(1)!.txs[1].hex]);
    expect(d.vout.map((o: any) => o.scriptPubKey.address)).toEqual([C, W]);
    expect(d.vin[1]).toMatchObject({ txid: D, vout: 1 });
    expect(await facade.call('getindexinfo', [])).toMatchObject({ txindex: { synced: true, best_block_height: 2 }, txospenderindex: { synced: true } });
  });

  test('Core errors: unknown tx (-5), height out of range (-8), bad hash (-8), unknown method (-32601), warm-up (-28)', async () => {
    const { facade } = setup();
    const code = async (m: string, p: any[]) => facade.call(m, p).then(() => 0, (e: RpcError) => e.code);
    expect(await code('getrawtransaction', [h('0')])).toBe(-5);
    expect(await code('getblock', [h('0')])).toBe(-5);
    expect(await code('getblockhash', [3])).toBe(-8);
    expect(await code('getblock', ['xyz'])).toBe(-8);
    expect(await code('signrawtransactionwithwallet', ['00'])).toBe(-32601);
    const empty = new CoreFacade(new L2Index(thunder.l2 as L2Chain), { call: async () => [] as any });
    expect(await empty.call('getblockcount', []).catch((e: RpcError) => e.code)).toBe(-28);
  });

  test('the mempool from list_mempool: inputs against the index and other mempool txs, fees, entries', async () => {
    // Thunder as if it listed its mempool (inputs are [outpoint, utxo hash] pairs)
    const { facade, node } = setup({ ...(thunder.l2 as L2Chain), mempool: true });
    const X = h('6');
    node.mockImplementation(async (method: string) => method === 'list_mempool' ? [
      { txid: X, size: 120, tx: { inputs: [[{ Regular: { txid: T1, vout: 0 } }, h('0')]], outputs: [{ address: A, content: value(5000), memo: '' }] } },
      { txid: h('7'), size: 100, tx: { inputs: [[{ Regular: { txid: X, vout: 0 } }, h('0')]], outputs: [{ address: B, content: value(4900), memo: '' }] } },
    ] : []);
    expect(await facade.call('getrawmempool', [])).toEqual([X, h('7')]);
    const pool = await facade.call('getrawmempool', [true]);
    expect(pool[X]).toMatchObject({ vsize: 120, weight: 480, fees: { base: 0.000005 }, spentby: [h('7')], depends: [] });
    expect(pool[h('7')]).toMatchObject({ fees: { base: 0.000001 }, depends: [X] });
    const t = await facade.call('getrawtransaction', [h('7'), 2]);
    expect(t.vin[0].prevout).toMatchObject({ value: 0.00005, scriptPubKey: { address: A } });
    expect(t.confirmations).toBeUndefined();
    expect(await facade.call('gettxout', [T1, 0])).toBeNull(); // spent in the mempool
    expect(await facade.call('gettxout', [T1, 0, false])).not.toBeNull();
    expect(await facade.call('getmempoolinfo', [])).toMatchObject({ loaded: true, size: 2, bytes: 220 });
    expect((await facade.call('gettxspendingprevout', [[{ txid: X, vout: 0 }]]))[0].spendingtxid).toBe(h('7'));
  });
});
