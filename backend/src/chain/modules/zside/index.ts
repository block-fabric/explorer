import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';
import { Reader, findMarkers, safeDecode } from '../../marker';

/**
 * zSide: shielded payments with Zcash Orchard (Halo 2) bundles carried in a transaction.
 *
 * Routes (/api/v1/sidechain/...):
 *   GET info      getshieldedinfo (the value in the shielded pool, note count, tree root)
 *   GET tx/:txid  the core's describeTx route: the shielded bundle of a transaction (actions, value in/out)
 *
 * Marker: OP_RETURN "ZORC" | version u8 (0) | Orchard bundle (ZIP 225): CompactSize nActions, 820 bytes per action,
 * flags u8, valueBalance i64 (what the bundle takes out of the pool; negative = shielding), anchor, proof, sigs.
 * Nothing else is readable without a viewing key. A shielded transaction with no inputs uses serialization flag 2,
 * which the backend's parsers do not know; its JSON comes from the node, which is enough here.
 */

const TAG = '5a4f5243';
const ACTION_SIZE = 820;

export function decodeOrchardBundle(payload: Buffer): any {
  const r = new Reader(payload);
  const version = r.u8();
  const actions = r.compactSize();
  r.bytes(actions * ACTION_SIZE);
  const flags = r.u8();
  const valueBalance = r.i64();
  r.bytes(32); // anchor
  const proofSize = r.compactSize();
  return {
    version, actions, valueBalance, proofSize,
    spendsEnabled: !!(flags & 1), outputsEnabled: !!(flags & 2),
    // what the transaction did with the pool
    direction: valueBalance < 0 ? 'shield' : valueBalance > 0 ? 'unshield' : 'shielded',
  };
}

const zside: ChainModule = {
  profile: sidechainProfile('zside', 'zSide', 6, 'zs'),

  initRoutes(app, prefix, ctx) {
    app.get(prefix + 'info', ctx.handler(async (req, res) => {
      res.json(await ctx.cached('info', 5000, () => ctx.node.call('getshieldedinfo')));
    }));
  },

  async describeTx(tx: any, ctx: ChainModuleContext) {
    const m = findMarkers(tx, TAG)[0];
    if (!m) {
      return null;
    }
    const bundle: any = safeDecode(() => decodeOrchardBundle(m.payload));
    return { chain: 'zside', ops: [{ kind: 'orchard', vout: m.vout, ...bundle }] };
  },
};

export default zside;
