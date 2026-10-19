// The chain profiles' API (backend/src/chain/drivechain.ts, drivechain.routes.ts). Amounts are in sats.

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
  destination: string;
  burnindex: number;
}

export interface DcWithdrawal {
  slot: number;
  name: string;
  txid: string;
  bundle: string;
  amount: number;
  payouts: { amount: number; script: string }[];
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
  pending: { [slot: number]: { hash: string; score: number }[] };
  scanned: boolean;
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

export interface WithdrawalBundle {
  slot: number;
  name?: string;
  hash: string;
  index: number;
  height: number;
  score: number;
  lastupvote: number;
  blocksleft: number;
  payable: boolean;
  known: boolean;
  vote?: string;
  payouts: { amount: number; script: string; address?: string }[];
  fee: number;
  total: number;
}

export interface ActiveSidechain {
  slot: number;
  title: string;
  description: string;
  version: number;
  hashid1: string;
  hashid2: string;
  proposalhash: string;
  activationheight: number;
  escrowscript: string;
  escrow: { txid: string; n: number; amount: number } | null;
  pendingbundles: number;
  profile: string | null;
  explorer: string | null;
  stats: SlotStats | null;
}

export interface DrivechainSummary {
  info: {
    maxsidechains: number;
    activationperiod: number;
    activationmaxfailures: number;
    replacementperiod: number;
    withdrawalperiod: number;
    withdrawalminscore: number;
    maxpendingbundles: number;
    upvoteexpiryblocks: number;
    height: number;
    activesidechains: number;
    proposals: number;
    pendingbundles: number;
    escrowtotal: number;
    statehash: string;
  };
  averageFee: any;
  sidechains: ActiveSidechain[];
  proposals: { pending: any[]; queued: any[] } | any;
  bundles: WithdrawalBundle[];
  indexed: { from: number | null; to: number };
}

export interface SidechainCarrier {
  height: number;
  hash: string | null;
  time: number | null;
  bid: number | null;
  requestTxid: string | null;
  /** chains of stake: 'ticket' = this block acknowledges the anchor Chains committed to; 'anchored' = this block was anchored */
  role?: 'ticket' | 'anchored';
  ticket?: string;
  anchored?: string;
  ackBlock?: string;
  ackHeight?: number;
}

export interface SidechainSummary {
  slot: number;
  name: string;
  onMainchain: any;
  bundles: WithdrawalBundle[];
  mainchainInfo: any;
  state: any;
  bmmInfo: any;
  stats: SlotStats | null;
  indexed: { from: number | null; to: number };
  mainchainExplorer: string | null;
}

export interface ChainTxInfo {
  height: number;
  blockHash: string;
  deposit: DcDeposit | null;
  withdrawal: DcWithdrawal | null;
  bmmRequest: BmmRequest | null;
}
