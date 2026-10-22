import { ChainModule } from '../../module';

/**
 * eCash (ECX), the mainchain: a fork of Bitcoin with BIP300/BIP301 drivechains, enforced by a bip300301_enforcer next
 * to eCash's node or by Backbone. Its drivechain views (BMM, deposits, withdrawals, votes, proposals) are the core's
 * drivechain index (chain/drivechain.ts), served at /api/v1/drivechain/*.
 */
const ecash: ChainModule = {
  profile: { id: 'ecash', kind: 'l1', name: 'eCash', unit: 'ECX', slot: null, mainchain: true, subsidy: true },
};

export default ecash;
