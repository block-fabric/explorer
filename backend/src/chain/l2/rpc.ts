import axios from 'axios';
import config from '../../config';

/**
 * The sidechain node's read RPC (CHAIN.SIDECHAIN_RPC): plain JSON-RPC 2.0, a POST to the root, no auth. At most
 * MAX_CONCURRENT calls run at once: the betanet nodes are small machines and also serve their own peers.
 * Only read methods are called (chains/L2-NODES.md), and the public submit method of a signed tx a client posts
 * (POST /api/v1/l2/tx, the Core facade's sendrawtransaction: submit.ts); never a wallet, mining or other write method.
 */

export class SidechainRpcError extends Error {
  /**
   * @param fromNode the node answered with a JSON-RPC error (it rejected the call; `reason` is its text), rather than
   *   an HTTP error or no JSON-RPC reply
   */
  constructor(public method: string, public code: number | string, public reason: string, public fromNode = false) {
    super(`${method}: ${reason}`);
  }
}

class SidechainRpc {
  private active = 0;
  private queue: (() => void)[] = [];
  private id = 0;

  private async slot(): Promise<void> {
    if (this.active < Math.max(1, config.CHAIN.SIDECHAIN_RPC.MAX_CONCURRENT)) {
      this.active++;
      return;
    }
    await new Promise<void>(resolve => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // the slot passes straight to the next caller
    } else {
      this.active--;
    }
  }

  async call<T = any>(method: string, ...params: unknown[]): Promise<T> {
    return this.callLimited<T>(method, -1, ...params);
  }

  /** As call(), refusing a reply larger than maxBytes (-1: no limit): for lookups whose size others can drive up */
  async callLimited<T = any>(method: string, maxBytes: number, ...params: unknown[]): Promise<T> {
    await this.slot();
    try {
      const res = await axios.post(config.CHAIN.SIDECHAIN_RPC.URL, { jsonrpc: '2.0', id: ++this.id, method, params }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: config.CHAIN.SIDECHAIN_RPC.TIMEOUT,
        maxContentLength: maxBytes,
        validateStatus: () => true,
      });
      const body = res.data;
      if (body?.error) {
        throw new SidechainRpcError(method, body.error.code ?? res.status, String(body.error.message ?? 'error') + (body.error.data ? `: ${body.error.data}` : ''), true);
      }
      if (res.status !== 200 || !body || !('result' in body)) {
        throw new SidechainRpcError(method, res.status, `HTTP ${res.status}`);
      }
      return body.result as T;
    } finally {
      this.release();
    }
  }
}

export default new SidechainRpc();
