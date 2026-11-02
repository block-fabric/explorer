import { ChainModule } from '../../module';
import { getCrawls, getNodes, isCrawling, lastChecked, p2pParams, startCrawler } from '../../nodes';

/**
 * eCash (ECX), the mainchain: a fork of Bitcoin with BIP300/BIP301 drivechains, enforced by a bip300301_enforcer next
 * to eCash's node or by Backbone. Its drivechain views (BMM, deposits, withdrawals, votes, proposals) are the core's
 * drivechain index (chain/drivechain.ts), served at /api/v1/drivechain/*.
 *
 * Its own routes:
 *   GET chain/nodes   the network's reachable nodes, as the crawler (chain/nodes.ts) last found them, and its crawls
 */
const ecash: ChainModule = {
  profile: { id: 'ecash', kind: 'l1', name: 'eCash', unit: 'ECX', slot: null, mainchain: true, subsidy: true },

  initRoutes(app, prefix, ctx) {
    app.get(prefix + 'nodes', ctx.handler(/** @asyncUnsafe: handler() answers its errors */ async (req, res) => {
      if (!p2pParams()) {
        return ctx.fail(req, res, 404, 'No node crawler on this network');
      }
      res.json(await ctx.cached('nodes', 30_000, /** @asyncUnsafe: cached() passes its errors on */ async () => {
        const tip = await ctx.cached('blockcount', 10_000, () => ctx.node.call<number>('getblockcount').catch(() => null));
        const crawls = getCrawls();
        const last = crawls[crawls.length - 1] ?? null;
        return {
          tip,
          crawling: isCrawling(),
          checked: lastChecked(), // the heights' time (a crawl, or a check every 5 minutes between crawls)
          port: p2pParams()?.port,
          last,
          // the nodes reached in the last crawl, and those reached in the last week that have gone since
          nodes: getNodes().map(n => ({ ...n, up: !!last && n.lastSeen >= last.time })),
          history: crawls.map(c => ({ time: c.time, reachable: c.reachable, known: c.known })),
        };
      }));
    }));
  },

  start() {
    startCrawler();
  },
};

export default ecash;
