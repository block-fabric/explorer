import { L2Chain } from './types';
import { SidechainRpcError } from './rpc';

/**
 * A signed tx a wallet posts (POST /api/v1/l2/tx, and upstream's POST /api/tx through the Core facade's
 * sendrawtransaction), handed to the node's public submit method (L2Chain.submit): the chain's serialized tx as hex
 * (Truthcoin's push_tx: borsh of the AuthorizedTransaction) or the node's Authorized tx JSON (submit_transaction:
 * Thunder, BitNames, BitAssets, zSide, Truthcoin). Nothing is checked here beyond the shape and size: the node
 * validates the tx.
 *
 * What the client gets back: {txid}; a 400 for a malformed request; a 400 "The node rejected the transaction" with
 * `reason`, the node's own JSON-RPC error text, when the node answered with a JSON-RPC error (its validation text:
 * "invalid transaction: …", "utxo … doesn't exist", "failed to deserialize …"), cleaned up (printable ASCII, no
 * addresses of hosts, URLs or paths, at most 200 characters); a 502 with no detail when the node did not answer
 * (timeouts, HTTP errors: those texts can name hosts and ports and stay in the log). A wallet needs the rejection
 * reason to tell a spent input from a bad signature or a low limit; the nodes' validation texts name only tx data.
 */

/** of the request body (hex: a tx of up to 32 KB) */
export const MAX_SUBMIT_BYTES = 64 * 1024;

export class SubmitError extends Error {
  constructor(public status: 400 | 404 | 502, message: string, public reason: string | null = null) {
    super(message);
  }
}

export type Submission = { hex: string } | { json: any };

const HEX = /^(?:[0-9a-fA-F]{2})+$/;

/**
 * A request body as a submission: hex text, {"hex": …}, or the node's Authorized tx JSON as it is,
 * {"transaction": {…}, "authorizations": [{verifying_key, signature}, …]} (Truthcoin's has `actor_proof` too)
 */
export function parseSubmission(body: unknown): Submission {
  if (typeof body === 'string') {
    return { hex: hexOf(body) };
  }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    if (typeof b.hex === 'string') {
      return { hex: hexOf(b.hex) };
    }
    if (b.transaction && typeof b.transaction === 'object' && !Array.isArray(b.transaction) && Array.isArray(b.authorizations)) {
      if (JSON.stringify(b).length > MAX_SUBMIT_BYTES) {
        throw new SubmitError(400, 'Transaction too large');
      }
      return { json: b };
    }
  }
  throw new SubmitError(400, 'Expected the transaction as hex (text/plain, or JSON {"hex": "…"}) or as the node\'s JSON '
    + '{"transaction": {…}, "authorizations": […]}');
}

function hexOf(s: string): string {
  const h = s.trim().replace(/^0x/i, '');
  if (!h || !HEX.test(h)) {
    throw new SubmitError(400, 'Invalid hex');
  }
  if (h.length > MAX_SUBMIT_BYTES) {
    throw new SubmitError(400, 'Transaction too large');
  }
  return h.toLowerCase();
}

/** The node's rejection text, safe to show: printable ASCII, no hosts, URLs or paths, at most 200 characters */
export function sanitizeReason(text: string): string | null {
  const t = String(text ?? '')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<host>')
    .replace(/\b(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|eu|local|internal)):\d+\b/gi, '<host>')
    .replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]*/g, ' <path>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) {
    return null;
  }
  return t.length > 200 ? t.slice(0, 199) + '…' : t;
}

/** Hand a submission to the node; its txid. @asyncUnsafe: throws SubmitError */
export async function submit(chain: L2Chain, rpc: { call(method: string, ...params: unknown[]): Promise<any> }, s: Submission): Promise<string> {
  if (!chain.submit) {
    throw new SubmitError(404, 'This explorer takes no transactions for this sidechain');
  }
  let method: string;
  let param: unknown;
  if ('hex' in s) {
    if (!chain.submit.hex) {
      throw new SubmitError(400, 'This sidechain\'s node takes the transaction as its JSON: {"transaction": {…}, "authorizations": […]}');
    }
    [method, param] = [chain.submit.hex, s.hex];
  } else {
    if (!chain.submit.json) {
      throw new SubmitError(400, 'This sidechain\'s node takes the transaction as hex');
    }
    [method, param] = [chain.submit.json, s.json];
  }
  let txid: unknown;
  try {
    txid = await rpc.call(method, param);
  } catch (e) {
    if (e instanceof SidechainRpcError && e.fromNode) {
      throw new SubmitError(400, 'The node rejected the transaction', sanitizeReason(e.reason));
    }
    throw new SubmitError(502, 'The sidechain node did not answer');
  }
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/i.test(txid)) {
    throw new SubmitError(502, 'The sidechain node did not answer');
  }
  return txid.toLowerCase();
}
