import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { featureRoutes as thunderRoutes } from '../thunder/routes';
import { IndexView } from '../l2-views';

/**
 * Sidepot's feature routes (besides Thunder's richlist):
 *
 *   GET feature/game                  the node's game_state: pot, key price, round, deadline and clock, bonus pool,
 *                                     streak, accounts, what waits to be settled, and the preview to the eCash tip;
 *                                     the last answer while the node is slow (stale: true), for the Game page
 *   GET feature/game/state            the game as sidepot.cash's /api/state has it (the wallet's read): game_state
 *                                     with tip_height / tip_clock (the preview's, else the settled ones); 503 unless
 *                                     the node answered within TTL
 *   GET feature/game/account/:key     the account as sidepot.cash's /api/account/<key> (the wallet's read):
 *                                     {balance_sats, keys, nonce} as settled, or null; ?preview=1 adds the node's
 *                                     preview (to the eCash tip); 503 when the node does not answer within WAIT
 *   GET feature/game/deposits         the deposits credited to game accounts, newest first (?account=<key>)
 *
 * game_state can be slow (the node works out the preview to the eCash tip): it is asked at most every TTL, at most
 * one call at a time; game_account at most ACCOUNT_CALLS at a time, one per key (a node that hangs would otherwise
 * hold the RPC slots the index needs: the rest are refused at once).
 */

const TTL = 15_000;
const WAIT = 8_000;
const ACCOUNT_CALLS = 2;
const ACCOUNT_TTL = 10_000;
const KEY = /^[0-9a-fA-F]{64}$/;
// sidepot.cash's /api/state fields (the wallet reads these, as non-negative integers)
const STATE_FIELDS = ['l1_height', 'clock', 'round', 'deadline', 'price_sats', 'pot_sats', 'bonus_pool_sats', 'accounts'];

let last: { at: number; state: any } | null = null;
let pending: Promise<any> | null = null;
const accounts = new Map<string, { at: number; account: any }>();
const accountCalls = new Map<string, Promise<any>>();

/** p's value, or undefined after ms; p must not reject @asyncSafe */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), ms))]);
}

const isCount = (v: unknown): boolean => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** game_state, asked again when older than TTL (one call at a time), waited for WAIT at most @asyncSafe */
async function $refresh(ctx: L2FeatureContext): Promise<void> {
  if (!last || Date.now() - last.at > TTL) {
    pending ??= ctx.rpc.call('game_state').then(state => {
      last = { at: Date.now(), state };
      return state;
    }).finally(() => { pending = null; });
    await within(pending.catch(() => undefined), WAIT);
  }
}

/** game_account, from an answer younger than ACCOUNT_TTL or the node within WAIT; undefined: no answer @asyncSafe */
async function $account(ctx: L2FeatureContext, key: string): Promise<any> {
  const c = accounts.get(key);
  if (c && Date.now() - c.at <= ACCOUNT_TTL) {
    return c.account;
  }
  let call = accountCalls.get(key);
  if (!call) {
    if (accountCalls.size >= ACCOUNT_CALLS) {
      return undefined;
    }
    call = ctx.rpc.call('game_account', key).then(account => {
      if (accounts.size > 1000) {
        accounts.clear();
      }
      accounts.set(key, { at: Date.now(), account: account ?? null });
      return account ?? null;
    }).finally(() => { accountCalls.delete(key); });
    accountCalls.set(key, call);
  }
  return within(call.catch(() => undefined), WAIT);
}

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  thunderRoutes(app, prefix, ctx);
  const index = ctx.index as IndexView;

  app.get(prefix + 'game', ctx.handler(async (req, res) => {
    await $refresh(ctx);
    if (!last) {
      return ctx.fail(req, res, 503, 'The Sidepot node has not reported the game yet');
    }
    res.json({ ...(last.state ?? {}), started: last.state !== null, at: Math.floor(last.at / 1000), stale: Date.now() - last.at > TTL });
  }));

  app.get(prefix + 'game/state', ctx.handler(async (req, res) => {
    await $refresh(ctx);
    const s = last && Date.now() - last.at <= TTL ? last.state : undefined;
    if (!s || !STATE_FIELDS.every(f => isCount(s[f]))) {
      return ctx.fail(req, res, 503, s === null ? 'The Sidepot node has no game' : 'The Sidepot node did not answer in time');
    }
    const p = s.preview ?? null;
    res.json({
      ...s,
      tip_height: isCount(p?.l1_height) ? p.l1_height : s.l1_height,
      tip_clock: isCount(p?.clock) ? p.clock : s.clock,
    });
  }));

  app.get(prefix + 'game/account/:key', ctx.handler(async (req, res) => {
    const key = String(req.params.key);
    if (!KEY.test(key)) {
      return ctx.fail(req, res, 400, 'A game account is 64 hex characters');
    }
    const a = await $account(ctx, key.toLowerCase());
    if (a === undefined) {
      return ctx.fail(req, res, 503, 'The Sidepot node did not answer in time');
    }
    if (a === null) {
      return res.json(null);
    }
    const flat = { balance_sats: a.balance_sats, keys: a.keys, nonce: a.nonce };
    res.json(req.query.preview === '1' ? { ...flat, preview: a.preview ?? null } : flat);
  }));

  app.get(prefix + 'game/deposits', ctx.handler(async (req, res) => {
    const account = KEY.test(String(req.query.account ?? '')) ? String(req.query.account).toLowerCase() : null;
    const items: any[] = [];
    index.forEachGameDeposit(d => {
      if (!account || d.account === account) {
        items.push(d);
      }
    });
    res.json({ count: items.length, amount: items.reduce((s, d) => s + d.amount, 0), items: items.reverse().slice(0, 200) });
  }));
}
