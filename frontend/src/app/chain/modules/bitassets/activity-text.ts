// The words for the token ledger's operations (BitAssets, Layers): activity tables and transaction pages

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);
}

/** one line (HTML) on what a token operation did, from its amounts and asset labels (the token ledger's events) */
export function describeActivity(e: any): string {
  const a = e.amounts ?? {}, l = e.labels ?? {};
  const amt = (k: string, role = k) => a[k] !== undefined ? `<b>${esc(a[k])}</b> ${esc(l[role] ?? '')}` : '';
  switch (e.kind) {
    case 'swap': case 'route':
      return a.out !== undefined ? `${amt('in')} → ${amt('out')}${e.note && e.note.startsWith('via') ? ` <span class="muted">${esc(e.note)}</span>` : ''}`
        : `${amt('in')} → ${esc(l.out ?? '')} <span class="muted">not filled, refunded</span>`;
    case 'add-liquidity': return `${amt('a')} + ${amt('b')} → <b>${esc(a.shares)}</b> LP shares`;
    case 'remove-liquidity': return `<b>${esc(a.shares)}</b> LP shares → ${amt('a')} + ${amt('b')}`;
    case 'register': return `registered with a supply of ${amt('supply', 'asset')}`;
    case 'mint': return `minted ${amt('amount', 'asset')}`;
    case 'burn': return `burned ${amt('amount', 'asset')}`;
    case 'create-auction': return `sells ${amt('amount', 'base')} for ${esc(l.quote)}, from ${amt('startPrice', 'quote')} to ${amt('endPrice', 'quote')} <span class="muted">${esc(e.note ?? '')}</span>`;
    case 'bid': return `paid ${amt('paid', 'quote')} for ${amt('bought', 'base')}${a.back ? `, ${amt('back', 'quote')} back` : ''}`;
    case 'collect': return `collected ${amt('proceeds', 'quote')} and ${amt('remaining', 'base')} unsold`;
    case 'transfer': return `moved ${Object.keys(l).map(k => esc(l[k])).join(', ')} <span class="muted">${esc(e.note ?? '')}</span>`;
    case 'update': return `updated ${esc(l.asset ?? '')}'s data`;
    case 'release': return `retired ${esc(l.asset ?? '')}`;
    case 'reserve': return 'reserved a name';
    default: return esc(e.note ?? '');
  }
}
