import { ChainFrontendModule, sidechainProfile } from '@app/chain/chain-module';

/** zSide: shielded payments (Zcash Orchard). */
const zside: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'zside', name: 'zSide', tagline: 'Shielded payments (Zcash Orchard)', slot: 6, color: '#f26b9c', bech32Main: 'zs',
    mark: ['M16 3.5l10 3.8v8.2c0 6.3-4.2 10.7-10 13-5.8-2.3-10-6.7-10-13V7.3z', 'M11.5 11.5h9l-9 9h9'],
  }),
  nav: [{ path: '/shielded', title: 'The shielded pool', icon: 'chain-mark' }],
  routes: [{ path: 'shielded', loadComponent: () => import('./shielded.page').then(m => m.ZsideShieldedPage) }],
  markers: [{
    tag: '5a4f5243', name: 'Orchard bundle', short: 'ZORC', help: 'A shielded Zcash Orchard bundle: who pays whom and how much stay private',
    describe: (p) => {
      // version, CompactSize action count (< 0xfd: one byte), 820 bytes per action, flags, valueBalance i64 LE
      const n = p[1];
      const at = 2 + n * 820 + 1;
      let v = 0;
      if (p.length >= at + 8) {
        const dv = new DataView(p.buffer, p.byteOffset + at, 8);
        v = Number(dv.getBigInt64(0, true));
      }
      const dir = v < 0 ? `shields ${(-v / 1e8).toFixed(8)} CHN` : v > 0 ? `unshields ${(v / 1e8).toFixed(8)} CHN` : 'fully shielded';
      return `Orchard bundle · ${n} action${n === 1 ? '' : 's'} · ${dir}`;
    },
  }],
};

export default zside;
