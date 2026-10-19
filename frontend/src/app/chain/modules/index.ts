import { ChainFrontendModule } from '@app/chain/chain-module';
import chains from './chains';
import thunder from './thunder';
import bitnames from './bitnames';
import bitassets from './bitassets';
import fastblocks from './fastblocks';
import zside from './zside';
import hivemind from './hivemind';
import layers from './layers';
import sidechainTemplate from './sidechain-template';

/**
 * The chain modules this frontend knows; window.__env.CHAIN_PROFILE picks one (the first, Chains, by default).
 * To add a sidechain: copy sidechain-template/ to <id>/, edit it, and add it here (and on the backend,
 * backend/src/chain/modules/index.ts). See chains/MODULES.md.
 */
export const MODULES: ChainFrontendModule[] = [
  chains,
  thunder,
  bitnames,
  bitassets,
  fastblocks,
  zside,
  hivemind,
  layers,
  sidechainTemplate,
];
