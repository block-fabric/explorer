// The chain profiles' API (backend/src/chain/drivechain.ts, drivechain.routes.ts, mining.ts). Amounts are in sats.

export interface VoteEntry {
  slot: number;
  name: string;
  value: number;
  vote: 'abstain' | 'downvote' | 'upvote';
  bundle?: string;
}

export interface BmmAccept {
  slot: number;
  name: string;
  sideBlock: string;
  requestTxid?: string;
  bid?: number;
}

export interface BmmRequest {
  slot: number;
  name: string;
  sideBlock: string;
  prevMainBlock?: string;
  txid: string;
  bid: number;
  accepted: boolean;
}

export interface DcDeposit {
  slot: number;
  name: string;
  txid: string;
  amount: number;
  /** the sidechain address, as text when it is printable, else hex */
  destination: string;
  /** the escrow's sequence number after the deposit */
  sequence: number;
}

export interface DcWithdrawal {
  slot: number;
  name: string;
  txid: string;
  bundle: string;
  amount: number;
  escrowDelta: number;
  payouts: { amount: number; script: string }[];
}

export interface PendingBundle {
  /** M6 id */
  hash: string;
  /** vote count */
  score: number;
  /** proposed at */
  height: number;
}

/** Who mined a block and what it earned (from its coinbase) */
export interface MinerInfo {
  tag: string | null;
  coinbaseText: string;
  reward: number;
  fees: number;
  subsidy: number;
  txCount: number;
  weight: number;
  difficulty: number;
  bits: string;
  minDifficulty: boolean;
  datum: boolean;
  poolTag: string | null;
  minerTag: string | null;
}

export interface DrivechainBlock {
  height: number;
  hash: string;
  time: number;
  proposals: { slot: number; hash: string; title?: string; description?: string; version?: number; hashId1?: string; hashId2?: string }[];
  acks: { slot: number; hash: string; title?: string }[];
  bundlesProposed: { slot: number; name: string; hash: string }[];
  votes: { form: number; formName: string; entries: VoteEntry[] } | null;
  bmm: BmmAccept[];
  bmmRequests: BmmRequest[];
  deposits: DcDeposit[];
  withdrawals: DcWithdrawal[];
  bundlesClosed: { slot: number; name: string; hash: string; paid: boolean }[];
  /** the pending bundles after this block */
  pending: { [slot: number]: PendingBundle[] };
  miner: MinerInfo | null;
}

export interface DrivechainBlockSummary {
  height: number;
  hash: string;
  bmm: { slot: number; name: string; bid?: number }[];
  bmmRequests: number;
  deposits: number;
  depositAmount: number;
  withdrawals: number;
  withdrawalAmount: number;
  votes: { slot: number; name: string; vote: string }[];
  proposals: number;
  acks: number;
  bundlesProposed: number;
  bundlesClosed: number;
  bids: number;
  miner: string | null;
  minerTag?: string | null;
  datum?: boolean;
  fees: number | null;
}

export interface SlotStats {
  slot: number;
  name: string;
  bmmBlocks: number;
  bids: number;
  deposits: number;
  depositAmount: number;
  withdrawals: number;
  withdrawalAmount: number;
  lastBmmHeight: number | null;
}

/** A pending withdrawal bundle: its votes against the threshold, and the blocks it has left */
export interface WithdrawalBundle {
  slot: number;
  name: string;
  /** M6 id */
  hash: string;
  /** votes */
  score: number;
  /** proposed at */
  height: number;
  threshold: number;
  blocksleft: number;
  payable: boolean;
}

/** The BIP300 constants, from the enforcer (GetChainInfo) */
export interface DrivechainInfo {
  activationHeight: number;
  bundleMaxAge: number;
  bundleThreshold: number;
  usedSlotProposalMaxAge: number;
  usedSlotThreshold: number;
  unusedSlotProposalMaxAge: number;
  unusedSlotThreshold: number;
  /** the enforcer's own name for the network */
  network?: string;
}

export interface EscrowOutput {
  txid: string;
  vout: number;
  amount: number;
  sequence: number;
}

export interface ActiveSidechain {
  slot: number;
  title: string;
  description: string | null;
  hashId1: string | null;
  hashId2: string | null;
  proposalHeight: number;
  activationHeight: number;
  voteCount: number;
  escrow: EscrowOutput | null;
  pendingbundles: number;
  profile: string | null;
  explorer: string | null;
  stats: SlotStats | null;
}

/** A sidechain proposal (M1) on its way to activation */
export interface SidechainProposal {
  slot: number;
  title: string | null;
  description: string | null;
  hash: string;
  voteCount: number;
  proposalHeight: number;
  proposalAge: number;
}

export interface DrivechainSummary {
  info: DrivechainInfo & { height: number; network: string; enforcerNetwork: string };
  sidechains: ActiveSidechain[];
  proposals: SidechainProposal[];
  bundles: WithdrawalBundle[];
  indexed: { from: number | null; to: number };
}

/** The cockpit's live state (GET drivechain/cockpit: live) */
export interface CockpitLive {
  height: number;
  info: DrivechainInfo;
  mining: { difficulty: number; networkhashps: number; pooledtx: number } | null;
  chainwork: string | null;
  supply: number;
  subsidy: number;
  nextHalving: number;
  escrowTotal: number;
  escrowShareOfSupply: number;
  allSidechains: { slot: number; title: string | null; profile: string | null }[];
  sidechains: {
    slot: number; title: string | null; description: string | null; activationHeight: number; escrow: number;
    escrowTxid: string | null; pendingbundles: number; profile: string | null; explorer: string | null;
  }[];
  proposals: SidechainProposal[];
  bundles: WithdrawalBundle[];
}

/** Where the chain is in its 2016-block retarget period (GET drivechain/mining: retarget) */
export interface RetargetState {
  periodStart: number;
  nextRetarget: number;
  blocksLeft: number;
  /** 0..1 through the period */
  progress: number;
  /** seconds per block so far in the period */
  avgBlockTime: number | null;
  nextDifficulty: number | null;
  /** the estimated change at the retarget, e.g. 0.05 for +5% */
  change: number | null;
  /** unix time of the retarget, at the period's pace */
  eta: number;
  /** test networks: a block may come at the minimum difficulty after this time */
  minDifficultyAfter: number | null;
}

/** GET /api/v1/chain: this explorer's chain and network, and the other networks' explorers */
export interface ChainInfo {
  id: string;
  name: string;
  unit: string;
  slot: number | null;
  mainchain: boolean;
  network: string;
  networkName: string;
  networks: { id: string; name: string; explorer: string | null }[];
  explorers: Record<string, string | null>;
  sidechains: { id: string; name: string; slot: number }[];
  module: { describeTx: boolean; describeBlock: boolean };
  activationHeight: number | null;
  indexReady: boolean;
}

export interface ChainTxInfo {
  height: number;
  blockHash: string;
  deposit: DcDeposit | null;
  withdrawal: DcWithdrawal | null;
  bmmRequest: BmmRequest | null;
}
