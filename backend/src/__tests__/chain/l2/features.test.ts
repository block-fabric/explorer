import { candidateName, nameHash, IndexTx, IndexUtxo } from '../../../chain/modules/l2-views';
import { auctionCurve, buildView, poolId } from '../../../chain/modules/bitassets/views';
import { buildNames } from '../../../chain/modules/bitnames/routes';
import { buildMarkets } from '../../../chain/modules/truthcoin/routes';
import { buildShielded } from '../../../chain/modules/zside/routes';
import { buildRichlist } from '../../../chain/modules/thunder/routes';
import { buildSwaps, swapView } from '../../../chain/modules/coinshift/routes';
import { Content } from '../../../chain/l2/types';

// The sidechain modules' feature views (chains/L2-API.md "Chain features"), on small synthetic indexes.

const A = 'e6cc6c14a09d49287949b6cd48007caedb4d2cc232d18daf7fd89d3998483b61'; // blake3("ECX"), BitAssets betanet asset 0
const op = (txid: string, vout: number) => ({ kind: 'regular' as const, txid, vout, label: `${txid.slice(0, 8)}…:${vout}` });
const sats = (n: number): Content => ({ type: 'value', value: n, raw: { BitcoinSats: n } });
const asset = (id: string, n: number): Content => ({ type: 'bitasset', assetId: id, amount: n, raw: { BitAsset: [id, n] } });
const control = (id: string): Content => ({ type: 'bitassetControl', assetId: id, raw: { BitAssetControl: id } });
const lp = (a0: string, a1: string, n: number): Content => ({ type: 'ammLpToken', assetId: `${a0}:${a1}`, amount: n, raw: { AmmLpToken: { asset0: a0, asset1: a1, amount: n } } });
const valueOf = (c: Content) => c.type === 'value' ? c.value ?? 0 : 0;

let seq = 0;
function tx(height: number, inputs: [string, Content][], outputs: [string, Content][], data: any = null, txid?: string): IndexTx {
  const id = txid ?? (++seq).toString(16).padStart(64, '0');
  return {
    txid: id, height, time: 1790000000 + height, index: 0, fee: 0, shielded: null, signers: inputs.map(i => i[0]), data,
    inputs: inputs.map(([address, content], k) => ({ outpoint: op('ff'.repeat(32), k), address, content, value: valueOf(content) })),
    outputs: outputs.map(([address, content], vout) => ({ vout, address, content, value: valueOf(content), memo: null, spent: null })),
  };
}
const utxo = (address: string, content: Content, height = 1): IndexUtxo => ({ outpoint: op('ee'.repeat(32), 0), txid: null, height, address, content, value: valueOf(content) });

describe('name hashes', () => {
  test('a candidate shows only when it hashes to the id', () => {
    expect(nameHash('ECX')).toBe(A);
    expect(candidateName(A)).toBe('ECX');
    expect(candidateName('00'.repeat(32))).toBeNull();
  });
});

describe('BitAssets', () => {
  const a1 = '01' + A;
  const txs = [
    tx(10, [['alice', sats(1000)]], [['alice', asset(A, 1000)], ['alice', control(A)]],
      { type: 'BitAssetRegistration', name_hash: A, initial_supply: 1000 }),
    tx(11, [['alice', control(A)]], [['alice', control(A)], ['alice', asset(A, 500)]], { type: 'BitAssetMint', value: 500 }),
    // add liquidity: 100000 sats and 100 units for 100 LP tokens
    tx(12, [['alice', sats(100000)], ['alice', asset(A, 1000)]], [['alice', lp('00', a1, 100)], ['alice', asset(A, 900)]],
      { type: 'AmmMint', amount0: 100000, amount1: 100, lp_token_mint: 100 }),
    // swap 10 units for 9000 sats
    tx(13, [['bob', asset(A, 10)]], [['bob', sats(9000)]], { type: 'AmmSwap', amount_spent: 10, amount_receive: 9000, pair_asset: '00' }),
    // remove half the liquidity
    tx(14, [['alice', lp('00', a1, 50)]], [['alice', sats(45500)], ['alice', asset(A, 55)]],
      { type: 'AmmBurn', amount0: 45500, amount1: 55, lp_token_burn: 50 }),
    tx(15, [['alice', asset(A, 900)]], [['carol', asset(A, 300)], ['alice', asset(A, 600)]]),
  ];
  const v = buildView(txs, [utxo('alice', asset(A, 600)), utxo('carol', asset(A, 300)), utxo('alice', control(A)), utxo('bob', asset(A, 1))]);

  test('supply, holders, controller, registration and mints', () => {
    const s = v.assets.get(A)!;
    expect(s.supply).toBe(901);
    expect([...s.holders.entries()]).toEqual([['alice', 600], ['carol', 300], ['bob', 1]]);
    expect(s.controller).toBe('alice');
    expect(s.registration).toMatchObject({ height: 10, initialSupply: 1000 });
    expect(s.mints).toEqual([expect.objectContaining({ height: 11, amount: 500 })]);
    expect(s.activity.map(r => r.kind)).toEqual(['register', 'mint', 'liquidity-add', 'swap', 'liquidity-remove', 'transfer']);
    expect(s.activity[3]).toMatchObject({ amount: 10, counterAsset: '00', counterAmount: 9000 });
    expect(s.activity[5].outputs).toEqual([{ address: 'carol', amount: 300 }, { address: 'alice', amount: 600 }]);
  });

  test('the pool replayed: reserves, LP tokens and price after each event', () => {
    const p = v.pools.get(poolId('00', a1))!;
    expect(p.events.map(e => [e.kind, e.reserve0, e.reserve1, e.outstanding])).toEqual([
      ['mint', 100000, 100, 100], ['swap', 91000, 110, 100], ['burn', 45500, 55, 50],
    ]);
    expect(p.events[1].price).toBeCloseTo(91000 / 110);
    expect(p).toMatchObject({ swaps: 1, volume0: 9000, volume1: 10 });
  });

  test('Dutch auction price: linear fall, reset by a bid', () => {
    const state = {
      start_block: 100, duration: 11, initial_price: 1000, initial_end_price: 0, initial_base_amount: 50,
      most_recent_bid_block: [{ data: 100, height: 90, txid: 'c' }, { data: 105, height: 105, txid: 'b' }],
      price_after_most_recent_bid: [{ data: 1000, height: 90 }, { data: 300, height: 105 }],
      end_price_after_most_recent_bid: [{ data: 0, height: 90 }, { data: 0, height: 105 }],
      base_amount_remaining: [{ data: 50, height: 90 }, { data: 20, height: 105 }],
    };
    const c = auctionCurve(state, 108);
    expect(c).toMatchObject({ start: 100, end: 110, status: 'live', remaining: 20 });
    expect(c.curve).toEqual([[100, 1000], [105, 500], [105, 300], [110, 0]]);
    expect(c.current).toBe(300 - Math.floor(300 * 3 / 5));
    expect(auctionCurve(state, 99).status).toBe('upcoming');
    expect(auctionCurve(state, 111).status).toBe('ended');
  });
});

describe('BitNames', () => {
  test('reservation, registration, transfer and owner', () => {
    const name = nameHash('alice');
    const res = tx(1, [], [['r', { type: 'bitnameReservation', raw: 'BitNameReservation' }]], { type: 'BitNameReservation', commitment: 'cc' });
    const reg = tx(2, [['r', { type: 'bitnameReservation', raw: {} }]], [['owner1', { type: 'bitname', name, raw: { BitName: name } }]],
      { type: 'BitNameRegistration', name_hash: name });
    reg.inputs[0].outpoint = op(res.txid, 0);
    const move = tx(3, [['owner1', { type: 'bitname', name, raw: {} }]], [['owner2', { type: 'bitname', name, raw: {} }]]);
    const v = buildNames([res, reg, move], [utxo('owner2', { type: 'bitname', name, raw: {} })]);
    expect(v.events.get(name)!.map(e => [e.kind, e.height, e.address])).toEqual([
      ['reservation', 1, 'r'], ['registration', 2, 'owner1'], ['transfer', 3, 'owner2'],
    ]);
    expect(v.owners.get(name)).toBe('owner2');
    expect(v.reservations).toEqual({ total: 1, open: 0, registered: 1 });
  });

  test('a BatchIcann tx reveals its names', () => {
    const v = buildNames([tx(5, [], [], { type: 'BatchIcann', plain_names: ['example.com'] })], []);
    expect(v.revealed.get(nameHash('example.com'))).toBe('example.com');
  });
});

describe('Truthcoin', () => {
  test('trades by market, signed shares', () => {
    const v = buildMarkets([
      tx(1, [['t', sats(5000)]], [], { type: 'Trade', market_id: [2, 15, 20, 140, 175, 56], outcome_index: 1, shares: 100, trader: 't', limit_sats: 4000 }),
      tx(2, [], [], { type: 'Trade', market_id: [2, 15, 20, 140, 175, 56], outcome_index: 1, shares: -50, trader: 't', limit_sats: 10 }),
    ]);
    const t = v.trades.get('020f148caf38')!;
    expect(t.map(x => [x.shares, x.input])).toEqual([[100, 5000], [-50, 0]]);
  });
});

describe('zSide', () => {
  test('the pool over blocks', () => {
    const a = tx(5, [['x', sats(1000)]], []);
    a.shielded = { actions: 2, valueBalance: -900, flags: 3 };
    const b = tx(7, [], [['y', sats(300)]]);
    b.shielded = { actions: 2, valueBalance: 400, flags: 3 };
    const s = buildShielded([a, b]);
    expect(s).toMatchObject({ txs: 2, actions: 4, nullifiers: 4, shieldedIn: 900, shieldedOut: 400, pool: 500, blocks: 2 });
    expect(s.series.map((x: any) => x.pool)).toEqual([900, 500]);
    expect(s.recent.map((x: any) => x.kind)).toEqual(['unshield', 'shield']);
  });
});

describe('Thunder', () => {
  test('top addresses and payments', () => {
    const addrs = [
      { address: 'a', balance: 700, funded: { count: 1, sum: 700 }, spent: { count: 0, sum: 0 }, txs: 1, utxos: 1, first: 1, last: 1 },
      { address: 'b', balance: 300, funded: { count: 1, sum: 300 }, spent: { count: 0, sum: 0 }, txs: 1, utxos: 1, first: 2, last: 2 },
      { address: 'c', balance: 0, funded: { count: 1, sum: 5 }, spent: { count: 1, sum: 5 }, txs: 2, utxos: 0, first: 1, last: 2 },
    ];
    const r = buildRichlist(addrs, [tx(2, [['a', sats(1000)]], [['b', sats(300)], ['a', sats(690)]])], 9);
    expect(r.items.map((x: any) => [x.address, x.share])).toEqual([['a', 0.7], ['b', 0.3]]);
    expect(r).toMatchObject({ addresses: 3, funded: 2, total: 1000, payments: { count: 1, volume: 300 } });
    expect(r.series.length).toBe(10);
  });
});

describe('Coinshift', () => {
  test('swap ids and the L1 txid as hex, txs and held sats by swap', () => {
    const id = Array.from({ length: 32 }, (_, i) => i);
    const hexId = Buffer.from(id).toString('hex');
    expect(swapView({ id, l1_txid: { Hash32: new Array(32).fill(0) }, state: 'Pending' })).toEqual({ id: hexId, l1_txid: null, state: 'Pending' });
    expect(swapView({ id, l1_txid: { Hash32: id } }).l1_txid).toBe(hexId);
    const v = buildSwaps([tx(1, [], [], { type: 'SwapCreate', swap_id: hexId })],
      [utxo('x', { type: 'swapPending', value: 10000, swapId: hexId, raw: {} })]);
    expect(v.txs.get(hexId)!.map(t => t.kind)).toEqual(['create']);
    expect(v.locked.get(hexId)).toEqual({ amount: 0, outputs: 1 });
  });
});
