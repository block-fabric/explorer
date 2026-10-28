import * as http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import axios from 'axios';
import config from '../../../config';
import { ArgsError, logoMime, marketPath, marketQuery } from '../../../chain/modules/flush/allowlist';
import { BoundedCache } from '../../../chain/modules/flush/cache';

// The Flush explorer (chains/FLUSH-API.md): the public DEX API's allowlist, the query check, the bounded cache, and the
// proxy end to end against a stand-in for the API (its routes as backbone-flush src/publicapi/rest.cpp has them).

const ID = 'd105afe28f328260cf6397b5dbb38bfa7a15a74c721533ed9b2c39f13094dfad';
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(24, 1)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(24, 2)]);

describe('Flush: the public API allowlist', () => {
  test('the reads the live API serves (photon-slot) and the asset registry (assets-unified)', () => {
    for (const p of [
      'status', 'stats', 'fees', 'treasury', 'launches', 'launches/stats', 'launches/log', 'launches/MOON', `launches/${ID}`,
      'launches/MOON/trades', 'launches/MOON/candles', 'launches/MOON/holders', 'pools', `pools/${ID}`, 'pools/MOON/ECX',
      `pools/${ID}/trades`, `pools/${ID}/candles`, `pools/${ID}/ticks`, `positions/${ID}`, 'books/USDX', 'books/USDX/ECX',
      'tickers/MOON', 'addresses/rsc1qkkt5556w3eduf6a53krg6ytth7cmlgyg0fj5fg/holdings', 'verifications',
      'assets', 'assets/MOON', `assets/${ID}`,
      `trades/${ID}`, 'addresses/rsc1qkkt5556w3eduf6a53krg6ytth7cmlgyg0fj5fg/trades',
    ]) {
      expect([p, marketPath(p)]).toEqual([p, 'json']);
    }
    expect(marketPath('launches/MOON/logo')).toBe('logo');
    expect(marketPath(`assets/${ID}/logo`)).toBe('logo');
  });

  test('no quote, build or broadcast, nothing else', () => {
    for (const p of [
      'launches/MOON/quote', 'quote/swap', 'quote/deposit', 'quote/withdraw', 'quote/position', 'build/buy', 'build/launch',
      'broadcast', '', 'status/', '/status', 'launches/stats/trades', 'launches/../build/buy', 'launches//MOON',
      'pools/x/y/z', `positions/${ID.toUpperCase()}`, 'positions/abc', 'launches/MO%4fN', 'launches/MOON;x', 'nope',
      'addresses/a b/holdings', 'flush.dex.v1.DexService/GetLaunch', 'x'.repeat(301), 'launches/' + 'A'.repeat(65),
    ]) {
      expect([p, marketPath(p)]).toEqual([p, null]);
    }
    expect(marketPath(undefined as any)).toBeNull();
  });

  test('query parameters: the reads\' own, each once, printable; in a canonical order', () => {
    expect(marketQuery({})).toBe('');
    expect(marketQuery({ limit: '5', filter: 'all' })).toBe('filter=all&limit=5');
    expect(marketQuery({ q: 'a b&c=d' })).toBe('q=a%20b%26c%3Dd');
    expect(marketQuery({ assets: 'MOON,USDX', curators: ID })).toBe(`assets=MOON%2CUSDX&curators=${ID}`);
    expect(() => marketQuery({ evil: '1' })).toThrow(ArgsError);
    expect(() => marketQuery({ limit: ['1', '2'] })).toThrow(ArgsError);
    expect(() => marketQuery({ q: 'x'.repeat(201) })).toThrow(ArgsError);
    expect(() => marketQuery({ q: 'a\nb' })).toThrow(ArgsError);
    expect(() => marketQuery({ side: 'buy' })).toThrow(ArgsError); // a quote's
    expect(() => marketQuery(Object.fromEntries('abcdefghijk'.split('').map(k => [k, '1'])))).toThrow(ArgsError);
  });

  test('logos: PNG or JPEG by type and magic', () => {
    expect(logoMime('image/png', PNG)).toBe('image/png');
    expect(logoMime('image/jpeg', JPEG)).toBe('image/jpeg');
    expect(logoMime('image/png', JPEG)).toBeNull();
    expect(logoMime('image/svg+xml', Buffer.from('<svg/>'))).toBeNull();
    expect(logoMime('text/html', PNG)).toBeNull();
    expect(logoMime('image/png', Buffer.alloc(0))).toBeNull();
  });
});

describe('Flush: the bounded cache', () => {
  test('entries: the oldest go first', () => {
    const c = new BoundedCache<string>(3, 1000, 100);
    for (const k of ['a', 'b', 'c', 'd']) {
      c.set(k, k);
    }
    expect(c.size).toBe(3);
    expect(c.get('a', 1e9)).toBeUndefined();
    expect(c.get('d', 1e9)).toBe('d');
  });

  test('bytes: in all and per entry', () => {
    const c = new BoundedCache<string>(100, 10, 6);
    c.set('a', '1234');
    c.set('b', '1234');
    c.set('c', '1234');
    expect(c.totalBytes).toBeLessThanOrEqual(10);
    expect(c.get('a', 1e9)).toBeUndefined();
    c.set('big', '1234567');
    expect(c.get('big', 1e9)).toBeUndefined();
    c.set('b', 'xx'); // replaced, counted once
    expect(c.totalBytes).toBe(6);
  });

  test('time to live', () => {
    const c = new BoundedCache<string>(10, 100, 100);
    c.set('a', 'x');
    expect(c.get('a', 1e9)).toBe('x');
    expect(c.get('a', -1)).toBeUndefined();
  });
});

describe('Flush: the proxy against a stand-in API', () => {
  let api: http.Server;
  let app: http.Server;
  let base = '';
  const seen: { url: string; host: string }[] = [];
  let cfg: typeof config; // the config of the modules loaded for this explorer (below)

  beforeAll(async () => {
    api = http.createServer((req, res) => {
      seen.push({ url: req.url ?? '', host: req.headers.host ?? '' });
      const url = req.url ?? '';
      if (url.startsWith('/api/v1/status')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"network":"ecashbeta", "flush":{"height":2726}}');
      } else if (url.startsWith('/api/v1/launches/MOON/logo')) {
        res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
      } else if (url.startsWith('/api/v1/assets/FAKE/logo')) {
        res.writeHead(200, { 'Content-Type': 'image/png' }).end('<script>alert(1)</script>');
      } else if (url.startsWith('/api/v1/assets/BIG/logo')) {
        res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.concat([PNG, Buffer.alloc(70000)]));
      } else if (url.startsWith('/api/v1/stats')) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>not json</html>');
      } else if (url.startsWith('/api/v1/fees')) {
        res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"error":{"code":"resource_exhausted"}}');
      } else if (url.startsWith('/api/v1/treasury')) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":{"message":"secret internals"}}');
      } else if (url.startsWith('/api/v1/verifications')) {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":{"message":"assets: 1 to 50"}}');
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":{"code":"not_found"}}');
      }
    });
    await new Promise<void>(r => api.listen(0, '127.0.0.1', () => r()));
    // the routes of an explorer whose profile is Flush (the profile is resolved when chain/profile is first loaded)
    jest.resetModules();
    cfg = require('../../../config').default;
    cfg.CHAIN.PROFILE = 'flush';
    cfg.CHAIN.FLUSH = { SLOT: 99, PUBLIC_API: `http://127.0.0.1:${(api.address() as AddressInfo).port}/`, PUBLIC_API_HOST: 'flush.markets', PUBLIC_API_TIMEOUT: 5000 };
    const flushRoutes = require('../../../chain/modules/flush/routes').default;
    const e = express();
    flushRoutes.initRoutes(e);
    app = http.createServer(e);
    await new Promise<void>(r => app.listen(0, '127.0.0.1', () => r()));
    base = `http://127.0.0.1:${(app.address() as AddressInfo).port}${config.MEMPOOL.API_URL_PREFIX}`;
  });

  afterAll(async () => {
    await new Promise(r => app.close(r));
    await new Promise(r => api.close(r));
  });

  const get = (path: string) => axios.get(base + path, { validateStatus: () => true, responseType: 'arraybuffer' });
  const json = (r: any) => JSON.parse(Buffer.from(r.data).toString('utf8'));

  test('/chain: kind flush, its slot, the market feature', async () => {
    const r = await get('chain');
    expect(r.status).toBe(200);
    const c = json(r);
    expect(c).toMatchObject({ id: 'flush', kind: 'flush', name: 'Flush', unit: 'ECX', mainchain: false });
    expect(c.features).toEqual(['assets', 'dex', 'launches', 'stake', 'peg', 'market']);
    expect(c.rpcMethods).toContain('getlaunch');
    expect(c.slot).toBe(99);
  });

  test('a read: the API\'s JSON, with the Host name it accepts; cached', async () => {
    const before = seen.length;
    const r = await get('flush/market/status');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^application\/json/);
    expect(json(r)).toEqual({ network: 'ecashbeta', flush: { height: 2726 } });
    expect(seen[seen.length - 1]).toEqual({ url: '/api/v1/status', host: 'flush.markets' });
    await Promise.all([get('flush/market/status'), get('flush/market/status')]);
    expect(seen.length).toBe(before + 1);
  });

  test('the query goes on in a canonical order; others are refused before the API', async () => {
    await get('flush/market/launches?limit=5&filter=all');
    expect(seen[seen.length - 1].url).toBe('/api/v1/launches?filter=all&limit=5');
    const before = seen.length;
    expect((await get('flush/market/launches?evil=1')).status).toBe(400);
    expect((await get('flush/market/build/buy')).status).toBe(404);
    expect((await get('flush/market/launches/MOON/quote?side=buy')).status).toBe(404);
    expect((await get('flush/market/quote/swap')).status).toBe(404);
    expect(seen.length).toBe(before);
  });

  test('the API\'s errors: 404 and 400 as such, the rest 503 (Cloudflare replaces a 502\'s body), its text never', async () => {
    const nf = await get('flush/market/launches/NOPE');
    expect([nf.status, json(nf)]).toEqual([404, { error: 'Not found' }]);
    const bad = await get('flush/market/verifications');
    expect([bad.status, json(bad)]).toEqual([400, { error: 'Invalid request' }]);
    const down = await get('flush/market/treasury');
    expect(down.status).toBe(503);
    expect(Buffer.from(down.data).toString()).not.toMatch(/secret/);
    expect((await get('flush/market/fees')).status).toBe(503);
    const html = await get('flush/market/stats');
    expect(html.status).toBe(503);
    expect(Buffer.from(html.data).toString()).not.toMatch(/html/);
  });

  test('logos: PNG or JPEG only, at most 64 KB, nosniff', async () => {
    const r = await get('flush/market/launches/MOON/logo');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(r.data).equals(PNG)).toBe(true);
    expect((await get('flush/market/assets/FAKE/logo')).status).toBe(503);
    expect((await get('flush/market/assets/BIG/logo')).status).toBe(503);
  });

  test('no API configured: 404', async () => {
    const api0 = cfg.CHAIN.FLUSH.PUBLIC_API;
    cfg.CHAIN.FLUSH.PUBLIC_API = '';
    try {
      expect((await get('flush/market/pools')).status).toBe(404);
    } finally {
      cfg.CHAIN.FLUSH.PUBLIC_API = api0;
    }
  });
});
