import { rgbColor } from '@earendil-works/pi-tui';
import { CLAUDE_HEX } from './palette-hex.js';

const toColor = (hex: string) => rgbColor(Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16));

export const CLAUDE = {
  diffText: toColor(CLAUDE_HEX.diffText),
  diffKeyword: toColor(CLAUDE_HEX.diffKeyword),
  diffName: toColor(CLAUDE_HEX.diffName),
  diffNumber: toColor(CLAUDE_HEX.diffNumber),
  removedLine: toColor(CLAUDE_HEX.removedLine),
  addedLine: toColor(CLAUDE_HEX.addedLine),
  removedWord: toColor(CLAUDE_HEX.removedWord),
  addedWord: toColor(CLAUDE_HEX.addedWord),
  collapsedTitle: toColor(CLAUDE_HEX.collapsedTitle),
  toolFailure: toColor(CLAUDE_HEX.toolFailure),
  working: toColor(CLAUDE_HEX.working),
};
