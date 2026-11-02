import { Application, Request, Response } from 'express';
import config from '../config';
import logger from '../logger';
import { handleError } from '../utils/api';
import bitcoinClient from '../api/bitcoin/bitcoin-client';
import { getCrawls, getNodes, isCrawling, lastChecked, p2pParams, schedule, startCrawler } from './nodes';

/**
 * GET /api/v1/chain/nodes: the network's reachable nodes, as the crawler (chain/nodes.ts) last found them, and its
 * crawls. On every explorer whose chain has a P2P network to crawl (eCash, Flush, FreeBank); the crawler starts with it.
 */

const TIP_TIMEOUT = 5_000;
let cache: { at: number; body: unknown } | null = null;

/** this explorer's node's height, if it answers in time (a Flush explorer's node may not be reachable: null) @asyncSafe */
async function $ourTip(): Promise<number | null> {
  try {
    return await Promise.race([
      bitcoinClient.getBlockCount() as Promise<number>,
      new Promise<null>(resolve => setTimeout(() => resolve(null), TIP_TIMEOUT)),
    ]);
  } catch {
    return null;
  }
}

class NodesRoutes {
  public initRoutes(app: Application): void {
    if (!p2pParams()) {
      return;
    }
    app.get(config.MEMPOOL.API_URL_PREFIX + 'chain/nodes', this.$getNodes);
    startCrawler($ourTip);
  }

  /** @asyncSafe */
  private $getNodes = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!cache || Date.now() - cache.at > 10_000) {
        const crawls = getCrawls();
        const last = crawls[crawls.length - 1] ?? null;
        cache = {
          at: Date.now(),
          body: {
            tip: await $ourTip(),
            crawling: isCrawling(),
            schedule: schedule(),
            checked: lastChecked(), // the heights' time (a crawl, or a check every 5 minutes between crawls)
            port: p2pParams()?.port,
            last,
            // the nodes reached in the last crawl, and those reached in the last week that have gone since
            nodes: getNodes().map(n => ({ ...n, up: !!last && n.lastSeen >= last.time })),
            history: crawls.map(c => ({ time: c.time, reachable: c.reachable, known: c.known })),
          },
        };
      }
      res.json(cache.body);
    } catch (e) {
      logger.err(`chain/nodes: ${e instanceof Error ? e.message : e}`, 'Nodes');
      handleError(req, res, 500, 'Could not read the nodes');
    }
  };
}

export default new NodesRoutes();
