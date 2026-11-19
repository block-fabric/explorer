import { route } from '../../chain/usage';

describe('API usage routes', () => {
  test('ids, heights and addresses folded', () => {
    expect(route('/api/v1/blocks/920150')).toBe('/api/v1/blocks/:n');
    expect(route('/api/block/' + 'ab'.repeat(32) + '/txs/25?x=1')).toBe('/api/block/:hash/txs/:n');
    expect(route('/api/address/bc1qgyktcfxkqwt7tl7zpxjn0hxt7274fwysf7f9ec/txs')).toBe('/api/address/:address/txs');
    expect(route('/api/v1/drivechain/blocks?height=984000')).toBe('/api/v1/drivechain/blocks');
  });
});
