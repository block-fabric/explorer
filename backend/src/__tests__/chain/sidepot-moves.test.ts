import bs58 from 'bs58';
import { decodeEntry } from '../../chain/sidepot-moves';

// entries signed by an independent BIP340 signer (the BIP's reference code) for slot 88 and its anchor, mainnet
// block 982,723 (sidepot-node --game-anchor)
const F: { anchor: string; player: string; buy: string; cashout: string } = require('./sidepot-entries.json');
const domain = (slot: number) => Buffer.concat([Buffer.from(F.anchor, 'hex').reverse(), Buffer.from([slot])]);

describe('Sidepot entries', () => {
  test('a buy', () => {
    expect(decodeEntry(F.buy, domain(88))).toEqual({
      kind: 'buy', player: F.player, nonce: 7, expires: 40000, round: 3, keys: 5, maxPrice: 120000, signed: true,
    });
  });

  test('a cashout', () => {
    expect(decodeEntry(F.cashout, domain(88))).toEqual({
      kind: 'cashout', player: F.player, nonce: 8, expires: 40010, amount: 2500000,
      dest: bs58.encode(Buffer.from([...Array(20).keys()])), signed: true,
    });
  });

  test('signed for another slot, or changed: not signed', () => {
    expect(decodeEntry(F.buy, domain(9))?.signed).toBe(false);
    const changed = F.buy.slice(0, 20) + (F.buy[20] === '0' ? '1' : '0') + F.buy.slice(21); // the round's first byte
    expect(decodeEntry(changed, domain(88))?.signed).toBe(false);
  });

  test('other scripts: none', () => {
    expect(decodeEntry('6a0b68656c6c6f20776f726c64', domain(88))).toBeNull();
    expect(decodeEntry(F.buy.slice(0, -2), domain(88))).toBeNull(); // a length that does not match
    expect(decodeEntry('0014' + '00'.repeat(20), domain(88))).toBeNull();
  });
});

// sidepot-core tests/game.rs deposit_player: 64 hex characters of an x-only key, in any case; anything else is an
// ordinary address
describe('Sidepot game deposits', () => {
  // (required here, not imported at the top: the module registry it sits in loads every chain's module)
  const { gameAccountOf } = require('../../chain/modules/sidepot');
  test('spot:<key>', () => {
    expect(gameAccountOf('spot:' + F.player)).toBe(F.player);
    expect(gameAccountOf('spot:' + F.player.toUpperCase())).toBe(F.player);
  });
  test('not a game account', () => {
    expect(gameAccountOf('spot:' + F.player.slice(2))).toBeNull();
    expect(gameAccountOf('spot:' + '0'.repeat(64))).toBeNull();
    expect(gameAccountOf(F.player)).toBeNull();
    expect(gameAccountOf('4rt6ZRSqmGbcZ9SeF3pE9EEcSJbD')).toBeNull();
  });
});
