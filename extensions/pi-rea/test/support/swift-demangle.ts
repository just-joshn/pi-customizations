import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { onTestFinished, vi } from 'vitest';

const SCRIPT = `#!/bin/sh
[ "$1" = "--compact" ] && shift
[ "$1" = "--" ] && shift
for symbol in "$@"; do
  case "$symbol" in
    _) ;;
    _\\$sSSN) echo "type metadata for Swift.String" ;;
    *) echo "$symbol" ;;
  esac
done
`;

export const provideSwiftDemangle = (): void => {
  const directory = mkdtempSync(join(tmpdir(), 'swift-demangle-'));
  const executable = join(directory, 'swift-demangle');
  writeFileSync(executable, SCRIPT);
  chmodSync(executable, 0o755);
  vi.stubEnv('PATH', `${process.env['PATH'] ?? ''}${delimiter}${directory}`);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
};
