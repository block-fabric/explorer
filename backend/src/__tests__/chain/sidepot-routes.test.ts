// Sidepot's wallet reads (feature/game/state, feature/game/account/:key): sidepot.cash's shapes, and a 503 rather
// than an old answer when the node does not answer in time
const P = 'dd308afec5777e13121fa72b9cc1b7cc0139715309b086c960e18fd969774eb8';
const STATE = { l1_height: 985000, clock: 30, round: 1, deadline: 160, price_sats: 1104622, pot_sats: 812000000, bonus_pool_sats: 120000000,
  accounts: 3, streak: null, start_height: 984960, preview: { l1_height: 985002, clock: 32, round: 1, deadline: 162 } };

function setup(rpc: (method: string, ...params: unknown[]) => Promise<any>) {
  jest.resetModules();
  const { featureRoutes } = require('../../chain/modules/sidepot/routes');
  const routes = new Map<string, (req: any, res: any) => Promise<void>>();
  const app: any = { get: (path: string, fn: any) => { routes.set(path, fn); return app; } };
  const ctx: any = {
    rpc: { call: rpc }, index: { forEachGameDeposit: () => undefined, forEachAddress: () => undefined, forEachTx: () => undefined, tipHeight: () => -1, timeAt: () => null, generation: () => '0' },
    handler: (fn: any) => fn, cached: (_k: string, _t: number, fn: any) => fn(),
    fail: (_req: any, res: any, status: number, message: string) => res.status(status).json({ error: message }),
  };
  featureRoutes(app, '/f/', ctx);
  return async (path: string, params: Record<string, string> = {}, query: Record<string, string> = {}) => {
    let status = 200;
    let body: any;
    const res: any = { status: (s: number) => { status = s; return res; }, json: (b: any) => { body = b; return res; } };
    await routes.get(path)!({ params, query }, res);
    return { status, body };
  };
}

describe('Sidepot wallet reads', () => {
  test('state: the node\'s game with tip_height and tip_clock from its preview', async () => {
    const get = setup(async () => STATE);
    const r = await get('/f/game/state');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ l1_height: 985000, tip_height: 985002, clock: 30, tip_clock: 32, price_sats: 1104622, accounts: 3 });
  });

  test('state: no preview, the settled height and clock', async () => {
    const get = setup(async () => ({ ...STATE, preview: null }));
    expect((await get('/f/game/state')).body).toMatchObject({ tip_height: 985000, tip_clock: 30 });
  });

  test('account: flat, or null; preview on request', async () => {
    const get = setup(async (_m, key) => key === P ? { balance_sats: 54000000, keys: 12, nonce: 7, preview: { balance_sats: 52000000, keys: 14, nonce: 8 } } : null);
    expect((await get('/f/game/account/:key', { key: P })).body).toEqual({ balance_sats: 54000000, keys: 12, nonce: 7 });
    expect((await get('/f/game/account/:key', { key: P }, { preview: '1' })).body.preview).toEqual({ balance_sats: 52000000, keys: 14, nonce: 8 });
    const none = await get('/f/game/account/:key', { key: 'ab'.repeat(32) });
    expect(none).toEqual({ status: 200, body: null });
    expect((await get('/f/game/account/:key', { key: 'xyz' })).status).toBe(400);
  });

  test('a node that hangs: 503, never an old answer', async () => {
    jest.useFakeTimers();
    try {
      let answer = true;
      const get = setup(() => answer ? Promise.resolve(STATE) : new Promise(() => undefined));
      expect((await get('/f/game/state')).status).toBe(200);
      answer = false;
      jest.setSystemTime(Date.now() + 20_000); // the answer is past its TTL
      const r = get('/f/game/state');
      await jest.advanceTimersByTimeAsync(8_000);
      expect((await r).status).toBe(503);
      const a = get('/f/game/account/:key', { key: P });
      await jest.advanceTimersByTimeAsync(8_000);
      expect((await a).status).toBe(503);
    } finally {
      jest.useRealTimers();
    }
  });
});
