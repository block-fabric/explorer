import { bitcoinPoolFor, poolIds, poolsJson, poolsSha } from '../../chain/pools';
import poolsParser from '../../api/pools-parser';

// The eCash pool list as upstream's block attribution sees it (tasks/pools-updater.ts imports it). CHAIN.NETWORK
// defaults to ecashbeta.
describe('eCash pools for upstream attribution', () => {
  it('matches a pool by its coinbase tag, slashes and dots taken literally', () => {
    poolsParser.setMiningPools(poolsJson());
    const pools = poolsParser.miningPools;
    const coinbase = (text: string) => '03aaaaaa' + Buffer.from(text).toString('hex');
    expect(poolsParser.matchBlockMiner(coinbase('hello /ecpool.tech/ world'), [], pools)?.name).toBe('eCPool.tech');
    expect(poolsParser.matchBlockMiner(coinbase('/powre/'), [], pools)?.name).toBe('Pow.re');
    // '.' is not a wildcard: 'ecpoolxtech' is not eCPool.tech
    expect(poolsParser.matchBlockMiner(coinbase('/ecpoolxtech/'), [], pools)).toBeUndefined();
  });

  it("attributes Bitcoin's blocks (betanet and mainnet carry Bitcoin's history) with mempool's list", () => {
    poolsParser.setMiningPools(poolsJson());
    const pools = poolsParser.miningPools;
    const coinbase = (text: string) => '03aaaaaa' + Buffer.from(text).toString('hex');
    expect(poolsParser.matchBlockMiner(coinbase('/Foundry USA Pool #dropgold/'), [], pools)?.name).toBe('Foundry USA');
    expect(poolsParser.matchBlockMiner(coinbase('Mined by AntPool'), [], pools)?.name).toBe('AntPool');
    // eCash's own pools come first, and keep their ids
    expect(poolsJson()[0].id).toBeGreaterThan(100000);
    expect(new Set(poolIds()).size).toBe(poolIds().length);
    // the drivechain index's matcher: by tag, else by payout address
    expect(bitcoinPoolFor('/ViaBTC/Mined by destra/', [])?.name).toBe('ViaBTC');
    expect(bitcoinPoolFor('no tag here', ['12dRugNcdxK39288NjcDV4GX7rMsKCGn6B'])?.name).toBe('AntPool');
    expect(bitcoinPoolFor('/ePool/', [])).toBeNull();
  });

  it('stamps the list with a stable version', () => {
    expect(poolsSha()).toMatch(/^[0-9a-f]{40}$/);
    expect(poolsSha()).toBe(poolsSha());
  });
});
