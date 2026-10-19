/**
 * Where a transaction is: txid -> block hash, for nodes whose txindex cannot find some transactions.
 *
 * FastBlocks and Layers (and any chain with an extended block header) have a txindex that records transaction
 * offsets as if every header were 80 bytes (src/index/txindex.cpp: BLOCK_HEADER_SIZE); a block of stake has a 176-byte
 * header, so `getrawtransaction <txid>` answers "No such mempool or blockchain transaction" for every transaction in
 * one. Given the block (`getrawtransaction <txid> true <blockhash>`) the node finds it. The backend's RPC client
 * (api/bitcoin/bitcoin-client.ts) retries a failed lookup with the block from here, which every block read fills in,
 * and the address index (which reads every block) answers for the rest.
 */

const MAX = 500000;
const hints = new Map<string, string>();
let fallback: ((txid: string) => string | undefined) | null = null;

export function rememberBlockTxs(blockHash: string, txs: any[]): void {
  for (const t of txs ?? []) {
    const txid = typeof t === 'string' ? t : t?.txid;
    if (!txid) { continue; }
    hints.delete(txid);
    hints.set(txid, blockHash);
  }
  while (hints.size > MAX) {
    hints.delete(hints.keys().next().value as string);
  }
}

export function blockOfTx(txid: string): string | undefined {
  return hints.get(txid) ?? fallback?.(txid);
}

/** a further source of txid -> block hash (the address index) */
export function setTxLocatorFallback(f: (txid: string) => string | undefined): void {
  fallback = f;
}

/**
 * Wrap a node RPC client: getblock remembers the block of each transaction; getrawtransaction without a block hash
 * retries with the remembered one when the node cannot find the transaction.
 */
export function withTxLocator(client: any): any {
  const getBlock = client.getBlock.bind(client);
  const getRaw = client.getRawTransaction.bind(client);
  client.getBlock = async (hash: string, verbosity?: number, ...rest: any[]) => {
    const b = await getBlock(hash, verbosity, ...rest);
    if (b && typeof b === 'object' && Array.isArray(b.tx)) {
      rememberBlockTxs(b.hash ?? hash, b.tx);
    }
    return b;
  };
  client.getRawTransaction = async (txid: string, verbose?: any, blockhash?: string, ...rest: any[]) => {
    try {
      return await getRaw(txid, verbose, ...(blockhash ? [blockhash, ...rest] : rest));
    } catch (e: any) {
      const hint = !blockhash && e?.code === -5 ? blockOfTx(txid) : undefined;
      if (!hint) { throw e; }
      const tx = await getRaw(txid, verbose === undefined ? false : verbose, hint);
      // the node adds in_active_chain when given a block; the rest of the answer is the same
      if (tx && typeof tx === 'object') { delete tx.in_active_chain; }
      return tx;
    }
  };
  return client;
}
