/*
 * The FreeBank node's credit RPCs as the backend passes them on (freebank src/rpc/misc.cpp, chains/FREEBANK-API.md).
 * Units as the node gives them: amount, escrow, activeescrow, lastattestreserves, pledge, insolventpot are decimal ECX;
 * loanbookface, face_total, recorded_face, btx_reserve are integer sats; *units are note units (one unit redeems for one
 * sat at its house); heights are FreeBank block heights. Only the fields the pages read are typed.
 */

export type HouseStatus = 'open' | 'stressed' | 'deferred' | 'insolvent' | 'wounddown' | 'unknown';

export interface HousePartner {
  index: number;
  pubkey: string;
  pledge: number;
  status: 'active' | 'settled' | 'tail';
  tailunlockheight?: number;
  pledgeoutputs: number;
}

export interface House {
  id: number;
  househash: string;
  type: 'open' | 'members' | 'redeem' | string;
  member_records?: number;
  tier: number;
  threshold: number;
  classid: string;
  denominationmggold?: number;
  lambdax10?: number;
  activeescrow: number;
  mintedunits: number;
  tokenunits?: number;
  tokenclaimed?: number;
  tokenclaims?: number;
  tokencollected?: number;
  depositunits: number;
  depositwam?: number;
  matchfundingok?: boolean;
  loanbookface: number;
  redemptiondestpk?: string;
  mintcapunits?: number;
  capitalcapunits?: number;
  reservecapunits?: number;
  attestedratiobps: number;
  brassagebps?: number;
  status: HouseStatus;
  effective_status: HouseStatus;
  stress_since?: number;
  attest_deadline: number;
  lastattestheight: number;
  lastattestreserves: number;
  lastsettleheight: number;
  pareligible?: boolean;
  insolventheight?: number;
  insolvent_since?: number;
  claim_window_closes?: number;
  collection_done?: boolean;
  closed?: boolean;
  defer_invoked_height?: number;
  defer_insolvent_height?: number;
  registeredheight: number;
  txidregister: string;
  partners: HousePartner[];
  [field: string]: any;
}

export interface HouseMember {
  address: string;
  added_height: number;
  removal_height: number;
  active: boolean;
}

export interface TokenClaims {
  insolventsince: number;
  windowend: number;
  tokenunits: number;
  base: number;
  claimed: number;
  claims: number;
  collected: number;
  paid: number;
  writeoff: number;
  keysets: { id: string; height: number; postingpubkey: string; keys: { amount: number; pubkey: string }[] }[];
  list: { y: string; amount: number; payout: string; feebps: number; relayer: string; height: number; collectheight: number }[];
}

export interface BillEndorsement {
  from: string;
  to: string;
  at_height: number;
}

export interface Bill {
  id: number;
  bill_id: string;
  amount: number;
  escrow: number;
  /** a active, r retired, d defaulted, x disputed (bill.h BILL_STATUS_*) */
  status: string;
  issued_height: number;
  maturity_height: number;
  grace_blocks: number;
  drawer_pubkey: string;
  acceptor_pubkey: string;
  holder_pubkey: string;
  owner_house_id: number;
  issue_txid: string;
  escrow_outpoint: string;
  title_outpoint: string;
  endorsements: BillEndorsement[];
  encrypted_body?: string;
}

export interface LoanBook {
  house_id: number;
  count: number;
  face_total: number;
  recorded_face?: number;
  face_matches?: boolean;
  wtd_avg_maturity?: number;
  bills: Bill[];
}

export interface Pool {
  pool_id: number;
  house_id: number;
  fee_bps: number;
  note_reserve: number;
  btx_reserve: number;
  lp_supply: number;
  locked_lp?: number;
  spot_price_sats_x1e8?: number;
  note_escrow_txid: string;
  note_escrow_vout: number;
  btx_escrow_txid: string;
  btx_escrow_vout: number;
  createheight: number;
}

export interface Asset {
  asset_id: string;
  ticker: string;
  headline: string;
  payload: string;
  decimals: number;
  supply: number;
  genesis_control: string;
  genesis_supply: string;
  height: number;
  blockhash: string;
}

export interface GoldFix {
  raw: number;
  braked: number;
  fixheight: number;
  ageblocks?: number;
}

export interface OracleSubmitter {
  id: number;
  pubkey: string;
  bondtxid: string;
  bondvout: number;
  bondheight: number;
  lastsubmitheight: number;
  blockssincesubmit?: number;
  unbondrequestheight: number;
}

/** GET /api/v1/freebank/tx/:txid */
export interface FreebankTxInfo {
  txid: string;
  confirmed: boolean;
  version: number;
  family: 'bill' | 'house' | 'note' | 'deposit' | 'pool' | 'settle' | 'oracle' | null;
  assetGenesis: boolean;
  /** the decoded operation; its `fields` a flat key/value object (being finalized: shown generically) */
  credit: { fields?: Record<string, unknown>; [k: string]: unknown } | null;
  /** an asset genesis (version 10): assetId (= txid), ticker, headline, payload, decimals, supply */
  asset?: Record<string, unknown> | null;
  /** its peg and protocol outputs (deposits, withdrawals, bundles, the coinbase's commitments): kind, vout, … */
  peg?: ({ kind: string; vout: number } & Record<string, unknown>)[] | null;
  /** what did not read (our own words), null: all of it */
  error?: string | null;
}

/** GET /api/v1/freebank/blocks: a block's BMM fields from its 136-byte header */
export interface FreebankBlockMark {
  hash: string;
  height: number;
  /** the eCash block hash it was mined in (BMM), null: none */
  mainblock: string | null;
  withdrawalbundle: string | null;
  onChain: boolean;
  /** its credit operations by family, from the activity index (null: not read yet) */
  credit?: Record<string, number> | null;
}
