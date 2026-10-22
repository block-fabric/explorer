import { Application } from 'express';
import { L2FeatureContext } from '../../l2/types';
import { HASH, IndexTx, IndexUtxo, IndexView, candidateName, derived, hexOf, nameHash, notFound, txsOf, utxosOf } from '../l2-views';

/**
 * BitNames' feature routes (chains/L2-API.md "names"): the node's bitnames / bitname_data joined with the index:
 * each name's owner (the address holding its BitName output), its reservation, registration, updates and
 * transfers. The chain keeps a name's blake3 hash only: the plain name shows when a BatchIcann tx reveals it or a
 * candidate (name-candidates.ts) hashes to it.
 *
 *   GET feature/names        every name: plain name (when known), owner, registration, updates, the data's fields
 *   GET feature/names/:id    one name (its hash): data, owner, history
 */

export type NameEventKind = 'reservation' | 'registration' | 'update' | 'transfer' | 'icann';

export interface NameEvent {
  kind: NameEventKind;
  height: number;
  time: number | null;
  txid: string;
  /** the address the name went to (registration, transfer), or that reserved it */
  address: string | null;
  data: any;
}

export interface NamesView {
  events: Map<string, NameEvent[]>;
  owners: Map<string, string>;
  revealed: Map<string, string>;
  reservations: { total: number; open: number; registered: number };
}

export function buildNames(txs: IndexTx[], utxos: IndexUtxo[]): NamesView {
  const events = new Map<string, NameEvent[]>();
  const revealed = new Map<string, string>();
  const reservedAt = new Map<string, IndexTx>(); // reservation txid -> tx
  const add = (id: string, e: NameEvent) => events.set(id, [...(events.get(id) ?? []), e]);
  let total = 0;
  let registered = 0;
  for (const t of txs) {
    const d = t.data;
    const ref = { height: t.height, time: t.time, txid: t.txid };
    if (d?.type === 'BitNameReservation') {
      total++;
      reservedAt.set(t.txid, t);
    }
    if (d?.type === 'BitNameRegistration' && d.name_hash) {
      registered++;
      // the reservation it spends
      const r = t.inputs.find(i => i.content?.type === 'bitnameReservation');
      const rt = r?.outpoint.txid ? reservedAt.get(r.outpoint.txid) : undefined;
      if (rt) {
        add(d.name_hash, { kind: 'reservation', height: rt.height, time: rt.time, txid: rt.txid, address: r?.address ?? null, data: rt.data });
      }
      const out = t.outputs.find(o => o.content.type === 'bitname');
      add(d.name_hash, { kind: 'registration', ...ref, address: out?.address ?? null, data: d });
      continue;
    }
    if (d?.type === 'BatchIcann') {
      for (const n of Array.isArray(d.plain_names) ? d.plain_names : []) {
        if (typeof n === 'string') {
          const h = nameHash(n);
          revealed.set(h, n);
          add(h, { kind: 'icann', ...ref, address: null, data: { plain_name: n } });
        }
      }
    }
    // a tx spending a name: an update (BitNameUpdate) or a transfer
    for (const i of t.inputs) {
      if (i.content?.type === 'bitname' && i.content.name) {
        const out = t.outputs.find(o => o.content.type === 'bitname' && o.content.name === i.content?.name);
        add(i.content.name, { kind: d?.type === 'BitNameUpdate' ? 'update' : 'transfer', ...ref, address: out?.address ?? null, data: d ?? null });
      }
    }
  }
  const owners = new Map<string, string>();
  let open = 0;
  for (const u of utxos) {
    if (u.content.type === 'bitname' && u.content.name) {
      owners.set(u.content.name, u.address);
    } else if (u.content.type === 'bitnameReservation') {
      open++;
    }
  }
  return { events, owners, revealed, reservations: { total, open, registered } };
}

/** bitname_data with its byte arrays (commitment) as hex */
function dataView(d: any): any {
  if (!d || typeof d !== 'object') {
    return d;
  }
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) && v.every(x => typeof x === 'number') ? hexOf(v as number[]) : v]));
}

const view = derived<NamesView>(index => buildNames(txsOf(index), utxosOf(index)));

function nameItem(v: NamesView, id: string, data: any): any {
  const ev = v.events.get(id) ?? [];
  const reg = ev.find(e => e.kind === 'registration');
  const last = ev[ev.length - 1];
  return {
    id, name: v.revealed.get(id) ?? candidateName(id), seq: data?.seq_id ?? null, data: dataView(data), owner: v.owners.get(id) ?? null,
    registered: reg ? { height: reg.height, time: reg.time, txid: reg.txid } : null,
    updates: ev.filter(e => e.kind === 'update').length, transfers: ev.filter(e => e.kind === 'transfer').length,
    last: last ? { height: last.height, time: last.time, txid: last.txid } : null,
  };
}

export function featureRoutes(app: Application, prefix: string, ctx: L2FeatureContext): void {
  const index = ctx.index as IndexView;
  const nodeNames = () => ctx.cached('bitnames', 5000, () => ctx.rpc.call<any[]>('bitnames'));

  app.get(prefix + 'names', ctx.handler(async (req, res) => {
    const v = view(index);
    const list = await nodeNames();
    res.json({ items: (list ?? []).map(([id, data]) => nameItem(v, String(id), data)), reservations: v.reservations });
  }));

  app.get(prefix + 'names/:id', ctx.handler(async (req, res) => {
    const id = String(req.params.id).toLowerCase();
    if (!HASH.test(id)) {
      return ctx.fail(req, res, 400, 'Invalid name hash');
    }
    const v = view(index);
    const entry = (await nodeNames() ?? []).find(x => x[0] === id);
    if (!entry && !v.events.has(id)) {
      return notFound(index, res, () => ctx.fail(req, res, 404, 'Unknown name'));
    }
    res.json({ ...nameItem(v, id, entry?.[1] ?? null), history: [...(v.events.get(id) ?? [])].reverse() });
  }));
}
