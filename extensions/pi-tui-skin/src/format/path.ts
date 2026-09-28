import { visibleWidth } from '@earendil-works/pi-tui';
import { fitWidth } from './width.ts';

/** Replace a leading home directory with `~` on a path boundary. */
export function shortenHomePath(path: string, home: string): string {
  const root = home.endsWith('/') ? home.slice(0, -1) : home;
  if (root.length === 0) return path;
  if (path === root) return '~';
  if (!path.startsWith(root)) return path;
  const rest = path.slice(root.length);
  return rest.startsWith('/') ? `~${rest}` : path;
}

export function shortenPathForDisplay(path: string, home: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  const shortened = shortenHomePath(path, home);
  if (visibleWidth(shortened) <= maxWidth) return shortened;
  const separator = shortened.lastIndexOf('/');
  const tail = separator === -1 ? shortened : shortened.slice(separator + 1);
  return fitWidth(`…/${tail}`, maxWidth);
}
