import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { featureRoutes as thunderRoutes } from '../thunder/routes';
import { IndexView } from '../l2-views';

/**
 * Sidepot's feature routes (besides Thunder's richlist):
 *
 *   GET feature/game                  the node's game_state: pot, key price, round, deadline and clock, bonus pool,
 *                                     streak, accounts, what waits to be settled, and the preview to the eCash tip
 *   GET feature/game/account/:key     the node's game_account (64 hex): balance, keys, nonce, confirmed and preview
 *   GET feature/game/deposits         the deposits credited to game accounts, newest first (?account=<key>)
 *
 * game_state can be slow (the node works out the preview to the eCash tip): it is asked at most every TTL, and
 * while the node takes longer than WAIT the last answer is served (stale: true).
 */

const TTL = 15_000;
const WAIT = 8_000;

let last: { at: number; state: any } | null = null;
let pending: Promise<any> | null = null;

/** p's value, or undefined after ms; p must not reject @asyncSafe */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);
}

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  thunderRoutes(app, prefix, ctx);
  const index = ctx.index as IndexView;

  app.get(prefix + 'game', ctx.handler(async (req, res) => {
    if (!last || Date.now() - last.at > TTL) {
      pending ??= ctx.rpc.call('game_state').then(state => {
        last = { at: Date.now(), state };
        return state;
      }).finally(() => { pending = null; });
      await within(pending.catch(() => undefined), WAIT);
    }
    if (!last) {
      return ctx.fail(req, res, 503, 'The Sidepot node has not reported the game yet');
    }
    res.json({ ...(last.state ?? {}), started: last.state !== null, at: Math.floor(last.at / 1000), stale: Date.now() - last.at > TTL });
  }));

  app.get(prefix + 'game/account/:key', ctx.handler(/** @asyncUnsafe (ctx.handler answers its errors) */ async (req, res) => {
    const key = String(req.params.key);
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      return ctx.fail(req, res, 400, 'A game account is 64 hex characters');
    }
    const account = await ctx.cached('game-account:' + key.toLowerCase(), 10_000, () => ctx.rpc.call('game_account', key.toLowerCase()));
    res.json({ key: key.toLowerCase(), account: account ?? null });
  }));

  app.get(prefix + 'game/deposits', ctx.handler(async (req, res) => {
    const account = /^[0-9a-fA-F]{64}$/.test(String(req.query.account ?? '')) ? String(req.query.account).toLowerCase() : null;
    const items: any[] = [];
    index.forEachGameDeposit(d => {
      if (!account || d.account === account) {
        items.push(d);
      }
    });
    res.json({ count: items.length, amount: items.reduce((s, d) => s + d.amount, 0), items: items.reverse().slice(0, 200) });
  }));
}
