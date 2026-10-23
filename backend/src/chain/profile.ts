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

/**
 * A sidechain whose own node speaks Bitcoin Core's RPC (Flush, FreeBank): upstream mempool runs on it directly, without
 * the eCash drivechain index, and the module serves its own routes
 */
export const nodeSidechain = (): boolean => PROFILE.kind === 'flush' || PROFILE.kind === 'freebank';

/**
 * What this backend runs for a sidechain (CHAIN.L2_ROLE): 'index' = the sidechain index, its routes and the Core
 * JSON-RPC view (chain/l2/); 'full' = upstream mempool's backend reading that view as its node. Null: the mainchain.
 */
export function l2Role(): 'index' | 'full' | null {
  if (PROFILE.kind !== 'l2') {
    return null;
  }
  const role = config.CHAIN?.L2_ROLE ?? 'index';
  if (role !== 'index' && role !== 'full') {
    throw new Error(`CHAIN.L2_ROLE must be 'index' or 'full', not '${role}'`);
  }
  return role;
}
