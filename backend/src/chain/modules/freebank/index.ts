import { ChainModule } from '../../module';

/**
 * FreeBank (ECX), a drivechain sidechain of eCash on slot 130 (mbdrivechains/freebank, freebankd: a Bitcoin Core 0.16
 * base): blocks by blind merged mining, discount houses, bills of exchange, notes, term deposits, settlements. Its
 * explorer (kind freebank) runs upstream mempool on the FreeBank node (CORE_RPC) and serves the node's read RPCs for
 * houses, bills and the rest on an allowlist (routes.ts, chains/FREEBANK-API.md).
 */
const freebank: ChainModule = {
  profile: {
    id: 'freebank', kind: 'freebank', name: 'FreeBank', unit: 'ECX', slot: 130, mainchain: false, subsidy: false,
  },
};

export default freebank;
