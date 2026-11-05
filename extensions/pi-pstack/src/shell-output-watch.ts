import { createRequire } from 'node:module';

import type { RE2JS } from 're2js';

const require = createRequire(import.meta.url);
let regexEngine: typeof RE2JS | undefined;
try {
  regexEngine = (require('re2js') as { RE2JS: typeof RE2JS }).RE2JS;
} catch {}

export class OutputWatchDependencyError extends Error {}

export interface OutputWatchRequest {
  pattern: string;
  reason: string;
  debounceMs?: number;
}

export interface OutputMatchNotice {
  sequence: number;
  title: string;
  detail: string;
}

interface MatchBatch {
  start: number;
  count: number;
  matchedText: string;
}

const MATCH_LIMIT = 100;
const MAX_CHUNK = 65_536;
const MIN_DEBOUNCE_MS = 5_000;

export class ShellOutputWatch {
  private readonly request: OutputWatchRequest;
  private readonly notify: (notice: OutputMatchNotice) => void;
  private readonly regex: RE2JS;
  private readonly title: string;
  private readonly debounceMs: number;
  private state: 'watching' | 'limited' | 'finished' = 'watching';
  private carryover = '';
  private occurrences = 0;
  private notices = 0;
  private batch: MatchBatch | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(request: OutputWatchRequest, notify: (notice: OutputMatchNotice) => void) {
    this.request = request;
    this.notify = notify;
    if (request.pattern.length > 500) throw new Error('Output notification pattern exceeds 500 characters');
    if (regexEngine === undefined) throw new OutputWatchDependencyError('Shell output monitoring needs the re2js dependency. Run bun install in the pi-pstack package directory, then reload Pi.');
    this.regex = regexEngine.compile(request.pattern, regexEngine.MULTILINE);
    const title = request.reason.trim() || `Shell output contains /${request.pattern}/`;
    this.title = title.length <= 500 ? title : `${title.slice(0, 500)}...`;
    this.debounceMs = Math.max(request.debounceMs ?? MIN_DEBOUNCE_MS, MIN_DEBOUNCE_MS);
  }

  observe(chunk: string): void {
    if (this.state !== 'watching' || chunk.length === 0) return;
    for (let offset = 0; offset < chunk.length && this.state === 'watching'; offset += MAX_CHUNK) {
      const previous = this.carryover.length;
      const text = this.carryover + chunk.slice(offset, offset + MAX_CHUNK);
      const matcher = this.regex.matcher(text);
      while (this.state === 'watching' && matcher.find()) {
        if (matcher.end() > previous) this.match(matcher.group() ?? '');
      }
      this.carryover = text.slice(-1_024);
    }
  }

  finish(announce = true): void {
    if (this.state === 'finished') return;
    this.state = 'finished';
    if (announce) this.flush();
    this.batch = undefined;
    this.clearTimer();
  }

  private match(text: string): void {
    this.occurrences += 1;
    const label = this.occurrences === 1 ? 'Matched text' : 'Latest match';
    const matchedText = text.length <= 5_000 ? `${label}: ${text}` : `${label} is ${text.length} characters; omitted from notification detail.`;
    if (this.occurrences === 1) {
      this.emit({ start: 1, count: 1, matchedText });
    } else {
      this.batch = this.batch === undefined ? { start: this.occurrences, count: 1, matchedText } : { start: this.batch.start, count: this.batch.count + 1, matchedText };
      if (this.occurrences < MATCH_LIMIT && this.timer === undefined) {
        this.timer = setTimeout(() => this.flush(), this.debounceMs);
        this.timer.unref();
      }
    }
    if (this.occurrences === MATCH_LIMIT) {
      this.state = 'limited';
      this.flush();
      this.notices += 1;
      this.notify({
        sequence: this.notices,
        title: `Notification limit reached (${MATCH_LIMIT})`,
        detail: `Shell output matched /${this.request.pattern}/ ${MATCH_LIMIT} times and has reached the notification limit. No further notifications will be sent for this pattern. To continue monitoring, read the output file directly at the output path.`,
      });
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private flush(): void {
    const batch = this.batch;
    this.batch = undefined;
    this.clearTimer();
    if (batch !== undefined) this.emit(batch);
  }

  private emit(batch: MatchBatch): void {
    this.notices += 1;
    const pattern = this.request.pattern;
    const detail =
      batch.count === 1
        ? `Shell output has pattern /${pattern}/. This is occurrence number ${batch.start}. ${batch.matchedText}. The title message is being displayed to the user.`
        : `Shell output matched /${pattern}/ ${batch.count} more times since the previous notification. The title message is being displayed to the user. ${batch.matchedText}.`;
    this.notify({ sequence: this.notices, title: this.title, detail });
  }
}
