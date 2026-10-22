import { ChainModule } from '../module';
import ecash from './ecash';

/**
 * The chain modules this backend knows; CHAIN.PROFILE picks one. Each has its folder here and its counterpart on the
 * frontend (frontend/src/app/chain/modules/index.ts). See chains/MODULES.md.
 */
export const MODULES: ChainModule[] = [
  ecash,
];
