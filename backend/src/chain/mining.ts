import drivechain, { DrivechainBlock } from './drivechain';
import { BLOCK_SPACING, HALVING_INTERVAL, RETARGET_INTERVAL } from './networks';

/**
 * Mining statistics of eCash, over a window of blocks of the drivechain index (which reads every coinbase): pools by
 * coinbase tag (DATUM pools with their miners), hashrate and difficulty, the retarget, block times, halving epochs.
 *
 * Difficulty: Bitcoin's, retargeting every 2016 blocks to 10-minute blocks (at most 4x either way); the next
 * difficulty is estimated from the current period's pace. eCash reset the difficulty once, at its fork height.
 */

export interface RetargetParams {
  minDifficultyBlocks: boolean;
}

const BUCKETS = 60;
const TOP_POOLS = 7;
const HASHES_PER_DIFFICULTY = 2 ** 32;
const BLOCK_TIME_BINS = [60, 120, 300, 600, 900, 1200, 1800, 3600];

const median = (xs: number[]): number => {
  if (!xs.length) { return 0; }
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Where the chain is in its retarget period after `tip`, and the difficulty the next period would get at the pace so
 * far. `periodStart` is the first block of the period (its height a multiple of 2016), when indexed.
 */
export function retargetState(p: RetargetParams, tip: { height: number; time: number; difficulty: number },
  periodStart: { height: number; time: number } | null): any {
  const start = tip.height - (tip.height % RETARGET_INTERVAL);
  const next = start + RETARGET_INTERVAL;
  const done = tip.height - start; // block intervals in the period so far
  const pace = periodStart && done > 0 ? (tip.time - periodStart.time) / done : null;
  const factor = pace ? Math.max(0.25, Math.min(4, BLOCK_SPACING / pace)) : null;
  return {
    periodStart: start,
    nextRetarget: next,
    blocksLeft: next - tip.height,
    progress: done / RETARGET_INTERVAL,
    avgBlockTime: pace,
    nextDifficulty: factor ? tip.difficulty * factor : null,
    change: factor ? factor - 1 : null,
    eta: tip.time + (next - tip.height) * (pace ?? BLOCK_SPACING),
    minDifficultyAfter: p.minDifficultyBlocks ? tip.time + 2 * BLOCK_SPACING : null,
  };
}

export function miningStats(window: number, retarget: RetargetParams): any {
  const tip = drivechain.tipHeight();
  const from = window > 0 ? Math.max(drivechain.firstHeight(), tip - window + 1) : drivechain.firstHeight();
  const blocks = drivechain.range(from, tip).filter(b => b.miner);
  const n = blocks.length;
  const last = blocks[n - 1];

  // --- pools
  interface PoolAcc { tag: string; datum: boolean; blocks: number; fees: number; reward: number; empty: number; weight: number; bmm: number; work: number; lastHeight: number; miners: Map<string, number>; firstHeight: number }
  const pools = new Map<string, PoolAcc>();
  let work = 0, datumBlocks = 0, minDiffBlocks = 0, emptyBlocks = 0, fees = 0, reward = 0;
  for (const b of blocks) {
    const m = b.miner!;
    const tag = m.tag ?? 'Unknown';
    const p = pools.get(tag) ?? { tag, datum: false, blocks: 0, fees: 0, reward: 0, empty: 0, weight: 0, bmm: 0, work: 0, lastHeight: 0, miners: new Map(), firstHeight: b.height };
    const w = (m.difficulty ?? 1) * HASHES_PER_DIFFICULTY;
    p.blocks++; p.fees += m.fees; p.reward += m.reward; p.weight += m.weight ?? 0; p.bmm += b.bmm.length; p.work += w; p.lastHeight = b.height;
    if (m.txCount <= 1) { p.empty++; emptyBlocks++; }
    if (m.datum) {
      p.datum = true;
      datumBlocks++;
      const miner = m.minerTag || '(no tag)';
      p.miners.set(miner, (p.miners.get(miner) ?? 0) + 1);
    }
    if (m.minDifficulty) { minDiffBlocks++; }
    work += w; fees += m.fees; reward += m.reward;
    pools.set(tag, p);
  }
  const span = n > 1 ? last.time - blocks[0].time : 0;
  const hashrate = span > 0 ? work / span : 0;
  const poolList = [...pools.values()].sort((a, b) => b.blocks - a.blocks).map(p => ({
    tag: p.tag, datum: p.datum, blocks: p.blocks, share: n ? p.blocks / n : 0, workShare: work ? p.work / work : 0,
    hashrate: work ? hashrate * p.work / work : 0, fees: p.fees, reward: p.reward, empty: p.empty,
    avgWeight: p.blocks ? p.weight / p.blocks : 0, bmmPerBlock: p.blocks ? p.bmm / p.blocks : 0, lastHeight: p.lastHeight,
    miners: [...p.miners].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, blocks: count, share: n ? count / n : 0 })),
  }));
  const topTags = poolList.slice(0, TOP_POOLS).map(p => p.tag);

  // --- block times
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) { gaps.push(blocks[i].time - blocks[i - 1].time); }
  const histogram = [...BLOCK_TIME_BINS, Infinity].map((hi, i) => {
    const lo = i ? BLOCK_TIME_BINS[i - 1] : -Infinity;
    return { from: i ? lo : 0, to: hi === Infinity ? null : hi, count: gaps.filter(g => g > lo && g <= hi).length };
  });

  // --- series
  const per = Math.max(1, Math.ceil(n / BUCKETS));
  const series: any[] = [];
  for (let i = 0; i < n; i += per) {
    const chunk = blocks.slice(i, i + per);
    const t0 = chunk[0].time, t1 = chunk[chunk.length - 1].time;
    const prev = i > 0 ? blocks[i - 1].time : null;
    const spanB = prev !== null ? t1 - prev : t1 - t0;
    const w = chunk.reduce((a, b) => a + (b.miner!.difficulty ?? 1) * HASHES_PER_DIFFICULTY, 0);
    const normal = chunk.filter(b => !b.miner!.minDifficulty).map(b => b.miner!.difficulty);
    const byPool: Record<string, number> = {};
    for (const b of chunk) {
      const tag = topTags.includes(b.miner!.tag ?? 'Unknown') ? (b.miner!.tag ?? 'Unknown') : 'Other';
      byPool[tag] = (byPool[tag] ?? 0) + 1;
    }
    series.push({
      from: chunk[0].height, to: chunk[chunk.length - 1].height, time: t1, blocks: chunk.length, pools: byPool,
      hashrate: spanB > 0 ? w / spanB : null,
      difficulty: normal.length ? normal.reduce((a, x) => a + x, 0) / normal.length : null,
      blockTime: prev !== null ? spanB / chunk.length : (chunk.length > 1 ? spanB / (chunk.length - 1) : null),
      minDifficulty: chunk.filter(b => b.miner!.minDifficulty).length,
      datum: chunk.filter(b => b.miner!.datum).length,
      fees: chunk.reduce((a, b) => a + b.miner!.fees, 0),
    });
  }

  // --- difficulty per block (the newest 1500)
  const difficulty = blocks.slice(-1500).map(b => [b.height, b.miner!.difficulty, b.miner!.minDifficulty ? 1 : 0]);

  // --- halving epochs
  const epoch = Math.floor(tip / HALVING_INTERVAL);
  const nextHalving = (epoch + 1) * HALVING_INTERVAL;

  return {
    window, from, to: tip, blocks: n,
    totals: {
      hashrate, work, span, avgBlockTime: n > 1 ? span / (n - 1) : 0, medianBlockTime: median(gaps),
      pools: poolList.length, datumBlocks, datumShare: n ? datumBlocks / n : 0,
      datumMiners: new Set(blocks.filter(b => b.miner!.datum).map(b => b.miner!.minerTag || '(no tag)')).size,
      minDifficultyBlocks: minDiffBlocks, emptyBlocks, fees, reward,
      difficulty: last?.miner?.difficulty ?? null, minDifficultyTip: last?.miner?.minDifficulty ?? false,
      // the last block at the regular difficulty (not a test network's min-difficulty block)
      regularDifficulty: regular(blocks),
    },
    pools: poolList,
    topTags,
    series,
    histogram,
    difficulty,
    retarget: last ? retargetState(retarget, { height: last.height, time: last.time, difficulty: regular(blocks) ?? last.miner!.difficulty },
      drivechain.range(last.height - (last.height % RETARGET_INTERVAL), last.height - (last.height % RETARGET_INTERVAL))[0] ?? null) : null,
    halving: {
      epoch, subsidy: 50 / Math.pow(2, epoch), nextHalving, blocksLeft: nextHalving - tip,
      progress: (tip - epoch * HALVING_INTERVAL) / HALVING_INTERVAL, eta: last ? last.time + (nextHalving - tip) * BLOCK_SPACING : null,
    },
  };
}

/** The difficulty of the newest block not mined at a test network's minimum */
function regular(blocks: DrivechainBlock[]): number | null {
  return [...blocks].reverse().find(b => !b.miner!.minDifficulty)?.miner?.difficulty ?? null;
}

export type { DrivechainBlock };
