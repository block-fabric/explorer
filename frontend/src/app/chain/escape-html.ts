/** Text from the chain (pool and miner tags, coinbase text, sidechain titles) made safe to put in HTML, e.g. in an ECharts formatter */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] as string));
}
