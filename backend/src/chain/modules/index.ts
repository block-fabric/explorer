import { ChainModule } from '../module';
import ecash from './ecash';
import thunder from './thunder';
import bitnames from './bitnames';
import bitassets from './bitassets';
import hivemind from './hivemind';
import zside from './zside';
import coinshift from './coinshift';

/**
 * The chain modules this backend knows; CHAIN.PROFILE picks one. Each has its folder here and its counterpart on the
 * frontend (frontend/src/app/chain/modules/index.ts). See chains/MODULES.md.
 */
export const MODULES: ChainModule[] = [
  ecash,
  // the sidechains (kind l2, chain/l2/)
  bitnames,
  bitassets,
  thunder,
  hivemind,
  zside,
  coinshift,
];
