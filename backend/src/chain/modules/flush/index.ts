import config from '../../../config';
import { ChainModule } from '../../module';

/**
 * Flush (ECX), a drivechain sidechain of eCash (backbone-flush, flushd): blocks of stake every 15 s, BMM anchors,
 * assets, a DEX, launches. Its explorer (kind flush) has one data source: the node's public DEX API (flushd
 * -publicapi), read on an allowlist (routes.ts, chains/FLUSH-API.md); the node's RPC is not reachable from it. Its slot
 * is 46 on the eCash networks; betanet runs it on slot 99 for now (CHAIN.FLUSH.SLOT).
 */
const flush: ChainModule = {
  profile: {
    id: 'flush', kind: 'flush', name: 'Flush', unit: 'ECX', slot: config.CHAIN.FLUSH?.SLOT ?? 46, mainchain: false, subsidy: false,
  },
};

export default flush;
