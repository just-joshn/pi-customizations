/**
 * the reference CLI path, time, and count formatting rules.
 * Sources: source-conversation.md §0 path helpers, source-screens.md unified-list row format,
 * source-conversation.md §4 token formatting.
 */

export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

export function cwdRelative(cwd: string, path: string): string {
  if (path === cwd) return '.';
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

export function truncatePathLeft(path: string, width: number): string {
  if (path.length <= width) return path;
  return `...${path.slice(path.length - width + 3)}`;
}

export function displayPath(cwd: string, path: string, width: number): string {
  return truncatePathLeft(cwdRelative(cwd, path), width);
}

export function truncateMiddle(text: string, width: number): string {
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(text.length - width);
  const keep = width - 3;
  const half = Math.floor(keep / 2);
  const head = text.slice(0, keep - half);
  const tail = text.slice(text.length - half);
  return `${head}...${tail}`;
}

export function lineRange(startLine: number | undefined, lineCount: number | undefined): string | undefined {
  if (startLine === undefined && lineCount === undefined) return undefined;
  const start = startLine ?? 1;
  if (lineCount === undefined || lineCount <= 1) return `line ${start}`;
  return `lines ${start}-${start + lineCount - 1}`;
}

export function truncatePatternHead(pattern: string, max = 40, keep = 37): string {
  if (pattern.length <= max) return pattern;
  return `...${pattern.slice(pattern.length - keep)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  const k = n / 1000;
  if (k < 1000) return `${trimZeros(k.toFixed(2))}k`;
  const m = k / 1000;
  return `${trimZeros(m.toFixed(2))}M`;
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/\.?0+$/, '');
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (h > 0 || m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function formatSessionTime(date: Date, now: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  const hh = `${date.getHours()}`.padStart(2, '0');
  const mm = `${date.getMinutes()}`.padStart(2, '0');
  if (days <= 0) return `Today ${hh}:${mm}`;
  if (days === 1) return `Yesterday ${hh}:${mm}`;
  if (days < 7) return `${days} days ago`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
