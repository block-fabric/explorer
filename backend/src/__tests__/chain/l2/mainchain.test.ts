import axios from 'axios';
import config from '../../../config';
import { Mainchain } from '../../../chain/l2/mainchain';

// The eCash explorer's GET drivechain/events/:kind?slot=&before=&limit= (drivechain.ts getEvents), over a list of
// events held here: newest first, `before` exclusive, at most `limit` items (a page can end inside a block).
jest.mock('axios');
const mockedGet = axios.get as jest.Mock;

let store: Record<string, any[]> = {};
let fail = false;

function serve(url: string): any {
  if (fail) {
    return { status: 500, data: { error: 'enforcer at 10.0.0.5:8123 refused' } };
  }
  const u = new URL(url);
  const kind = u.pathname.split('/').pop() as string;
  const slot = Number(u.searchParams.get('slot'));
  const before = u.searchParams.has('before') ? Number(u.searchParams.get('before')) : Infinity;
  const limit = Number(u.searchParams.get('limit') ?? 50);
  const items = (store[kind] ?? []).filter(e => e.slot === slot && e.height < before).sort((a, b) => b.height - a.height);
  return { status: 200, data: items.slice(0, limit) };
}

const hex = (n: number, salt: string): string => (salt + n.toString(16)).padStart(64, '0');
const rev = (h: string): string => Buffer.from(h, 'hex').reverse().toString('hex');

beforeEach(() => {
  config.CHAIN.MAINCHAIN_API = 'http://127.0.0.1:1';
  store = {};
  fail = false;
  mockedGet.mockReset();
  mockedGet.mockImplementation(async (url: string) => serve(url));
});

afterAll(() => {
  config.CHAIN.MAINCHAIN_API = '';
});

/** heights 1000..1000+n-1 each carry a sidechain block of slot 9; every 7th height has a second, losing request */
function chain(n: number, from = 1000): void {
  store.bmm = [];
  store['bmm-requests'] = [];
  for (let i = 0; i < n; i++) {
    const h = from + i;
    const side = hex(h, 'a');
    store.bmm.push({ height: h, blockHash: hex(h, 'b'), time: 1e9 + h, slot: 9, name: 'Thunder', sideBlock: rev(side), requestTxid: hex(h, 'c'), bid: 100 + i });
    store['bmm-requests'].push({ height: h, blockHash: hex(h, 'b'), time: 1e9 + h, slot: 9, sideBlock: rev(side), txid: hex(h, 'c'), bid: 100 + i, accepted: true });
    if (h % 7 === 0) {
      store['bmm-requests'].push({ height: h, blockHash: hex(h, 'b'), time: 1e9 + h, slot: 9, sideBlock: rev(hex(h, 'f')), txid: hex(h, 'd'), bid: 50, accepted: false });
    }
    // another slot's BMM in the same block
    store.bmm.push({ height: h, blockHash: hex(h, 'b'), time: 1e9 + h, slot: 2, name: 'BitNames', sideBlock: hex(h, 'e'), bid: 1 });
  }
}

describe('BMM of a sidechain, from the eCash explorer', () => {
  it('joins by the sidechain block hash, the eCash index\'s sideBlock reversed (live betanet pair)', async () => {
    store.bmm = [{ height: 973926, blockHash: '000000000000000038c24f5326c201ee580474179eb314aa69fbcf30a9f317ca', time: 1792698646, slot: 9,
      name: 'Thunder', sideBlock: 'f3b502cd78b8b5738e77965d130d29e8614968055c363edecd764c7db19331b6',
      requestTxid: '003b67876db18831481e0c1bcae3bc7652126a694af386dba5b52db50495227b', bid: 564 }];
    store['bmm-requests'] = [{ height: 973926, blockHash: '000000000000000038c24f5326c201ee580474179eb314aa69fbcf30a9f317ca', time: 1792698646, slot: 9,
      sideBlock: 'f3b502cd78b8b5738e77965d130d29e8614968055c363edecd764c7db19331b6', txid: '003b67876db18831481e0c1bcae3bc7652126a694af386dba5b52db50495227b', bid: 564, accepted: true }];
    const m = new Mainchain();
    (m as any).slot = 9;
    await m.sync();
    // Thunder betanet block 2283 (get_best_sidechain_block_hash)
    expect(m.blockBmm('b63193b17d4c76cdde3e365c05684961e8290d135d96778e73b5b878cd02b5f3')).toEqual({
      mainHeight: 973926, mainHash: '000000000000000038c24f5326c201ee580474179eb314aa69fbcf30a9f317ca', bid: 564,
      requestTxid: '003b67876db18831481e0c1bcae3bc7652126a694af386dba5b52db50495227b', requests: 1, contested: false,
    });
    expect(m.blockBmm('f3b502cd78b8b5738e77965d130d29e8614968055c363edecd764c7db19331b6')).toBeNull();
  });

  it('reads every page, a block split across pages included, and counts the requests per eCash block', async () => {
    chain(1300);
    const m = new Mainchain();
    (m as any).slot = 9;
    await m.sync();
    for (let h = 1000; h < 2300; h++) {
      const b = m.blockBmm(hex(h, 'a'));
      expect(b?.mainHeight).toBe(h);
      expect(b?.bid).toBe(100 + h - 1000);
      expect(b?.requests).toBe(h % 7 === 0 ? 2 : 1);
      expect(b?.contested).toBe(h % 7 === 0);
    }
    expect(m.requestsIn(1001).map(r => r.accepted)).toEqual([true, false]);
    expect(m.requestsIn(1002).length).toBe(1);
    expect(m.acceptsBetween(2200, 2299)).toBe(100);
    expect(m.blockBmm(hex(1000, 'e'))).toBeNull(); // the other slot's
  });

  it('follows new blocks and replaces the newest heights after an eCash reorg', async () => {
    chain(600);
    const m = new Mainchain();
    (m as any).slot = 9;
    await m.sync();
    const calls = mockedGet.mock.calls.length;
    // a reorg of the top 3 eCash blocks: 1597..1599 now carry other sidechain blocks; then 10 new blocks
    chain(610);
    for (const kind of ['bmm', 'bmm-requests']) {
      for (const e of store[kind].filter(x => x.slot === 9 && x.height >= 1597 && x.height <= 1599)) {
        e.sideBlock = rev(hex(e.height, '9'));
      }
    }
    await m.sync();
    expect(mockedGet.mock.calls.length - calls).toBe(2); // one page of each kind
    expect(m.blockBmm(hex(1597, 'a'))).toBeNull();
    expect(m.blockBmm(hex(1597, '9'))?.mainHeight).toBe(1597);
    expect(m.blockBmm(hex(1609, 'a'))?.mainHeight).toBe(1609);
    expect(m.blockBmm(hex(1596, 'a'))?.mainHeight).toBe(1596);
  });

  it('keeps the eCash explorer\'s error text out of its errors', async () => {
    fail = true;
    const m = new Mainchain();
    (m as any).slot = 9;
    await expect(m.sync()).rejects.toThrow('eCash explorer API drivechain/events/bmm: HTTP 500');
    await expect(m.get('drivechain/cockpit')).rejects.not.toThrow(/10\.0\.0\.5/);
  });

  it('caches GETs, at most 1000 of them', async () => {
    const m = new Mainchain();
    store.bmm = [];
    for (let i = 0; i < 1100; i++) {
      await m.get('drivechain/events/bmm', { slot: 9, before: i, limit: 1 }, 60000);
    }
    expect((m as any).cache.size).toBe(1000);
    const n = mockedGet.mock.calls.length;
    await m.get('drivechain/events/bmm', { slot: 9, before: 1099, limit: 1 }, 60000);
    expect(mockedGet.mock.calls.length).toBe(n);
  });
});
