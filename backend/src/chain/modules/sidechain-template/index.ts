import { Application } from 'express';
import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';

/**
 * The starting point for a new sidechain: copy this folder to modules/<your-id>/, set the profile, add one line to
 * modules/index.ts, and do the same on the frontend (frontend/src/app/chain/modules/). See chains/MODULES.md.
 *
 * Everything below the profile is optional. Without it the sidechain still gets the whole explorer (blocks,
 * transactions, mempool, addresses) and the drivechain views every sidechain has: the Chains block that carried
 * each block (BMM) and its deposits and withdrawals.
 */
const sidechainTemplate: ChainModule = {
  // id, name, BIP300 slot, bech32 prefix on main (testnet: 't' + it)
  profile: sidechainProfile('sidechain-template', 'Sidechain', 0, 'sc'),

  initRoutes(app: Application, prefix: string, ctx: ChainModuleContext): void {
    // GET /api/v1/sidechain/info: the node's own summary RPC, cached for a block's time
    app.get(prefix + 'info', ctx.handler(async (req, res) => {
      res.json(await ctx.cached('info', 5000, () => ctx.node.call('getsidechainstate')));
    }));
  },

  // async describeTx(tx, ctx) { return null; },     // what a tx does on this chain (decode your OP_RETURN marker)
  // async describeBlock(block, ctx) { return null; }, // extra block fields
};

export default sidechainTemplate;
