import {
  ASSET_GENESIS_VERSION, CREDIT_FAMILY_BY_VERSION, CreditFamily, Fields, FreebankParseError, ParsedTx, PegOutput,
  creditOpName, decodeCreditPayload, parseTx, pegOutputs,
} from './parser';

/**
 * What a FreeBank transaction does, from the node's getrawtransaction verbose JSON: its credit operation (v11-v17), the
 * asset it creates (v10) and its peg and protocol outputs, read from the raw hex (parser.ts). A tx that does not parse
 * answers what its version says, with `error` in our own words; this never throws.
 */

/** freebankd's largest transaction is under its 4 MB block weight; a hex string past this is not read */
const MAX_HEX = 8 * 1024 * 1024;
/** The most peg outputs listed (a coinbase holds a record per deposit) */
const PEG_MAX = 50;

export interface TxMeaning {
  version: number;
  family: CreditFamily | null;
  assetGenesis: boolean;
  credit: { family: CreditFamily; op: number; opName: string; fields: Fields } | null;
  asset: { assetId: string; ticker: string; headline: string; payload: string; decimals: number; supply: number | null } | null;
  peg: PegOutput[] | null;
  error: string | null;
}

export function describeTx(tx: unknown): TxMeaning {
  const node = (tx ?? {}) as { version?: unknown; txid?: unknown; hex?: unknown; vout?: unknown };
  const version = Number(node.version);
  const meaning: TxMeaning = {
    version,
    family: CREDIT_FAMILY_BY_VERSION[version] ?? null,
    assetGenesis: version === ASSET_GENESIS_VERSION,
    credit: null,
    asset: null,
    peg: null,
    error: null,
  };
  if (typeof node.hex !== 'string' || !node.hex || node.hex.length > MAX_HEX) {
    meaning.error = 'The raw transaction is missing or too large';
    return meaning;
  }
  let parsed: ParsedTx;
  try {
    parsed = parseTx(node.hex);
  } catch (e) {
    meaning.error = 'The raw transaction does not parse' + (e instanceof FreebankParseError ? ` (${e.message})` : '');
    return meaning;
  }
  if (typeof node.txid === 'string' && parsed.txid !== node.txid) {
    meaning.error = 'The raw transaction does not match its txid';
    return meaning;
  }
  meaning.version = parsed.version;
  meaning.family = parsed.family;
  meaning.assetGenesis = parsed.version === ASSET_GENESIS_VERSION;

  if (parsed.family !== null && parsed.op !== null && parsed.payload !== null) {
    const opName = creditOpName(parsed.family, parsed.op);
    let fields: Fields = {};
    try {
      fields = decodeCreditPayload(parsed.family, parsed.op, parsed.payload);
    } catch {
      meaning.error = `The ${parsed.family} ${opName} payload does not fit its layout`;
    }
    meaning.credit = { family: parsed.family, op: parsed.op, opName, fields };
  }
  if (parsed.asset) {
    // asset.cpp: the asset's id is the genesis txid; vout[0] its control coin, vout[1] the whole supply
    meaning.asset = { assetId: parsed.txid, ...parsed.asset, supply: parsed.vout[1]?.value ?? null };
  }
  const peg = pegOutputs(parsed, outputAddresses(node.vout), PEG_MAX);
  meaning.peg = peg.length ? peg : null;
  return meaning;
}

/** Each output's address as the node prints it (scriptPubKey.addresses on the 0.16 base, .address later) */
function outputAddresses(vout: unknown): (string | null)[] {
  if (!Array.isArray(vout)) {
    return [];
  }
  return vout.map((o) => {
    const spk = (o as { scriptPubKey?: { address?: unknown; addresses?: unknown } })?.scriptPubKey;
    const address = spk?.address ?? (Array.isArray(spk?.addresses) && spk?.addresses.length === 1 ? spk.addresses[0] : null);
    return typeof address === 'string' ? address : null;
  });
}
