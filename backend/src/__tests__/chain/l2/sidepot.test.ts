import bs58 from 'bs58';
import { L2Index, StoredBlock } from '../../../chain/l2/index';
import sidepot from '../../../chain/modules/sidepot';
import { L2Chain } from '../../../chain/l2/types';

// Sidepot 0.2.0's GameDeposit output (eCash block 985,824 on): a tx moves a coin into a game account. The node's UTXO
// set never holds it and the outputs after it keep their index (sidepot-node lib/state/block.rs): the index makes it
// no coin at any address, and lists it with the peg's spot:<account> deposits.

const chain = sidepot.l2 as L2Chain;
const h = (c: string) => c.repeat(64);
const addr = (n: number) => bs58.encode(Buffer.alloc(20, n));
const P = addr(1);
const K = 'dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8';
const FUND = h('1');

function blocks(): StoredBlock[] {
  const base = { prevMainHash: h('0'), prevMainHeight: 0, deposits: [], bundleSpends: [], events: [], coinbase: { txid: h('c'), outputs: [] } };
  return [
    {
      ...base, height: 0, hash: h('a'), prevHash: null, merkleRoot: h('5'), main: { hash: h('7'), height: 985800, time: 1000 }, txs: [],
      deposits: [{ outpoint: { Deposit: `${h('d')}:1` }, output: { address: P, content: { Value: 10000000 }, memo: null } }],
      gameDeposits: [{ txid: h('e'), vout: 0, amount: 500000, account: K, mainHeight: 985800 }],
    },
    {
      ...base, height: 1, hash: h('b'), prevHash: h('a'), merkleRoot: h('6'), main: { hash: h('8'), height: 985830, time: 1100 },
      txs: [{
        txid: FUND, size: 120, inputs: [{ Deposit: `${h('d')}:1` }], signers: [P], shielded: null, data: null,
        outputs: [
          { address: addr(9), content: { GameDeposit: { value: 3000000, account: K.toUpperCase() } }, memo: null },
          { address: P, content: { Value: 6999000 }, memo: null },
        ],
      }],
    },
  ];
}

describe('Sidepot game deposits in the index', () => {
  const index = new L2Index(chain);
  index.loadBlocks(blocks());

  test('the GameDeposit output: shown, credited to the game, no coin', () => {
    const t = index.tx(FUND);
    expect(t.fee).toBe(1000);
    expect(t.outputs[0]).toMatchObject({ vout: 0, value: 3000000, content: { type: 'gameDeposit', account: K }, spent: { kind: 'state' } });
    expect(t.outputs[1]).toMatchObject({ vout: 1, value: 6999000, spent: null });
  });

  test('no address holds it', () => {
    expect(index.address(P, null, 10)).toMatchObject({ balance: 6999000 });
    expect(index.address(addr(9), null, 10)).toBeNull(); // (the output's address field holds nothing)
    const utxos: string[] = [];
    index.forEachUtxo(u => utxos.push(`${u.txid}:${u.outpoint.vout}`));
    expect(utxos).toEqual([`${FUND}:1`]);
  });

  test('listed with the peg\'s deposits to game accounts', () => {
    const all: any[] = [];
    index.forEachGameDeposit(d => all.push(d));
    expect(all.map(d => [d.source, d.amount, d.account, d.height, d.vout])).toEqual([['peg', 500000, K, 0, 0], ['tx', 3000000, K, 1, 0]]);
  });
});
