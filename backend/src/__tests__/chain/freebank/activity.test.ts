import { BLOCK_HEADER_BYTES, FreebankParseError, parseBlock } from '../../../chain/modules/freebank/parser';
import { ActivityItem, FreebankActivity, blockItems } from '../../../chain/modules/freebank/activity';

// FreeBank's credit history (activity.ts): a block read from its raw hex, its credit items, and the index's queries.
// Blocks are built from the parser's fixtures (mbdrivechains/freebank-explorer @ e3ad60793, AGPL-3.0).

const fixtures = require('./test-data/txs.json');
const credit: { txid: string; family: string; op_name: string; decoded: Record<string, unknown>; hex: string }[] = fixtures.credit;
const other: { txid: string; hex: string }[] = fixtures.other;

const compact = (n: number): string => n < 0xfd ? n.toString(16).padStart(2, '0')
  : 'fd' + Buffer.from([n & 0xff, n >> 8]).toString('hex');

/** A block of these txs: the 136-byte header (prev 11..11 as Core prints it, time 1700000000) then the txs */
function blockHex(txHexes: string[]): string {
  const header = Buffer.alloc(BLOCK_HEADER_BYTES);
  header.writeInt32LE(0x20000000, 0);
  Buffer.alloc(32, 0x11).copy(header, 4);
  header.writeUInt32LE(1700000000, 68);
  return header.toString('hex') + compact(txHexes.length) + txHexes.join('');
}

describe('FreeBank activity: a block from its raw hex', () => {
  const txs = [...other, ...credit];
  const hex = blockHex(txs.map(t => t.hex));

  test('every transaction, in order, with its txid; the parent and the time', () => {
    const b = parseBlock(hex);
    expect(b.prev).toBe('11'.repeat(32));
    expect(b.time).toBe(1700000000);
    expect(b.txs.map(t => t.txid)).toEqual(txs.map(t => t.txid));
  });

  test('a truncated block or trailing bytes do not read', () => {
    expect(() => parseBlock(hex.slice(0, -2))).toThrow(FreebankParseError);
    expect(() => parseBlock(hex + '00')).toThrow(FreebankParseError);
  });

  test('the credit transactions become items, decoded as the parser does, with their place in the block', () => {
    const items = blockItems(7, 1700000000, parseBlock(hex).txs);
    const creditItems = items.filter(i => i.family !== 'asset');
    expect(creditItems.map(i => i.txid)).toEqual(credit.map(t => t.txid));
    creditItems.forEach((it, n) => {
      expect(it).toMatchObject({ height: 7, time: 1700000000, index: other.length + n, family: credit[n].family, opName: credit[n].op_name });
      expect(it.fields).toEqual(credit[n].decoded);
    });
  });
});

describe('FreeBank activity: queries', () => {
  const item = (height: number, index: number, family: ActivityItem['family'], fields: Record<string, any>): ActivityItem =>
    ({ txid: `${height}-${index}`, height, time: 0, index, family, op: 1, opName: 'x', fields, error: null });
  const idx = new FreebankActivity() as any;
  idx.blocks = new Map([
    [10, { height: 10, hash: 'a', prev: '', items: [item(10, 1, 'house', { house_id: 1 }), item(10, 5, 'bill', { bill_id: 3 })] }],
    [11, { height: 11, hash: 'b', prev: 'a', items: [] }],
    [12, { height: 12, hash: 'c', prev: 'b', items: [
      item(12, 2, 'settle', { house_ids: [1, 2] }), item(12, 3, 'note', { house_id: 2 }), item(12, 4, 'settle', { house_a_id: 2, house_b_id: 1 }),
    ] }],
  ]);
  idx.low = 10;
  idx.high = 12;
  const ids = (r: { items: ActivityItem[] }): string[] => r.items.map(i => i.txid);

  test('newest first, paged by cursor', () => {
    const p1 = idx.query({ limit: 2 });
    expect(ids(p1)).toEqual(['12-4', '12-3']);
    expect(p1.next).toBe('12:3');
    const p2 = idx.query({ limit: 2, before: { height: 12, index: 3 } });
    expect(ids(p2)).toEqual(['12-2', '10-5']);
    const p3 = idx.query({ limit: 2, before: { height: 10, index: 5 } });
    expect(ids(p3)).toEqual(['10-1']);
    expect(p3.next).toBeNull();
  });

  test('by family, by house (its own ops, settlements it is in), by bill', () => {
    expect(ids(idx.query({ limit: 50, family: 'settle' }))).toEqual(['12-4', '12-2']);
    expect(ids(idx.query({ limit: 50, house: 1 }))).toEqual(['12-4', '12-2', '10-1']);
    expect(ids(idx.query({ limit: 50, house: 2 }))).toEqual(['12-4', '12-3', '12-2']);
    expect(ids(idx.query({ limit: 50, bill: 3 }))).toEqual(['10-5']);
  });
});
