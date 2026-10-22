import { ChainFrontendModule } from '@app/chain/chain-module';
import ecash from './ecash';

/**
 * The chain modules this frontend knows; window.__env.CHAIN_PROFILE picks one (the first, eCash, by default).
 * Sidechain explorers get their own modules here (and on the backend, backend/src/chain/modules/index.ts).
 */
export const MODULES: ChainFrontendModule[] = [
  ecash,
];
