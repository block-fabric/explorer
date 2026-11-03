import { Application, Request, Response } from 'express';
import config from '../config';
import { handleError } from '../utils/api';
import { PROFILE } from './profile';
import { NETWORK } from './networks';
import { $getBitcoin, $getCandles, $getMarkets, $getNews, $startIntel } from './intel';
import { getWhales, startWhales } from './whales';

/**
 * The console's outside data (chain/intel.ts), on eCash mainnet's explorer only:
 *   GET chain/intel/markets            ECX's markets: wECX and waECX on Solana, ECX on neoxa.exchange, the weighted price
 *   GET chain/intel/candles/:pair      neoxa's hourly candles of ECX_USDC, ECX_USDT or ECX_BTC (the last week)
 *   GET chain/intel/news               ecash.com's blog
 *   GET chain/intel/bitcoin            Bitcoin's price, hashrate, difficulty and last day's rewards (mempool.space)
 *   GET chain/intel/whales?limit=      eCash's largest transactions over the last week's blocks, the volume per day
 */
class IntelRoutes {
  public initRoutes(app: Application): void {
    if (PROFILE.id !== 'ecash' || NETWORK.id !== 'ecash') {
      return;
    }
    const prefix = config.MEMPOOL.API_URL_PREFIX + 'chain/intel/';
    app.get(prefix + 'markets', this.$markets).get(prefix + 'candles/:pair', this.$candles).get(prefix + 'news', this.$news)
      .get(prefix + 'bitcoin', this.$bitcoin).get(prefix + 'whales', this.whales);
    startWhales();
    $startIntel().catch(() => undefined); // (it catches its own errors)
  }

  /** @asyncSafe */
  private $markets = async (req: Request, res: Response): Promise<void> => {
    try {
      const m = await $getMarkets();
      m ? res.json(m) : handleError(req, res, 503, 'The markets are not available yet');
    } catch {
      handleError(req, res, 500, 'Could not read the markets');
    }
  };

  /** @asyncSafe */
  private $candles = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await $getCandles(String(req.params.pair)));
    } catch {
      handleError(req, res, 500, 'Could not read the candles');
    }
  };

  /** @asyncSafe */
  private $bitcoin = async (req: Request, res: Response): Promise<void> => {
    try {
      const b = await $getBitcoin();
      b ? res.json(b) : handleError(req, res, 503, 'Bitcoin\'s numbers are not available yet');
    } catch {
      handleError(req, res, 500, 'Could not read Bitcoin\'s numbers');
    }
  };

  private whales = (req: Request, res: Response): void => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    res.json(getWhales(limit));
  };

  /** @asyncSafe */
  private $news = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await $getNews() ?? { updated: null, items: [] });
    } catch {
      handleError(req, res, 500, 'Could not read the news');
    }
  };
}

export default new IntelRoutes();
