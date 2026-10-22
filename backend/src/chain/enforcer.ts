import axios from 'axios';
import config from '../config';

/**
 * The BIP300/301 enforcer's ValidatorService (cusf.mainchain.v1), read over Connect-JSON: a plain HTTP POST of the
 * request as JSON to <url>/cusf.mainchain.v1.ValidatorService/<Method>. Two servers speak it identically: the
 * bip300301_enforcer next to a stock eCash node, and Backbone (backboned -grpc), which serves it itself.
 *
 * Replies are proto3 JSON: fields at their default value are left out (a vout of 0, a sequence number of 0), 64-bit
 * integers are strings, and hashes come in two byte orders. ReverseHex (block hashes, txids) is already in display
 * order; ConsensusHex (M6 ids, BMM commitments) is in internal order and is reversed here, so every hash this module
 * returns is in the display order the node's RPCs and chain/bip300.ts use.
 *
 * At most CHAIN.ENFORCER.MAX_CONCURRENT calls run at once: on the pool server the enforcer and its node also serve
 * the pool's block templates.
 */

const SERVICE = 'cusf.mainchain.v1.ValidatorService';

export interface HeaderInfo {
  hash: string;
  prevHash: string;
  height: number;
  time: number;
}

export interface SidechainInfo {
  slot: number;
  title: string | null;           // null: a declaration of an unknown version
  description: string | null;
  voteCount: number;
  proposalHeight: number;
  activationHeight: number;
  hashId1: string | null;
  hashId2: string | null;
}

export interface ChainInfo {
  network: string;                // the enforcer's name for it (betanet reports NETWORK_MAINNET)
  activationHeight: number;       // BIP300 is enforced from this height; below it is plain Bitcoin history
  bundleMaxAge: number;
  bundleThreshold: number;
  usedSlotProposalMaxAge: number;
  usedSlotThreshold: number;
  unusedSlotProposalMaxAge: number;
  unusedSlotThreshold: number;
}

export interface PegDeposit {
  sequence: number;               // the escrow's sequence number after this deposit
  txid: string;
  vout: number;
  address: string;                // hex: the sidechain destination as written in the deposit
  amount: number;                 // sats
}

export interface BundleEvent {
  m6id: string;
  kind: 'submitted' | 'succeeded' | 'failed';
  sequence?: number;              // succeeded: the escrow's sequence number after the payout
  transaction?: string;           // succeeded: the M6 transaction, raw hex
}

export interface PegBlock {
  header: HeaderInfo;
  bmmCommitment: string | null;   // the sidechain block this mainchain block accepted (M7)
  deposits: PegDeposit[];
  bundleEvents: BundleEvent[];
}

export interface Ctip {
  txid: string;
  vout: number;
  amount: number;                 // sats in the escrow
  sequence: number;
}

export interface BundleProposal {
  m6id: string;
  voteCount: number;
  proposalHeight: number;
}

export interface SidechainProposal {
  slot: number;
  title: string | null;
  description: string | null;
  hash: string;                   // sha256d of the M1 description: what an M2 acks
  voteCount: number;
  proposalHeight: number;
  proposalAge: number;
}

export class EnforcerError extends Error {
  constructor(public method: string, public code: string, message: string) {
    super(`${method}: ${code}: ${message}`);
  }
}

const num = (v: unknown): number => v === undefined || v === null ? 0 : Number(v);
const display = (h: { hex?: string } | undefined): string => h?.hex ?? '';
const consensus = (h: { hex?: string } | undefined): string => h?.hex ? Buffer.from(h.hex, 'hex').reverse().toString('hex') : '';
const reverseHex = (hash: string) => ({ hex: hash });

function header(h: any): HeaderInfo {
  return { hash: display(h?.blockHash), prevHash: display(h?.prevBlockHash), height: num(h?.height), time: num(h?.timestamp) };
}

function pegBlock(headerInfo: any, blockInfo: any): PegBlock {
  const deposits: PegDeposit[] = [];
  const bundleEvents: BundleEvent[] = [];
  for (const e of blockInfo?.events ?? []) {
    if (e.deposit) {
      const d = e.deposit;
      deposits.push({
        sequence: num(d.sequenceNumber), txid: display(d.outpoint?.txid), vout: num(d.outpoint?.vout),
        address: d.output?.address?.hex ?? '', amount: num(d.output?.valueSats),
      });
    } else if (e.withdrawalBundle) {
      const w = e.withdrawalBundle;
      const ev = w.event ?? {};
      const kind = ev.succeeded ? 'succeeded' : ev.failed ? 'failed' : 'submitted';
      bundleEvents.push({
        m6id: consensus(w.m6id), kind,
        ...(ev.succeeded ? { sequence: num(ev.succeeded.sequenceNumber), transaction: ev.succeeded.transaction?.hex } : {}),
      });
    }
  }
  return {
    header: header(headerInfo),
    bmmCommitment: blockInfo?.bmmCommitment ? consensus(blockInfo.bmmCommitment) : null,
    deposits, bundleEvents,
  };
}

class Enforcer {
  private active = 0;
  private queue: (() => void)[] = [];

  private async slot(): Promise<void> {
    if (this.active < Math.max(1, config.CHAIN.ENFORCER.MAX_CONCURRENT)) {
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

  async call<T = any>(method: string, request: object = {}): Promise<T> {
    await this.slot();
    try {
      const res = await axios.post(`${config.CHAIN.ENFORCER.URL.replace(/\/$/, '')}/${SERVICE}/${method}`, request, {
        headers: { 'Content-Type': 'application/json' },
        timeout: config.CHAIN.ENFORCER.TIMEOUT,
        validateStatus: () => true,
      });
      if (res.status !== 200) {
        throw new EnforcerError(method, res.data?.code ?? String(res.status), res.data?.message ?? 'no reply');
      }
      return res.data as T;
    } finally {
      this.release();
    }
  }

  async getChainTip(): Promise<HeaderInfo> {
    return header((await this.call('GetChainTip')).blockHeaderInfo);
  }

  async getChainInfo(): Promise<ChainInfo> {
    const r = await this.call('GetChainInfo');
    const c = r.bip300Constants ?? {};
    return {
      network: r.network ?? 'NETWORK_UNSPECIFIED',
      activationHeight: num(c.activationHeight),
      bundleMaxAge: num(c.withdrawalBundleMaxAge),
      bundleThreshold: num(c.withdrawalBundleInclusionThreshold),
      usedSlotProposalMaxAge: num(c.usedSidechainSlotProposalMaxAge),
      usedSlotThreshold: num(c.usedSidechainSlotActivationThreshold),
      unusedSlotProposalMaxAge: num(c.unusedSidechainSlotProposalMaxAge),
      unusedSlotThreshold: num(c.unusedSidechainSlotActivationThreshold),
    };
  }

  async getSidechains(): Promise<SidechainInfo[]> {
    const r = await this.call('GetSidechains');
    return (r.sidechains ?? []).map((s: any) => {
      const d = s.declaration?.v0;
      return {
        slot: num(s.sidechainNumber),
        title: d?.title ?? null,
        description: d?.description ?? null,
        voteCount: num(s.voteCount),
        proposalHeight: num(s.proposalHeight),
        activationHeight: num(s.activationHeight),
        hashId1: d?.hashId1?.hex ?? null,
        hashId2: d?.hashId2?.hex ?? null,
      };
    });
  }

  /** The newest-first headers from `hash` back, `count` of them at most */
  async getHeaders(hash: string, count: number): Promise<HeaderInfo[]> {
    const r = await this.call('GetBlockHeaderInfo', { blockHash: reverseHex(hash), maxAncestors: Math.max(0, count - 1) });
    return (r.headerInfos ?? []).map(header);
  }

  /**
   * Deposits, withdrawal bundle events and BMM of one sidechain over the blocks after `startHash` (exclusive; from
   * the activation height when null) up to `endHash`, oldest first. Blocks with nothing for the sidechain may be
   * left out.
   */
  async getPegData(slot: number, startHash: string | null, endHash: string): Promise<PegBlock[]> {
    const r = await this.call('GetTwoWayPegData', {
      sidechainId: slot, endBlockHash: reverseHex(endHash), ...(startHash ? { startBlockHash: reverseHex(startHash) } : {}),
    });
    return (r.blocks ?? []).map((b: any) => pegBlock(b.blockHeaderInfo, b.blockInfo));
  }

  async getCtip(slot: number): Promise<Ctip | null> {
    const c = (await this.call('GetCtip', { sidechainNumber: slot })).ctip;
    return c ? { txid: display(c.txid), vout: num(c.vout), amount: num(c.value), sequence: num(c.sequenceNumber) } : null;
  }

  async getBundleProposals(slot: number): Promise<BundleProposal[]> {
    const r = await this.call('GetWithdrawalBundleProposals', { sidechainId: slot });
    return (r.proposals ?? []).map((p: any) => ({ m6id: consensus(p.m6id), voteCount: num(p.voteCount), proposalHeight: num(p.proposalHeight) }));
  }

  async getSidechainProposals(): Promise<SidechainProposal[]> {
    const r = await this.call('GetSidechainProposals');
    return (r.sidechainProposals ?? []).map((p: any) => ({
      slot: num(p.sidechainNumber),
      title: p.declaration?.v0?.title ?? null,
      description: p.declaration?.v0?.description ?? null,
      hash: display(p.descriptionSha256dHash),
      voteCount: num(p.voteCount),
      proposalHeight: num(p.proposalHeight),
      proposalAge: num(p.proposalAge),
    }));
  }
}

export default new Enforcer();
