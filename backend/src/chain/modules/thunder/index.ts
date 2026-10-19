import { ChainModule, sidechainProfile } from '../../module';

/**
 * Thunder: a payments sidechain with large blocks (32 M weight units). Nothing beyond the template's RPCs: its
 * showcase is throughput, which the stock mempool views (block fill, tx/s, mempool) show as they are.
 */
const thunder: ChainModule = {
  profile: { ...sidechainProfile('thunder', 'Thunder', 2, 'th', 'rth') },

  initRoutes(app, prefix, ctx) {
    // GET info: the sidechain's state and its view of the mainchain
    app.get(prefix + 'info', ctx.handler(async (req, res) => {
      res.json(await ctx.cached('info', 5000, async () => ({
        state: await ctx.node.call('getsidechainstate'),
        mainchain: await ctx.node.call('getmainchaininfo').catch(() => null),
        chain: await ctx.node.call('getblockchaininfo'),
        mempool: await ctx.node.call('getmempoolinfo'),
      })));
    }));
  },
};

export default thunder;
