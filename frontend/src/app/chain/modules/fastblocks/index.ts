import { ChainFrontendModule, MarkerLabel, sidechainProfile } from '@app/chain/chain-module';

export const FASTBLOCKS_MARKERS: MarkerLabel[] = [
    { tag: 'db53544b', name: 'Validator bond', short: 'BOND', help: 'Stake bonded to a validator; the amount is this output\'s value',
      describe: (p) => 'Validator bond · key ' + Array.from(p.subarray(0, 4), x => x.toString(16).padStart(2, '0')).join('') + '…' },
    { tag: 'dc554e42', name: 'Validator unbond', short: 'UNBOND', help: 'Stake unbonded from a validator',
      describe: (p) => 'Validator unbond · key ' + Array.from(p.subarray(0, 4), x => x.toString(16).padStart(2, '0')).join('') + '…' },
    { tag: 'dd455644', name: 'Double-proposal evidence', short: 'EVID' },
    { tag: 'de504f54', name: 'Fee pot', short: 'POT' },
  ];

/** FastBlocks: blocks of stake every 15 seconds, finalized by merged mining. */
const fastblocks: ChainFrontendModule = {
  profile: sidechainProfile({
    id: 'fastblocks', name: 'FastBlocks', tagline: 'Blocks of stake every 15 seconds, finalized by merged mining', slot: 5, color: '#ff8a3d', bech32Main: 'fbl',
    mark: ['M6 18a10 10 0 1 0 20 0a10 10 0 1 0-20 0', 'M13 3.5h6', 'M16 3.5V8', 'M24.2 9.8l1.8-1.8', 'M17.5 11.5l-5 7.5h4l-1.5 5.5 5-7.5h-4z'],
    blockWeightUnits: 1500000, pos: true,
  }),
  nav: [{ path: '/validators', title: 'Validators, finality and evidence', icon: 'chain-mark' }],
  routes: [{ path: 'validators', loadComponent: () => import('./validators.page').then(m => m.FastblocksValidatorsPage) }],
  markers: FASTBLOCKS_MARKERS,
};

export default fastblocks;
