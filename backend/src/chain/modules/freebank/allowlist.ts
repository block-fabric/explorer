import { parseArgsFor } from '../flush/allowlist';

/**
 * The FreeBank node's read RPCs a visitor may call (freebank src/rpc/misc.cpp), with how many arguments each takes at
 * most. No wallet method, nothing that makes a transaction. The node's RPC filter (on the lab node, in front of
 * freebankd, which has no rpcwhitelist) allows these and what upstream mempool calls; keep the two lists in step.
 */
export const RPC_METHODS: Record<string, { args: number }> = {
  // chain and peg
  getblockchaininfo: { args: 0 },
  getmainchaininfo: { args: 0 },
  getmainchainblockcount: { args: 0 },
  getwithdrawal: { args: 1 },             // id
  getwithdrawalbundle: { args: 0 },
  getaveragemainchainfees: { args: 2 },   // numblocks startheight
  // discount houses
  listhouses: { args: 0 },
  gethouse: { args: 1 },                  // id
  listhousemembers: { args: 3 },          // id [start count]
  gettokenclaims: { args: 3 },            // id [start count]
  // bills of exchange
  listbills: { args: 0 },
  getbill: { args: 1 },                   // id
  listloanbook: { args: 1 },              // [house_id]
  // pools, assets, the gold fix
  listpools: { args: 0 },
  getpool: { args: 1 },                   // id (= the house id)
  listassets: { args: 2 },                // [from_asset_id count]
  getgoldfix: { args: 0 },
  listoraclesubmitters: { args: 0 },
};

/** The arguments of an allowlisted FreeBank method from the `args` query parameter (as Flush's parseRpcArgs) */
export function parseRpcArgs(method: string, text: unknown): unknown[] {
  return parseArgsFor(RPC_METHODS, method, text);
}
