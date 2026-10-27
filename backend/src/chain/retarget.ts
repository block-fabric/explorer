import { BLOCK_SPACING, Network, NETWORK, RETARGET_INTERVAL } from './networks';

/**
 * eCash's difficulty retarget (ecash-com/bitcoin ecash-v1.1.0-core31.1, src/pow.cpp), per network:
 *
 *   below the fork block   Bitcoin's: every 2016 blocks, the measured timespan clamped to 1/4..4x of two weeks
 *   the fork block         the network's fork bits, whatever the measure (mainnet: difficulty 2.6e9, betanet: 1e9)
 *   from the fork block    mainnet: every 288 blocks, dampened: the new target is (6 x the old one + the measured one)
 *                          / 7, the measured timespan clamped to 1/4..4x of 288 blocks and taken from the last block
 *                          of the previous window (never before the fork block): from about -30% to +12% each time;
 *                          betanet: Bitcoin's
 */

/** The retarget interval in force for the block at `height` */
export function interval(height: number, net: Network = NETWORK): number {
  return net.fork?.interval && height >= net.fork.height ? net.fork.interval : RETARGET_INTERVAL;
}

/** Whether the block at `height` may change the difficulty (a retarget, or the fork's reset) */
export function isRetarget(height: number, net: Network = NETWORK): boolean {
  return height > 0 && height % interval(height, net) === 0;
}

/** The first block of the retarget period `height` is in */
export function periodStart(height: number, net: Network = NETWORK): number {
  return height - (height % interval(height, net));
}

/** The next retarget after the block at `height` (the fork block is one: a 2016-block boundary) */
export function nextRetarget(height: number, net: Network = NETWORK): number {
  return periodStart(height, net) + interval(height, net);
}

/** The difficulty of compact bits */
export function bitsToDifficulty(bits: number): number {
  const exp = bits >>> 24;
  const mantissa = bits & 0x007fffff;
  return (0xffff / mantissa) * Math.pow(256, 0x1d - exp);
}

/** The fork block's difficulty, if `height` is a network's fork block */
export function forkDifficulty(height: number, net: Network = NETWORK): number | null {
  return net.fork && height === net.fork.height ? bitsToDifficulty(net.fork.bits) : null;
}

/**
 * The difficulty change (new / old) the retarget at `next` makes when the blocks of its window come every `pace`
 * seconds on average; `difficulty` the current one (for the fork's reset)
 */
export function estimateFactor(next: number, pace: number, difficulty: number, net: Network = NETWORK): number {
  const fork = forkDifficulty(next, net);
  if (fork !== null) {
    return difficulty > 0 ? fork / difficulty : 1;
  }
  const n = interval(next, net);
  const dampened = n !== RETARGET_INTERVAL;
  // the measured timespan over the expected one: Bitcoin's window has 2015 intervals, the dampened one 288 (287 for
  // the first, which starts at the fork block)
  const intervals = dampened ? (next - 1) - Math.max(next - 1 - n, net.fork!.height) : n - 1;
  const ratio = Math.max(0.25, Math.min(4, (pace * intervals) / (n * BLOCK_SPACING)));
  return dampened ? 7 / (6 + ratio) : 1 / ratio;
}

/**
 * The change of difficulty from compact bits to compact bits, in percent (21.3: 21.3% harder); any two bits, unlike
 * upstream's calcBitsDifference (one retarget of Bitcoin's apart): the fork's reset may cross several exponents
 */
export function bitsChange(oldBits: number, newBits: number): number {
  return (bitsToDifficulty(newBits) / bitsToDifficulty(oldBits) - 1) * 100;
}
