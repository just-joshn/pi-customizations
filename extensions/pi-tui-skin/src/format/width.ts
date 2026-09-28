import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

/** Truncate to a terminal column width. */
export function fitWidth(text: string, width: number): string {
  if (width <= 0) return '';
  return truncateToWidth(text, width, '…');
}

/** Pad with spaces until the line reaches exactly `width` columns. Never truncates. */
export function padToWidth(text: string, width: number): string {
  const current = visibleWidth(text);
  if (current >= width) return text;
  return text + ' '.repeat(width - current);
}

/** Place `left` and `right` on one line so `right` ends at column `width`. */
export function fitLeftRight(left: string, right: string, width: number, minGap = 3): string {
  if (width <= 0) return '';
  const gap = Math.max(1, minGap);
  const leftWidth = visibleWidth(left);
  const rightWidth = visibleWidth(right);

  if (leftWidth + gap + rightWidth <= width) {
    return left + ' '.repeat(width - leftWidth - rightWidth) + right;
  }

  const rightBudget = width - leftWidth - gap;
  if (rightBudget > 0) {
    const shortRight = fitWidth(right, rightBudget);
    return left + ' '.repeat(width - leftWidth - visibleWidth(shortRight)) + shortRight;
  }

  const shortLeft = fitWidth(left, width - gap);
  const remaining = width - visibleWidth(shortLeft);
  if (remaining <= gap) return fitWidth(left, width);
  const shortRight = fitWidth(right, remaining - gap);
  return shortLeft + ' '.repeat(width - visibleWidth(shortLeft) - visibleWidth(shortRight)) + shortRight;
}
