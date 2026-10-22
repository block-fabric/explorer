import { ChainFrontendModule } from '@app/chain/chain-module';
import ecash from './ecash';
import bitnames from './bitnames';
import bitassets from './bitassets';
import thunder from './thunder';
import hivemind from './hivemind';
import zside from './zside';
import coinshift from './coinshift';

/**
 * The chain modules this frontend knows; window.__env.CHAIN_PROFILE picks one (the first, eCash, by default).
 * The sidechains (kind 'l2') run on the L2 page set (chain/l2/); the backend has the matching modules in
 * backend/src/chain/modules/index.ts.
 */
export const MODULES: ChainFrontendModule[] = [
  ecash,
  bitnames,
  bitassets,
  thunder,
  hivemind,
  zside,
  coinshift,
];
