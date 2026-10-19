import { ChainModule, ChainModuleContext, sidechainProfile } from '../../module';
import { Reader, findMarkers, safeDecode } from '../../marker';

/**
 * BitNames: names that point to keys, addresses and data, owned like coins (after LayerTwo Labs' BitNames).
 *
 * Routes (/api/v1/sidechain/...):
 *   GET info                       getbitnamesinfo
 *   GET names?count=&skip=&match=  listnames (newest registrations first as the node lists them)
 *   GET name/:id                   getname + getnamehistory + getnamerecords; id = name, 0x<hash> or #seq
 *   GET tx/:txid                   the core's describeTx route: the name operation of a transaction
 *
 * Marker: OP_RETURN "BNAM" | version u8 | kind u8 | op body | name_outputs | reservation_outputs | memos [| ext]
 * (bitnames/src/bitnames/state.h, state.cpp). At most one per transaction.
 */

const TAG = '424e414d';
const KINDS: Record<number, string> = { 0: 'transfer', 1: 'reserve', 2: 'register', 3: 'update', 4: 'icann', 5: 'release', 6: 'register-subname' };

function nameData(r: Reader) {
  return {
    commitment: r.opt(() => r.hex(32)),
    ipv4: r.opt(() => { const ip = r.bytes(4); const port = r.u16(); return `${[...ip].join('.')}${port ? ':' + port : ''}`; }),
    ipv6: r.opt(() => { const ip = r.hex(16); const port = r.u16(); return { ip, port }; }),
    encryptionKey: r.opt(() => r.hex(33)),
    signingKey: r.opt(() => r.hex(32)),
    paymailFee: r.opt(() => r.i64()),
  };
}

function update<T>(r: Reader, f: () => T): { op: 'delete' | 'retain' | 'set'; value?: T } {
  const k = r.u8();
  return k === 2 ? { op: 'set', value: f() } : { op: k === 0 ? 'delete' : 'retain' };
}

export function decodeBitnamesMarker(payload: Buffer): any {
  const r = new Reader(payload);
  const version = r.u8();
  const kindN = r.u8();
  const out: any = { version, kind: KINDS[kindN] ?? `kind ${kindN}` };
  switch (kindN) {
    case 1: out.commitment = r.hex(32); break;
    case 2: out.nameHash = r.hash(); r.bytes(32); out.data = nameData(r); break;
    case 3: {
      const u = (f: () => any) => update(r, f);
      out.updates = {
        commitment: u(() => r.hex(32)), ipv4: u(() => { const ip = r.bytes(4); const port = r.u16(); return `${[...ip].join('.')}${port ? ':' + port : ''}`; }),
        ipv6: u(() => ({ ip: r.hex(16), port: r.u16() })), encryptionKey: u(() => r.hex(33)), signingKey: u(() => r.hex(32)), paymailFee: u(() => r.i64()),
      };
      break;
    }
    case 4: out.icannNames = r.vector(() => r.string()); r.varBytes(); break;
    case 6: out.label = r.string(); out.data = nameData(r); break;
  }
  out.nameOutputs = r.vector(() => r.u32());
  out.reservationOutputs = r.vector(() => r.u32());
  out.memos = r.vector(() => ({ vout: r.u32(), size: r.varBytes().length }));
  if (version === 1) {
    if (kindN === 2) { out.records = r.opt(() => r.string()); out.name = r.opt(() => r.string()); }
    if (kindN === 3) { const u = update(r, () => r.string()); out.updates.records = u; }
    if (kindN === 6) { out.records = r.opt(() => r.string()); }
  }
  return out;
}

const bitnames: ChainModule = {
  profile: sidechainProfile('bitnames', 'BitNames', 3, 'bn'),

  initRoutes(app, prefix, ctx) {
    app.get(prefix + 'info', ctx.handler(async (req, res) => {
      res.json(await ctx.cached('info', 5000, () => ctx.node.call('getbitnamesinfo')));
    }));
    app.get(prefix + 'names', ctx.handler(async (req, res) => {
      const count = ctx.intParam(req.query.count, 50, 1, 500);
      const skip = ctx.intParam(req.query.skip, 0, 0, 1e9);
      const match = typeof req.query.match === 'string' ? req.query.match.slice(0, 64) : '';
      const args: unknown[] = [count, skip];
      if (match) { args.push(match); }
      res.json(await ctx.cached(`names:${count}:${skip}:${match}`, 5000, () => ctx.node.call('listnames', ...args)));
    }));
    app.get(prefix + 'name/:id', ctx.handler(async (req, res) => {
      const id = String(req.params.id).slice(0, 300);
      let name;
      try {
        name = await ctx.node.call('getname', id);
      } catch (e) {
        return ctx.fail(req, res, 404, 'Unknown name');
      }
      const key = '0x' + name.namehash;
      const [history, records] = await Promise.all([
        ctx.node.call('getnamehistory', key).catch(() => null),
        ctx.node.call('getnamerecords', key).catch(() => null),
      ]);
      res.json({ name, history, records });
    }));
  },

  async describeTx(tx: any, ctx: ChainModuleContext) {
    const m = findMarkers(tx, TAG)[0];
    if (!m) {
      return null;
    }
    const op: any = safeDecode(() => decodeBitnamesMarker(m.payload));
    op.vout = m.vout;
    // the name, when the node knows it: by hash for a registration, by the name outputs otherwise
    const hash = op.nameHash;
    if (hash) {
      op.known = await ctx.node.call('getname', '0x' + hash).catch(() => null);
    }
    return { chain: 'bitnames', ops: [op] };
  },
};

export default bitnames;
