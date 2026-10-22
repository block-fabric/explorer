import config from '../config';
import { ChainModule, ChainProfile } from './module';
import { MODULES } from './modules';

/**
 * The chain this backend instance explores: CHAIN.PROFILE picks one of the chain modules (chain/modules/index.ts).
 * Several instances (one per profile, each with its own node, database and port) can run side by side.
 */

export type { ChainProfile } from './module';

function resolve(): ChainModule {
  const id = (config.CHAIN?.PROFILE || 'ecash').toLowerCase();
  const m = MODULES.find(x => x.profile.id === id);
  if (!m) {
    throw new Error(`Unknown CHAIN.PROFILE '${config.CHAIN?.PROFILE}'. Known: ${MODULES.map(x => x.profile.id).join(', ')}`);
  }
  return m;
}

export const MODULE: ChainModule = resolve();
export const PROFILE: ChainProfile = MODULE.profile;

/** The sidechains this explorer has a module for, in slot order */
export const SIDECHAIN_PROFILES: ChainProfile[] = MODULES.map(m => m.profile)
  .filter(p => !p.mainchain)
  .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

export function profileBySlot(slot: number): ChainProfile | undefined {
  return SIDECHAIN_PROFILES.find(p => p.slot === slot) ?? (PROFILE.slot === slot ? PROFILE : undefined);
}

export const isMainchain = (): boolean => PROFILE.mainchain;
