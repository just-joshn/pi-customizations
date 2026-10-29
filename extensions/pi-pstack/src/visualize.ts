import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';

export const MAX_POINTS = 500;
export const MAX_SERIES = 32;

const VisualizeParams = Type.Object({
  title: Type.String({ description: 'Chart title.' }),
  kind: Type.Union([Type.Literal('bar'), Type.Literal('line')], { description: 'bar: one bar per label and series. line: one line per series across the labels.' }),
  labels: Type.Array(Type.String(), { description: `Category or x-axis labels, at most ${MAX_POINTS}.` }),
  series: Type.Array(Type.Object({ name: Type.String(), values: Type.Array(Type.Number(), { description: 'One value per label.' }) }), { description: `One or more named series, at most ${MAX_SERIES}.` }),
  unit: Type.Optional(Type.String({ description: 'Unit shown after values, such as ms or %.' })),
});

export type Chart = Static<typeof VisualizeParams>;

/** The reason a chart cannot be drawn, or undefined when it can. */
export function chartError(chart: Chart): string | undefined {
  if (chart.labels.length === 0) return 'labels is empty: a chart needs at least one point.';
  if (chart.series.length === 0) return 'series is empty: a chart needs at least one series.';
  if (chart.series.length > MAX_SERIES) return `too many series: ${chart.series.length} series, at most ${MAX_SERIES}.`;
  if (chart.labels.length > MAX_POINTS) return `too many points: ${chart.labels.length} labels, at most ${MAX_POINTS}.`;
  for (const series of chart.series) {
    if (series.values.length !== chart.labels.length) return `series "${series.name}" has ${series.values.length} values for ${chart.labels.length} labels; each series needs one value per label.`;
    const bad = series.values.findIndex((value) => !Number.isFinite(value));
    if (bad !== -1) return `series "${series.name}" value ${bad} (label "${chart.labels[bad]}") is ${series.values[bad]}, not a finite number.`;
  }
  return undefined;
}

export function formatValue(value: number, unit?: string): string {
  const text = Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4)));
  return unit === undefined || unit === '' ? text : `${text} ${unit}`;
}

const BAR_WIDTH = 40;
const BAR_FILLS = ['█', '▓', '▒', '░'];
const LINE_MARKS = ['●', '○', '◆', '◇', '■', '□', '▲', '△'];
const PLOT_HEIGHT = 10;
const PLOT_WIDTH = 60;

function legend(chart: Chart, marks: readonly string[]): string[] {
  return chart.series.length < 2 ? [] : ['', chart.series.map((series, index) => `${marks[index % marks.length]} ${series.name}`).join('  ')];
}

function maxAbs(chart: Chart): number {
  let max = 0;
  for (const series of chart.series) for (const value of series.values) max = Math.max(max, Math.abs(value));
  return max;
}

function extent(values: Iterable<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

// A rendered chart is a validated chart: chartError rejected every series whose value count differs from the labels.
function barText(chart: Chart): string[] {
  const max = maxAbs(chart);
  let labelWidth = 0;
  for (const label of chart.labels) labelWidth = Math.max(labelWidth, label.length);
  const lines: string[] = [];
  chart.labels.forEach((label, point) => {
    chart.series.forEach((series, index) => {
      const value = series.values[point] as number;
      const cells = max === 0 ? 0 : Math.max(value === 0 ? 0 : 1, Math.round((Math.abs(value) / max) * BAR_WIDTH));
      const name = index === 0 ? label.padEnd(labelWidth) : ' '.repeat(labelWidth);
      lines.push(`${name} │${(BAR_FILLS[index % BAR_FILLS.length] as string).repeat(cells)} ${formatValue(value, chart.unit)}`);
    });
  });
  return [...lines, ...legend(chart, BAR_FILLS)];
}

function lineText(chart: Chart): string[] {
  const { min, max } = extent(chart.series.flatMap((series) => series.values));
  const columns = Math.min(PLOT_WIDTH, chart.labels.length);
  const grid = Array.from({ length: PLOT_HEIGHT }, () => Array<string>(columns).fill(' '));
  chart.series.forEach((series, index) => {
    series.values.forEach((value, point) => {
      const column = chart.labels.length === 1 ? 0 : Math.round((point / (chart.labels.length - 1)) * (columns - 1));
      const row = max === min ? Math.floor(PLOT_HEIGHT / 2) : Math.round(((max - value) / (max - min)) * (PLOT_HEIGHT - 1));
      (grid[row] as string[])[column] = LINE_MARKS[index % LINE_MARKS.length] as string;
    });
  });
  const top = formatValue(max, chart.unit);
  const bottom = formatValue(min, chart.unit);
  const axisWidth = Math.max(top.length, bottom.length);
  const rows = grid.map((cells, row) => {
    const tick = row === 0 ? top : row === PLOT_HEIGHT - 1 ? bottom : '';
    return `${tick.padStart(axisWidth)} ${row === 0 || row === PLOT_HEIGHT - 1 ? '┤' : '│'}${cells.join('')}`;
  });
  const first = chart.labels[0] as string;
  const last = chart.labels.at(-1) as string;
  const xLabels = chart.labels.length === 1 ? first : `${first}${' '.repeat(Math.max(1, columns - first.length - last.length))}${last}`;
  return [...rows, `${' '.repeat(axisWidth)} └${'─'.repeat(columns)}`, `${' '.repeat(axisWidth + 2)}${xLabels}`, ...legend(chart, LINE_MARKS)];
}

/** The chart as Unicode text: the title, then the bars or the plot, then a legend when there is more than one series. */
export function renderChartText(chart: Chart): string {
  return [chart.title, '', ...(chart.kind === 'bar' ? barText(chart) : lineText(chart))].join('\n');
}

const PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7'];

const XML_ESCAPES: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };

export function escapeXml(text: string): string {
  return text.replace(/[<>&'"]/g, (char) => XML_ESCAPES[char] as string);
}

const round = (value: number) => Math.round(value * 100) / 100;

/** A self-contained SVG of the chart: title, labeled axes with ticks, and a legend. */
export function renderChartSvg(chart: Chart): string {
  const width = 800;
  const height = 450;
  const margin = { top: 60, right: 30, bottom: 80, left: 80 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = chart.series.flatMap((series) => series.values);
  let { min, max } = extent(values);
  if (chart.kind === 'bar') {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const y = (value: number) => round(margin.top + ((max - value) / (max - min)) * plotHeight);
  const count = chart.labels.length;
  const band = plotWidth / count;
  const xCenter = (point: number) => round(margin.left + (chart.kind === 'bar' || count === 1 ? band * (point + 0.5) : (point / (count - 1)) * plotWidth));
  const parts: string[] = [];

  parts.push(`<text x="${width / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold">${escapeXml(chart.title)}</text>`);
  const ticks = 5;
  for (let tick = 0; tick <= ticks; tick += 1) {
    const value = min + ((max - min) * tick) / ticks;
    parts.push(`<line x1="${margin.left}" y1="${y(value)}" x2="${width - margin.right}" y2="${y(value)}" stroke="#e0e0e0"/>`);
    parts.push(`<text x="${margin.left - 8}" y="${y(value) + 4}" text-anchor="end" font-size="11">${escapeXml(formatValue(value, chart.unit))}</text>`);
  }
  parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="#333"/>`);
  parts.push(`<line x1="${margin.left}" y1="${y(Math.max(min, Math.min(0, max)))}" x2="${width - margin.right}" y2="${y(Math.max(min, Math.min(0, max)))}" stroke="#333"/>`);
  const labelEvery = Math.max(1, Math.ceil(count / 20));
  chart.labels.forEach((label, point) => {
    if (point % labelEvery === 0) {
      const x = xCenter(point);
      const labelY = margin.top + plotHeight + 16;
      parts.push(`<text x="${x}" y="${labelY}" text-anchor="end" font-size="11" transform="rotate(-30 ${x} ${labelY})">${escapeXml(label)}</text>`);
    }
  });
  if (chart.unit !== undefined && chart.unit !== '')
    parts.push(`<text x="18" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="12" transform="rotate(-90 18 ${margin.top + plotHeight / 2})">${escapeXml(chart.unit)}</text>`);

  chart.series.forEach((series, index) => {
    const color = PALETTE[index % PALETTE.length];
    if (chart.kind === 'bar') {
      const barWidth = (band * 0.8) / chart.series.length;
      series.values.forEach((value, point) => {
        const x = round(margin.left + band * point + band * 0.1 + barWidth * index);
        const top = Math.min(y(value), y(0));
        parts.push(
          `<rect x="${x}" y="${top}" width="${round(barWidth)}" height="${round(Math.abs(y(value) - y(0)))}" fill="${color}"><title>${escapeXml(`${series.name} ${chart.labels[point]}: ${formatValue(value, chart.unit)}`)}</title></rect>`,
        );
      });
    } else {
      const points = series.values.map((value, point) => `${xCenter(point)},${y(value)}`).join(' ');
      parts.push(`<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>`);
      if (count <= 60)
        series.values.forEach((value, point) => {
          parts.push(`<circle cx="${xCenter(point)}" cy="${y(value)}" r="3" fill="${color}"/>`);
        });
    }
  });

  chart.series.forEach((series, index) => {
    const x = margin.left + index * 150;
    parts.push(`<rect x="${x}" y="42" width="12" height="12" fill="${PALETTE[index % PALETTE.length]}"/>`);
    parts.push(`<text x="${x + 18}" y="52" font-size="12">${escapeXml(series.name)}</text>`);
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    ...parts,
    '</svg>',
    '',
  ].join('\n');
}

export function chartSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug === '' ? 'chart' : slug;
}

function timestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

export interface VisualizeOptions {
  artifactsDir: (ctx: ExtensionContext) => string;
  now?: () => Date;
}

export function registerVisualize(pi: ExtensionAPI, options: VisualizeOptions): void {
  pi.registerTool({
    name: 'visualize',
    label: 'Visualize',
    description: 'Draw a bar or line chart from labels and one or more named series. The result shows the chart as Unicode text and names an SVG file written to the session artifacts folder.',
    promptSnippet: 'Draw a bar or line chart (Unicode in the result, SVG file in the artifacts folder)',
    parameters: VisualizeParams,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const error = chartError(params);
      if (error !== undefined) throw new Error(`visualize: ${error}`);
      const dir = options.artifactsDir(ctx);
      mkdirSync(dir, { recursive: true });
      const stamp = timestamp((options.now ?? (() => new Date()))());
      const slug = chartSlug(params.title);
      let path = join(dir, `${stamp}-${slug}.svg`);
      for (let n = 2; existsSync(path); n += 1) path = join(dir, `${stamp}-${slug}-${n}.svg`);
      writeFileSync(path, renderChartSvg(params));
      return { content: [{ type: 'text', text: `${renderChartText(params)}\n\nSVG: ${path}` }], details: { path } };
    },
  });
}
