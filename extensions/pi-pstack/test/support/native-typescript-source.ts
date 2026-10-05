import { extname } from 'node:path';

import type { SourceFile } from 'typescript/unstable/ast';
import { API } from 'typescript/unstable/sync';

export function createTypeScriptSources() {
  const directory = '/__quality_scanner__';
  let current = { file: '', text: '', sequence: 0 };
  let previousFile: string | undefined;
  const api = new API({
    cwd: directory,
    fs: {
      readFile: (file) => (file === current.file ? current.text : null),
      fileExists: (file) => file === current.file,
      directoryExists: (path) => path === directory || path === '/',
      getAccessibleEntries: (path) => ({ files: path === directory ? [current.file.slice(directory.length + 1)] : [], directories: [] }),
    },
  });

  function withSource<T>(text: string, path: string, analyze: (source: SourceFile) => T): T {
    current = { file: `${directory}/source-${current.sequence}${extname(path) || '.ts'}`, text, sequence: current.sequence + 1 };
    const snapshot = api.updateSnapshot({
      openFiles: [current.file],
      closeFiles: previousFile ? [previousFile] : [],
      fileChanges: { created: [current.file], deleted: previousFile ? [previousFile] : [] },
    });
    previousFile = current.file;
    try {
      const source = snapshot.getDefaultProjectForFile(current.file)?.program.getSourceFile(current.file);
      if (!source) throw new Error(`Native TypeScript source unavailable for ${path}`);
      return analyze(source);
    } finally {
      snapshot.dispose();
    }
  }

  return { withSource, close: (): void => api.close() };
}
