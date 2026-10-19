/**
 * Anchors of a chain of stake (FastBlocks, Layers).
 *
 * On these chains Chains does not commit to a block hash: its BMM accept (M7) commits to an anchor ticket h*, the hash
 * of the block anchored and of who is paid the fee pot (layers/src/pos/header.h AnchorTicket). A later block of stake
 * acknowledges the ticket (getblock's `ack`: ticket, anchored, payee, mainheight). This keeps, from the blocks the
 * address index reads:
 *   ticket h*      -> the block that acknowledged it
 *   block          -> its acknowledgement
 *   anchored block -> the block that acknowledged its anchor
 * so that a Chains commitment leads to the sidechain blocks it concerns, and back.
 */

export interface Anchor {
  ticket: string;      // h*, what the Chains block committed to
  block: string;       // the block of stake that acknowledged it
  height: number;
  anchored: string;    // the block it anchors
  mainheight: number;  // the Chains block that committed to the ticket
}

const byTicket = new Map<string, Anchor>();
const byBlock = new Map<string, Anchor>();
const byAnchored = new Map<string, Anchor>();
const byHeight = new Map<number, Anchor>();

export function recordAnchor(block: any): void {
  const ack = block?.ack;
  if (!ack?.ticket) { return; }
  const a: Anchor = { ticket: ack.ticket, block: block.hash, height: block.height, anchored: ack.anchored, mainheight: ack.mainheight };
  byTicket.set(a.ticket, a);
  byBlock.set(a.block, a);
  if (a.anchored) { byAnchored.set(a.anchored, a); }
  byHeight.set(a.height, a);
}

export function forgetAnchorAt(height: number): void {
  const a = byHeight.get(height);
  if (!a) { return; }
  byHeight.delete(height);
  if (byTicket.get(a.ticket) === a) { byTicket.delete(a.ticket); }
  if (byBlock.get(a.block) === a) { byBlock.delete(a.block); }
  if (byAnchored.get(a.anchored) === a) { byAnchored.delete(a.anchored); }
}

export function clearAnchors(): void {
  byTicket.clear(); byBlock.clear(); byAnchored.clear(); byHeight.clear();
}

export const anchorOfTicket = (t: string) => byTicket.get(t);
export const anchorAckedIn = (blockHash: string) => byBlock.get(blockHash);
export const anchorOf = (anchoredHash: string) => byAnchored.get(anchoredHash);

export function dumpAnchors(): Anchor[] {
  return [...byHeight.values()];
}

export function loadAnchors(list: Anchor[] | undefined): void {
  for (const a of list ?? []) {
    recordAnchor({ hash: a.block, height: a.height, ack: { ticket: a.ticket, anchored: a.anchored, mainheight: a.mainheight } });
  }
}
