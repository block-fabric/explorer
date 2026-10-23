import { ChainFrontendModule } from '@app/chain/chain-module';
import ecash from './ecash';
import bitnames from './bitnames';
import bitassets from './bitassets';
import thunder from './thunder';
import truthcoin from './truthcoin';
import zside from './zside';
import coinshift from './coinshift';
import flush from './flush';
import freebank from './freebank';

/**
 * The chain modules this frontend knows; window.__env.CHAIN_PROFILE picks one (the first, eCash, by default).
 * The sidechains (kind 'l2') run on the L2 page set (chain/l2/), Flush (kind 'flush') and FreeBank (kind 'freebank') on upstream's full UI; the backend has the matching modules in
 * backend/src/chain/modules/index.ts.
 */
export const MODULES: ChainFrontendModule[] = [
  ecash,
  bitnames,
  bitassets,
  thunder,
  truthcoin,
  zside,
  coinshift,
  flush,
  freebank,
];
