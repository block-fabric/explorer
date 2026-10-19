import config from '../../config';
const bitcoin = require('../../rpc-api/index');
import { BitcoinRpcCredentials } from './bitcoin-api-abstract-factory';
import { withTxLocator } from '../../chain/tx-locator';

const nodeRpcCredentials: BitcoinRpcCredentials = {
  host: config.CORE_RPC.HOST,
  port: config.CORE_RPC.PORT,
  user: config.CORE_RPC.USERNAME,
  pass: config.CORE_RPC.PASSWORD,
  timeout: config.CORE_RPC.TIMEOUT,
  cookie: config.CORE_RPC.COOKIE ? config.CORE_RPC.COOKIE_PATH : undefined,
};

// Chains Explorer: finds the transactions of blocks of stake, which the FastBlocks/Layers txindex misses (chain/tx-locator.ts)
export default withTxLocator(new bitcoin.Client(nodeRpcCredentials));
