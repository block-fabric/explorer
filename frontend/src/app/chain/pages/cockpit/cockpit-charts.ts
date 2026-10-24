import { PROFILE } from '@app/chain/profiles';
import { escapeHtml } from '@app/chain/escape-html';

/**
 * The ECharts options of the drivechain cockpit, from a GET drivechain/cockpit reply: the eCash explorer's cockpit
 * (/drivechain, every sidechain or one) and a sidechain explorer's BMM page (/bmm, GET l2/bmm/cockpit: its slot only).
 * Text from the chain (pool tags, sidechain titles) goes through escapeHtml wherever a formatter makes HTML.
 */
export interface CockpitChartContext {
  colorOf(slot: number): string;
  nameOf(slot: number): string;
  /** the unit of amounts (the eCash unit; default: this explorer's) */
  unit?: string;
}

export function axisStyle(): any {
  return {
    axisLine: { lineStyle: { color: '#ffffff33' } },
    axisLabel: { color: '#ffffff99', fontSize: 11 },
    splitLine: { lineStyle: { color: '#ffffff12' } },
  };
}

export function baseChart(extra: any = {}): any {
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 52, right: 16, top: 48, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 }, confine: true },
    legend: { type: 'scroll', top: 0, left: 8, right: 8, textStyle: { color: '#ffffffcc', fontSize: 11 }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, pageIconColor: '#ffffffcc', pageIconInactiveColor: '#ffffff33', pageIconSize: 10, pageTextStyle: { color: '#ffffff99', fontSize: 10 } },
    ...extra,
  };
}

/** bids, coverage, escrow, flows, revenue, miners, bidRange, bundles */
export function cockpitCharts(d: any, ctx: CockpitChartContext): Record<string, any> {
  const charts: Record<string, any> = {};
  const unit = ctx.unit ?? PROFILE.unit;
  const series: any[] = d.series ?? [];
  const x = series.map(b => b.from === b.to ? `${b.to}` : `${b.from}-${b.to}`);
  const slots: any[] = d.slots ?? [];
  const sats = (v: number) => v / 1e8;
  const xAxis = { type: 'category', data: x, ...axisStyle(), axisLabel: { color: '#ffffff99', fontSize: 10, hideOverlap: true } };
  const yAxis = (name = '') => ({ type: 'value', name, nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() });

  // BMM bids paid to miners, stacked per sidechain
  charts.bids = baseChart({
    xAxis, yAxis: yAxis(unit),
    tooltip: { ...baseChart().tooltip, valueFormatter: (v: number) => (v ?? 0).toFixed(8) + ' ' + unit },
    series: slots.map(s => ({
      name: s.name, type: 'bar', stack: 'bids', barMaxWidth: 18, itemStyle: { color: ctx.colorOf(s.slot) },
      data: series.map(b => sats(b.bids[s.slot] ?? 0)),
    })),
  });

  // BMM coverage: the share of blocks carrying a block of each sidechain
  charts.coverage = baseChart({
    xAxis, yAxis: { ...yAxis('%'), max: 100 },
    tooltip: { ...baseChart().tooltip, valueFormatter: (v: number) => (v ?? 0).toFixed(0) + '%' },
    series: slots.map(s => ({
      name: s.name, type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 2, color: ctx.colorOf(s.slot) }, itemStyle: { color: ctx.colorOf(s.slot) },
      data: series.map(b => b.blocks ? Math.round(100 * (b.accepts[s.slot] ?? 0) / b.blocks) : 0),
    })),
  });

  // escrow (supply locked in each sidechain), stacked area
  charts.escrow = baseChart({
    xAxis, yAxis: yAxis(unit),
    tooltip: { ...baseChart().tooltip, valueFormatter: (v: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' ' + unit },
    series: slots.filter(s => series.some(b => b.escrow?.[s.slot] !== undefined)).map(s => ({
      name: s.name, type: 'line', stack: 'escrow', symbol: 'none', smooth: true, lineStyle: { width: 1, color: ctx.colorOf(s.slot) },
      areaStyle: { opacity: 0.35, color: ctx.colorOf(s.slot) }, itemStyle: { color: ctx.colorOf(s.slot) },
      data: series.map(b => sats(b.escrow?.[s.slot] ?? 0)),
    })),
  });

  // peg flows: deposits up, withdrawals down
  const flowSlots = slots.filter(s => s.deposits || s.withdrawals);
  charts.flows = baseChart({
    xAxis, yAxis: yAxis(unit),
    tooltip: { ...baseChart().tooltip, valueFormatter: (v: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' ' + unit },
    series: [
      ...flowSlots.map(s => ({
        name: s.name + ' in', type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { color: ctx.colorOf(s.slot) },
        data: series.map(b => sats(b.deposits[s.slot] ?? 0)),
      })),
      ...flowSlots.map(s => ({
        name: s.name + ' out', type: 'bar', stack: 'flow', barMaxWidth: 18, itemStyle: { color: ctx.colorOf(s.slot), opacity: 0.5, decal: { symbol: 'rect', dashArrayX: [1, 0], dashArrayY: [2, 3], rotation: -0.8 } },
        data: series.map(b => -sats(b.withdrawals[s.slot] ?? 0)),
      })),
    ],
    legend: { show: false },
  });

  // miner revenue: subsidy, fees (of which BMM bids)
  charts.revenue = baseChart({
    xAxis, yAxis: [yAxis(unit), { ...yAxis('bids %'), position: 'right', splitLine: { show: false }, max: 100 }],
    grid: { left: 52, right: 44, top: 30, bottom: 28 },
    tooltip: { ...baseChart().tooltip },
    series: [
      { name: 'Other fees', type: 'bar', stack: 'rev', barMaxWidth: 18, itemStyle: { color: '#5b6b85' }, data: series.map(b => sats(Math.max(0, b.fees - b.bidsTotal))) },
      { name: 'BMM bids', type: 'bar', stack: 'rev', barMaxWidth: 18, itemStyle: { color: PROFILE.color }, data: series.map(b => sats(b.bidsTotal)) },
      { name: 'Bids share of fees', type: 'line', yAxisIndex: 1, symbol: 'none', smooth: true, lineStyle: { color: '#ffd166', width: 2 }, itemStyle: { color: '#ffd166' },
        data: series.map(b => b.fees ? Math.round(100 * b.bidsTotal / b.fees) : 0) },
    ],
  });

  // miners: share of blocks
  const miners: any[] = d.miners ?? [];
  const palette = [PROFILE.color, '#5aa6ff', '#ff8a3d', '#f26b9c', '#a585ff', '#2bc79a', '#f5b83d', '#9aa4b2'];
  charts.miners = {
    animation: false, backgroundColor: 'transparent',
    tooltip: { trigger: 'item', backgroundColor: 'rgba(17,19,31,0.95)', borderColor: '#000', textStyle: { color: '#fff', fontSize: 12 },
      formatter: (p: any) => `${escapeHtml(p.name)}<br>${p.value} blocks (${p.percent}%)` },
    series: [{
      type: 'pie', radius: ['48%', '78%'], center: ['50%', '52%'], avoidLabelOverlap: true,
      label: { color: '#ffffffcc', fontSize: 11, formatter: '{b}\n{d}%' }, labelLine: { lineStyle: { color: '#ffffff55' } },
      itemStyle: { borderColor: '#11131f', borderWidth: 2 },
      data: miners.slice(0, 8).map((m, i) => ({ name: m.name || m.tag, value: m.blocks, itemStyle: { color: palette[i % palette.length] } })),
    }],
  };

  // bid distribution per sidechain: min / median / avg / max
  charts.bidRange = baseChart({
    grid: { left: 90, right: 20, top: 24, bottom: 28 },
    xAxis: { type: 'log', name: 'sats', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
    yAxis: { type: 'category', data: slots.map(s => s.name), ...axisStyle() },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(17,19,31,0.95)', textStyle: { color: '#fff', fontSize: 12 } },
    series: [
      { name: 'min', type: 'scatter', symbolSize: 8, itemStyle: { color: '#ffffff66' }, data: slots.map(s => s.bidMin || null) },
      { name: 'median', type: 'scatter', symbol: 'diamond', symbolSize: 13, data: slots.map(s => ({ value: s.bidMedian || null, itemStyle: { color: ctx.colorOf(s.slot) } })) },
      { name: 'average', type: 'scatter', symbol: 'triangle', symbolSize: 11, itemStyle: { color: '#ffd166' }, data: slots.map(s => s.bidAvg || null) },
      { name: 'max', type: 'scatter', symbolSize: 8, itemStyle: { color: '#ff5d5d' }, data: slots.map(s => s.bidMax || null) },
    ],
  });

  // withdrawal bundles: score over time against the threshold
  const hist = d.bundleHistory ?? {};
  const min = d.live?.info?.bundleThreshold ?? 0;
  const bundleSeries = Object.entries(hist).map(([hash, h]: [string, any]) => ({
    name: `${ctx.nameOf(h.slot)} ${hash.slice(0, 6)}`, type: 'line', symbol: 'none', smooth: false,
    lineStyle: { width: 2, color: ctx.colorOf(h.slot) }, itemStyle: { color: ctx.colorOf(h.slot) },
    data: h.points,
  }));
  if (bundleSeries.length) {
    (bundleSeries[0] as any).markLine = {
      symbol: 'none', silent: true, lineStyle: { color: '#ff5d5d', type: 'dashed' },
      label: { color: '#ff5d5d', formatter: `payable at ${min}`, position: 'insideEndTop' }, data: [{ yAxis: min }],
    };
  }
  charts.bundles = baseChart({
    xAxis: { type: 'value', min: 'dataMin', max: 'dataMax', name: 'height', nameTextStyle: { color: '#ffffff88', fontSize: 10 }, ...axisStyle() },
    yAxis: { ...yAxis('votes'), max: (v: any) => Math.max(v.max, min) * 1.05 },
    series: bundleSeries,
  });
  return charts;
}
