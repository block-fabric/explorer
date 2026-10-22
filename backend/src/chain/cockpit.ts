import drivechain, { DrivechainBlock } from './drivechain';
import { PROFILE, profileBySlot } from './profile';

/**
 * The drivechain cockpit: statistics over the drivechain index for a window of eCash blocks, for every sidechain
 * or one slot.
 *
 *   totals     BMM (blocks carrying sidechain blocks, accepts, requests, bids), miner revenue (subsidy, fees, bids),
 *              flows (deposits, withdrawals), votes, proposals, bundles
 *   slots      the same per sidechain, plus BMM coverage, bid distribution, competition, vote counts
 *   miners     per coinbase tag: blocks, BMM accepts, bids earned, voting
 *   series     per bucket of blocks: bids, accepts, deposits, withdrawals, fees, subsidy, escrow per slot
 *   coverage   the newest blocks x sidechains: who carried what, at which bid
 *   bundles    score history of the pending withdrawal bundles
 */

export interface CockpitSlotStats {
  slot: number;
  name: string;
  profile: string | null;
  accepts: number;
  coverage: number;            // accepts / blocks in the window
  lastAcceptHeight: number | null;
  longestGap: number;          // the most mainchain blocks in a row without a block of this sidechain
  requests: number;
  rejected: number;            // M8 requests not accepted
  contested: number;           // blocks with more than one request for this slot
  bids: number;
  bidAvg: number;
  bidMedian: number;
  bidMax: number;
  bidMin: number;
  deposits: number;
  depositAmount: number;
  withdrawals: number;
  withdrawalAmount: number;
  netFlow: number;
  upvotes: number;
  downvotes: number;
  abstains: number;
  bundlesProposed: number;
  bundlesPaid: number;
  bundlesFailed: number;
}

export interface CockpitMinerStats {
  tag: string;
  blocks: number;
  share: number;
  accepts: number;             // BMM accepts in its blocks
  acceptsPerBlock: number;
  bids: number;                // sats earned from BMM bids
  fees: number;
  subsidy: number;
  voteBlocks: number;          // blocks in which it voted on bundles (not all abstain)
  lastHeight: number;
}

const median = (xs: number[]): number => {
  if (!xs.length) { return 0; }
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

const cache = new Map<string, { tip: number; at: number; value: any }>();

export function cockpit(window: number, slot: number | null, escrowNow: Record<number, number>): any {
  const tip = drivechain.tipHeight();
  const key = `${window}:${slot}`;
  const c = cache.get(key);
  if (c && c.tip === tip && Date.now() - c.at < 15000) {
    return c.value;
  }
  const value = compute(tip, window, slot, escrowNow);
  cache.set(key, { tip, at: Date.now(), value });
  return value;
}

function compute(tip: number, window: number, slotFilter: number | null, escrowNow: Record<number, number>): any {
  const from = window > 0 ? Math.max(drivechain.firstHeight(), tip - window + 1) : drivechain.firstHeight();
  const blocks = drivechain.range(from, tip);
  const n = blocks.length;
  const own = (x: { slot: number }) => slotFilter === null || x.slot === slotFilter;

  const sidechains = drivechain.getSidechains().filter(s => slotFilter === null || s.slot === slotFilter);
  const slots = new Map<number, CockpitSlotStats & { _bids: number[]; _gap: number }>();
  const slotOf = (slot: number, name: string) => {
    if (!slots.has(slot)) {
      slots.set(slot, {
        slot, name: sidechains.find(s => s.slot === slot)?.title ?? name, profile: profileBySlot(slot)?.id ?? null,
        accepts: 0, coverage: 0, lastAcceptHeight: null, longestGap: 0, requests: 0, rejected: 0, contested: 0,
        bids: 0, bidAvg: 0, bidMedian: 0, bidMax: 0, bidMin: 0, deposits: 0, depositAmount: 0, withdrawals: 0,
        withdrawalAmount: 0, netFlow: 0, upvotes: 0, downvotes: 0, abstains: 0, bundlesProposed: 0, bundlesPaid: 0,
        bundlesFailed: 0, _bids: [], _gap: 0,
      });
    }
    return slots.get(slot)!;
  };
  for (const s of sidechains) { slotOf(s.slot, s.title ?? `Slot ${s.slot}`); }

  const miners = new Map<string, CockpitMinerStats>();
  const totals = {
    blocks: n, from, to: tip, firstTime: blocks[0]?.time ?? null, lastTime: blocks[n - 1]?.time ?? null,
    bmmBlocks: 0, accepts: 0, requests: 0, rejected: 0, bids: 0, bidAvg: 0,
    reward: 0, fees: 0, subsidy: 0, bidShareOfFees: 0, bidShareOfReward: 0,
    deposits: 0, depositAmount: 0, withdrawals: 0, withdrawalAmount: 0, netFlow: 0,
    voteBlocks: 0, upvotes: 0, downvotes: 0, repeatVotes: 0, leadingVotes: 0,
    proposals: 0, acks: 0, bundlesProposed: 0, bundlesPaid: 0, bundlesFailed: 0,
    avgBlockTime: 0, minersSeen: 0,
  };

  // series: up to 60 buckets over the window
  const buckets = Math.max(1, Math.min(60, n));
  const per = Math.max(1, Math.ceil(n / buckets));
  const series: any[] = [];

  for (let i = 0; i < n; i++) {
    const b = blocks[i];
    const bi = Math.floor(i / per);
    if (!series[bi]) {
      series[bi] = { from: b.height, to: b.height, time: b.time, bids: {}, accepts: {}, deposits: {}, withdrawals: {}, fees: 0, subsidy: 0, bidsTotal: 0, blocks: 0 };
    }
    const sb = series[bi];
    sb.to = b.height;
    sb.blocks++;

    const accepts = b.bmm.filter(own);
    const requests = b.bmmRequests.filter(own);
    if (accepts.length) { totals.bmmBlocks++; }
    totals.accepts += accepts.length;
    totals.requests += requests.length;
    totals.rejected += requests.filter(r => !r.accepted).length;

    for (const s of slots.values()) {
      if (accepts.some(a => a.slot === s.slot)) {
        s.longestGap = Math.max(s.longestGap, s._gap);
        s._gap = 0;
      } else {
        s._gap++;
      }
    }
    for (const a of accepts) {
      const s = slotOf(a.slot, a.name);
      s.accepts++;
      s.lastAcceptHeight = b.height;
      if (a.bid !== undefined && a.bid !== null) {
        s._bids.push(a.bid);
        s.bids += a.bid;
        totals.bids += a.bid;
        sb.bids[a.slot] = (sb.bids[a.slot] ?? 0) + a.bid;
        sb.bidsTotal += a.bid;
      }
      sb.accepts[a.slot] = (sb.accepts[a.slot] ?? 0) + 1;
    }
    const perSlotReq = new Map<number, number>();
    for (const r of requests) {
      const s = slotOf(r.slot, r.name);
      s.requests++;
      if (!r.accepted) { s.rejected++; }
      perSlotReq.set(r.slot, (perSlotReq.get(r.slot) ?? 0) + 1);
    }
    for (const [slot, count] of perSlotReq) {
      if (count > 1) { slotOf(slot, '').contested++; }
    }
    for (const d of b.deposits.filter(own)) {
      const s = slotOf(d.slot, d.name);
      s.deposits++; s.depositAmount += d.amount;
      totals.deposits++; totals.depositAmount += d.amount;
      sb.deposits[d.slot] = (sb.deposits[d.slot] ?? 0) + d.amount;
    }
    for (const w of b.withdrawals.filter(own)) {
      const s = slotOf(w.slot, w.name);
      s.withdrawals++; s.withdrawalAmount += w.amount;
      totals.withdrawals++; totals.withdrawalAmount += w.amount;
      sb.withdrawals[w.slot] = (sb.withdrawals[w.slot] ?? 0) + w.amount;
    }
    if (b.votes) {
      if (b.votes.form === 0) { totals.repeatVotes++; }
      if (b.votes.form === 3) { totals.leadingVotes++; }
      const entries = b.votes.entries.filter(own);
      if (entries.some(e => e.vote !== 'abstain')) { totals.voteBlocks++; }
      for (const e of entries) {
        const s = slots.get(e.slot);
        if (!s) { continue; }
        if (e.vote === 'upvote') { s.upvotes++; totals.upvotes++; }
        else if (e.vote === 'downvote') { s.downvotes++; totals.downvotes++; }
        else { s.abstains++; }
      }
    }
    totals.proposals += b.proposals.filter(own).length;
    totals.acks += b.acks.filter(own).length;
    for (const p of b.bundlesProposed.filter(own)) { slotOf(p.slot, p.name).bundlesProposed++; totals.bundlesProposed++; }
    for (const c of b.bundlesClosed.filter(own)) {
      const s = slotOf(c.slot, c.name);
      if (c.paid) { s.bundlesPaid++; totals.bundlesPaid++; } else { s.bundlesFailed++; totals.bundlesFailed++; }
    }

    if (b.miner) {
      totals.reward += b.miner.reward;
      totals.fees += b.miner.fees;
      totals.subsidy += b.miner.subsidy;
      sb.fees += b.miner.fees;
      sb.subsidy += b.miner.subsidy;
      const tag = b.miner.tag ?? 'Unknown';
      const m = miners.get(tag) ?? { tag, blocks: 0, share: 0, accepts: 0, acceptsPerBlock: 0, bids: 0, fees: 0, subsidy: 0, voteBlocks: 0, lastHeight: 0 };
      m.blocks++;
      m.accepts += accepts.length;
      m.bids += accepts.reduce((a, x) => a + (x.bid ?? 0), 0);
      m.fees += b.miner.fees;
      m.subsidy += b.miner.subsidy;
      if (b.votes?.entries.some(e => e.vote !== 'abstain')) { m.voteBlocks++; }
      m.lastHeight = b.height;
      miners.set(tag, m);
    }
  }

  // slot stats
  const slotList = [...slots.values()].map(s => {
    s.longestGap = Math.max(s.longestGap, s._gap);
    s.coverage = n ? s.accepts / n : 0;
    s.bidAvg = s._bids.length ? Math.round(s.bids / s._bids.length) : 0;
    s.bidMedian = median(s._bids);
    s.bidMax = s._bids.length ? Math.max(...s._bids) : 0;
    s.bidMin = s._bids.length ? Math.min(...s._bids) : 0;
    s.netFlow = s.depositAmount - s.withdrawalAmount;
    const { _bids, _gap, ...rest } = s;
    return rest;
  }).sort((a, b) => a.slot - b.slot);

  totals.bidAvg = totals.accepts ? Math.round(totals.bids / totals.accepts) : 0;
  totals.netFlow = totals.depositAmount - totals.withdrawalAmount;
  totals.bidShareOfFees = totals.fees ? totals.bids / totals.fees : 0;
  totals.bidShareOfReward = totals.reward ? totals.bids / totals.reward : 0;
  totals.avgBlockTime = n > 1 && totals.firstTime !== null && totals.lastTime !== null ? (totals.lastTime - totals.firstTime) / (n - 1) : 0;
  totals.minersSeen = miners.size;

  const minerList = [...miners.values()].map(m => ({
    ...m, share: n ? m.blocks / n : 0, acceptsPerBlock: m.blocks ? m.accepts / m.blocks : 0,
  })).sort((a, b) => b.blocks - a.blocks);

  // escrow per slot at the end of each bucket: now, minus the changes after it
  const escrowSeries: Record<number, number[]> = {};
  for (const s of slotList) {
    const now = escrowNow[s.slot];
    if (now === undefined) { continue; }
    const out = new Array(series.length).fill(0);
    let level = now;
    // changes after the window's end (none: the window ends at the tip)
    for (let bi = series.length - 1; bi >= 0; bi--) {
      out[bi] = level;
      // undo this bucket's changes to get the level at the end of the previous one
      for (const b of blocks.slice(bi * per, Math.min(n, (bi + 1) * per))) {
        for (const d of b.deposits) { if (d.slot === s.slot) { level -= d.amount; } }
        for (const w of b.withdrawals) { if (w.slot === s.slot) { level -= w.escrowDelta ?? -w.amount; } }
      }
    }
    escrowSeries[s.slot] = out;
  }
  for (let bi = 0; bi < series.length; bi++) {
    series[bi].escrow = Object.fromEntries(Object.entries(escrowSeries).map(([slot, xs]) => [slot, xs[bi]]));
  }

  // coverage: the newest 120 blocks x slots
  const coverage = blocks.slice(-120).map(b => ({
    height: b.height,
    hash: b.hash,
    time: b.time,
    miner: b.miner?.tag ?? null,
    accepts: b.bmm.filter(own).map(a => ({ slot: a.slot, bid: a.bid ?? null, sideBlock: a.sideBlock })),
    requests: b.bmmRequests.filter(own).length,
    deposits: b.deposits.filter(own).length,
    withdrawals: b.withdrawals.filter(own).length,
    voted: !!b.votes?.entries.filter(own).some(e => e.vote !== 'abstain'),
  }));

  // the score history of every bundle pending at the tip (one point per 1/120 of the window)
  const pendingNow = blocks[n - 1]?.pending ?? {};
  const bundleHistory: Record<string, { slot: number; points: [number, number][] }> = {};
  const step = Math.max(1, Math.floor(n / 120));
  for (const [slotS, list] of Object.entries(pendingNow)) {
    const slot = Number(slotS);
    if (slotFilter !== null && slot !== slotFilter) { continue; }
    for (const p of list) {
      bundleHistory[p.hash] = { slot, points: [] };
    }
  }
  for (let i = 0; i < n; i += step) {
    addBundlePoints(blocks[i], bundleHistory);
  }
  if (n && (n - 1) % step) {
    addBundlePoints(blocks[n - 1], bundleHistory);
  }

  return {
    profile: PROFILE.id,
    slot: slotFilter,
    window,
    totals,
    slots: slotList,
    miners: minerList,
    series,
    coverage,
    bundleHistory,
  };
}

function addBundlePoints(b: DrivechainBlock, hist: Record<string, { slot: number; points: [number, number][] }>): void {
  for (const [slotS, list] of Object.entries(b.pending ?? {})) {
    for (const p of list) {
      const h = hist[p.hash];
      if (h && h.slot === Number(slotS)) {
        h.points.push([b.height, p.score]);
      }
    }
  }
}
