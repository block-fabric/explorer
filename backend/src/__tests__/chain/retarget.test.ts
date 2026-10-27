import { NETWORKS } from '../../chain/networks';
import { bitsChange, bitsToDifficulty, estimateFactor, forkDifficulty, interval, isRetarget, nextRetarget, periodStart } from '../../chain/retarget';

// eCash's retarget (ecash-v1.1.0-core31.1, src/pow.cpp): Bitcoin's up to the fork block, its fixed bits there, then
// mainnet's dampened 288-block retarget; betanet keeps Bitcoin's after its fork.

const main = NETWORKS.ecash;
const beta = NETWORKS.ecashbeta;
const testnet = NETWORKS.ecashtest;
const FORK = 973728;

describe('eCash retarget', () => {
  test('periods around mainnet\'s fork', () => {
    expect(interval(FORK - 1, main)).toBe(2016);
    expect(interval(FORK, main)).toBe(288);
    expect(periodStart(FORK - 1, main)).toBe(FORK - 2016);
    expect(nextRetarget(FORK - 1, main)).toBe(FORK);
    expect(nextRetarget(973429, main)).toBe(FORK);
    expect(periodStart(FORK, main)).toBe(FORK);
    expect(nextRetarget(FORK, main)).toBe(FORK + 288);
    expect(nextRetarget(FORK + 300, main)).toBe(FORK + 576);
    expect(isRetarget(FORK, main)).toBe(true);
    expect(isRetarget(FORK + 288, main)).toBe(true);
    expect(isRetarget(FORK + 144, main)).toBe(false);
    // betanet and testnet: Bitcoin's 2016 blocks throughout
    expect(nextRetarget(967680 + 300, beta)).toBe(967680 + 2016);
    expect(isRetarget(967680 + 288, beta)).toBe(false);
    expect(nextRetarget(100, testnet)).toBe(2016);
  });

  test('difficulty of compact bits; the forks\' fixed difficulties', () => {
    expect(bitsToDifficulty(0x1d00ffff)).toBeCloseTo(1, 10);
    expect(forkDifficulty(FORK, main)! / 2.6e9).toBeCloseTo(1, 2);
    expect(forkDifficulty(967680, beta)! / 1e9).toBeCloseTo(1, 2);
    expect(forkDifficulty(FORK + 288, main)).toBeNull();
    expect(forkDifficulty(FORK, testnet)).toBeNull();
  });

  test('estimated change at the next retarget', () => {
    // the fork block: its fixed difficulty, whatever the pace
    expect(estimateFactor(FORK, 600, 1.5e14, main)).toBeCloseTo(forkDifficulty(FORK, main)! / 1.5e14, 20);
    // dampened: (6 x old + measured) / 7 on the target, the measure clamped to 1/4..4x
    expect(estimateFactor(FORK + 576, 600, 1, main)).toBeCloseTo(1, 10);
    expect(estimateFactor(FORK + 576, 300, 1, main)).toBeCloseTo(7 / 6.5, 10);
    expect(estimateFactor(FORK + 576, 6000, 1, main)).toBeCloseTo(0.7, 10);
    expect(estimateFactor(FORK + 576, 1, 1, main)).toBeCloseTo(7 / 6.25, 10);
    // the first window after the fork measures 287 intervals
    expect(estimateFactor(FORK + 288, 600, 1, main)).toBeCloseTo(7 / (6 + 287 / 288), 10);
    // Bitcoin's: 2015 intervals against two weeks, at most 4x either way
    expect(estimateFactor(967680 + 2016 * 2, 300, 1, beta)).toBeCloseTo(1 / (300 * 2015 / (2016 * 600)), 10);
    expect(estimateFactor(967680 + 2016 * 2, 100000, 1, beta)).toBe(0.25);
  });

  test('a change of bits across exponents (the fork\'s reset)', () => {
    expect(() => bitsChange(0x17022d5f, 0x1901a6e1)).not.toThrow();
    expect(bitsChange(0x17022d5f, 0x1901a6e1)).toBeLessThan(-99.99);
    expect(bitsChange(0x1d00ffff, 0x1d00ffff)).toBe(0);
  });
});
