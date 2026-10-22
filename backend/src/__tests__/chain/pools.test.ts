import { normalizeTag, poolFor, poolLogo, poolName } from '../../chain/pools';

describe('mining pools', () => {
  it('matches a coinbase tag exactly or without its slashes', () => {
    expect(poolFor('/bip300xyz/')).toMatchObject({ name: 'bip300.xyz', logo: 'bip300xyz.svg' });
    expect(poolName('BIP300XYZ')).toBe('bip300.xyz');
    expect(poolFor('ePool')?.name).toBe('ePool');
    expect(poolFor('epool')?.name).toBe('ePool');
    expect(poolLogo('/powre/')).toBeNull();
  });

  it('shows an unknown tag without its slashes', () => {
    expect(poolName('/ecashpool.io/')).toBe('ecashpool.io');
    expect(poolName('/eCashFarm/')).toBe('eCashFarm');
    expect(poolLogo('/eCashFarm/')).toBeNull();
  });

  it('has no name or logo for a block that carries no tag', () => {
    expect(normalizeTag('///')).toBeNull();
    expect(poolName(null)).toBeNull();
    expect(poolLogo(undefined)).toBeNull();
  });
});
