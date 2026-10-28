import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, onTestFinished, test } from 'vitest';
import { type Chart, chartError, chartSlug, MAX_POINTS, registerVisualize, renderChartSvg, renderChartText } from '../src/visualize.ts';

const bar: Chart = { title: 'Latency by route', kind: 'bar', labels: ['/a', '/bb', '/c'], series: [{ name: 'p50', values: [10, 40, 0] }], unit: 'ms' };
const line: Chart = {
  title: 'Load',
  kind: 'line',
  labels: ['mon', 'tue', 'wed', 'thu'],
  series: [
    { name: 'cpu', values: [1, 5, 3, 9] },
    { name: 'mem', values: [2, 2, 8, 4] },
  ],
};

/** A minimal well-formedness check: every tag closes in order and every attribute is quoted. */
function assertWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack: string[] = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    if (closing) expect(stack.pop()).toBe(name);
    else stack.push(name as string);
  }
  expect(stack).toEqual([]);
  // Every `<` starts a tag the pattern accepted, so no tag was skipped as malformed.
  const tags = body.match(/<[^>]*>/g) ?? [];
  expect(tags.length).toBe([...body.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g)].length);
  expect(body.replace(/<[^>]*>/g, '')).not.toMatch(/[<>]|&(?!(lt|gt|amp|apos|quot);)/);
}

test('bars scale to the largest value and show each value', () => {
  const lines = renderChartText(bar).split('\n');
  expect(lines[0]).toBe('Latency by route');
  const rows = lines.slice(2);
  expect(rows).toHaveLength(3);
  const width = (row: string) => (row.match(/█/g) ?? []).length;
  expect(width(rows[1] as string)).toBe(40);
  expect(width(rows[0] as string)).toBe(10);
  expect(width(rows[2] as string)).toBe(0);
  expect(rows[1]).toMatch(/^\/bb │█+ 40 ms$/);
  expect((rows[0] as string).indexOf('│')).toBe((rows[1] as string).indexOf('│'));
});

test('several bar series get distinct fills and a legend', () => {
  const text = renderChartText({ ...bar, series: [...bar.series, { name: 'p99', values: [20, 80, 1] }] });
  expect(text).toContain('▓');
  expect(text.split('\n').at(-1)).toBe('█ p50  ▓ p99');
  expect(text.split('\n').filter((row) => row.includes('│'))).toHaveLength(6);
});

test('the line plot marks each series and labels the axis range', () => {
  const lines = renderChartText(line).split('\n');
  expect(lines[2]).toMatch(/^9 ┤/);
  expect(lines[11]).toMatch(/^1 ┤/);
  expect(lines[12]).toMatch(/└─{4}$/);
  expect(lines[13]).toContain('mon');
  expect(lines[13]).toContain('thu');
  expect(lines.at(-1)).toBe('● cpu  ○ mem');
  const plot = lines.slice(2, 12).join('\n');
  expect((plot.match(/●/g) ?? []).length).toBe(4);
  expect(plot.match(/○/g)?.length).toBeGreaterThanOrEqual(3);
});

test('a flat or single-point line still draws', () => {
  expect(renderChartText({ title: 't', kind: 'line', labels: ['x'], series: [{ name: 's', values: [3] }] })).toContain('●');
  expect(renderChartText({ title: 't', kind: 'line', labels: ['a', 'b'], series: [{ name: 's', values: [2, 2] }] })).toContain('●');
});

test('the SVG is well formed with title, axes, legend, and escaped text', () => {
  for (const chart of [bar, line, { ...line, title: 'a < b & "c"', series: [{ name: '<x>', values: [-1, 2, 3, 4] }] }]) {
    const svg = renderChartSvg(chart);
    assertWellFormed(svg);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).not.toMatch(/NaN|Infinity/);
  }
  expect(renderChartSvg(bar)).toContain('>Latency by route</text>');
  expect(renderChartSvg(bar).match(/<rect [^>]*fill="#4e79a7"/g)).toHaveLength(4);
  expect(renderChartSvg(line)).toContain('<polyline');
  expect(renderChartSvg(line)).toContain('>mem</text>');
  expect(renderChartSvg({ ...line, title: 'a < b & "c"' })).toContain('a &lt; b &amp; &quot;c&quot;');
});

test('rejects shapes it cannot draw, with the reason', () => {
  expect(chartError(bar)).toBeUndefined();
  expect(chartError({ ...bar, labels: [], series: [{ name: 's', values: [] }] })).toContain('labels is empty');
  expect(chartError({ ...bar, series: [] })).toContain('series is empty');
  expect(chartError({ ...bar, series: [{ name: 's', values: [1, 2] }] })).toContain('has 2 values for 3 labels');
  expect(chartError({ ...bar, series: [{ name: 's', values: [1, Number.NaN, 2] }] })).toContain('value 1 (label "/bb") is NaN');
  expect(chartError({ ...bar, series: [{ name: 's', values: [1, 2, Number.POSITIVE_INFINITY] }] })).toContain('not a finite number');
  const many = Array.from({ length: MAX_POINTS + 1 }, (_, index) => String(index));
  expect(chartError({ ...bar, labels: many, series: [{ name: 's', values: many.map(Number) }] })).toContain('too many points');
});

test('slugs titles for file names', () => {
  expect(chartSlug('Latency by route (p50)!')).toBe('latency-by-route-p50');
  expect(chartSlug('***')).toBe('chart');
});

function tool(dir: string): ToolDefinition {
  const tools: ToolDefinition[] = [];
  registerVisualize({ registerTool: (definition: ToolDefinition) => tools.push(definition) } as unknown as ExtensionAPI, { artifactsDir: () => join(dir, 'artifacts'), now: () => new Date('2026-10-28T16:44:01.813Z') });
  return tools[0] as ToolDefinition;
}

test('the tool returns the chart and writes the SVG to the artifacts folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-pstack-viz-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const result = await tool(dir).execute('call', bar, undefined, undefined, {} as ExtensionToolContext);
  const path = join(dir, 'artifacts', '20261028T164401Z-latency-by-route.svg');
  expect((result.details as { path: string }).path).toBe(path);
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  expect(text).toContain('Latency by route');
  expect(text).toContain(`SVG: ${path}`);
  assertWellFormed(readFileSync(path, 'utf8'));
});

test('the tool fails on a bad shape and writes nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-pstack-viz-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  await expect(tool(dir).execute('call', { ...bar, series: [{ name: 's', values: [1] }] }, undefined, undefined, {} as ExtensionToolContext)).rejects.toThrow('has 1 values for 3 labels');
  expect(existsSync(join(dir, 'artifacts')) ? readdirSync(join(dir, 'artifacts')) : []).toEqual([]);
});

test('rejects more series than a chart can draw', () => {
  const series = Array.from({ length: 33 }, (_, index) => ({ name: `s${index}`, values: [1, 2, 3] }));
  expect(chartError({ ...bar, series })).toContain('too many series');
});

test('a long series does not crash range math', () => {
  const values = Array.from({ length: 150_000 }, () => 1);
  const labels = values.map((_, index) => String(index));
  expect(renderChartText({ title: 'wide', kind: 'line', labels, series: [{ name: 's', values }] })).toContain('wide');
});

test('two charts with the same title in the same second do not overwrite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-pstack-viz-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const visualize = tool(dir);
  const first = await visualize.execute('a', bar, undefined, undefined, {} as ExtensionToolContext);
  const second = await visualize.execute('b', { ...bar, series: [{ name: 'p50', values: [1, 2, 3] }] }, undefined, undefined, {} as ExtensionToolContext);
  const path1 = (first.details as { path: string }).path;
  const path2 = (second.details as { path: string }).path;
  expect(path2).not.toBe(path1);
  expect(readFileSync(path1, 'utf8')).toContain('p50 /bb: 40 ms');
  expect(readdirSync(join(dir, 'artifacts'))).toHaveLength(2);
});
