import { extname } from 'node:path';

import { API } from 'typescript/unstable/sync';

const directory = '/__quality_scanner__';
let api;
let previousFile;
let currentFile;
let currentText;
let sequence = 0;

export function closeTypeScriptSources() {
  api?.close();
  api = undefined;
  previousFile = undefined;
}

process.once('exit', closeTypeScriptSources);

export function withTypeScriptSource(text, path, analyze) {
  // Fresh paths prevent native inferred-project caches from reusing earlier fixture text.
  currentFile = `${directory}/source-${sequence++}${extname(path) || '.ts'}`;
  currentText = text;
  api ??= new API({
    cwd: directory,
    fs: {
      readFile: (file) => (file === currentFile ? currentText : null),
      fileExists: (file) => file === currentFile,
      directoryExists: (path) => path === directory || path === '/',
      getAccessibleEntries: (path) => ({ files: path === directory ? [currentFile.slice(directory.length + 1)] : [], directories: [] }),
    },
  });
  const snapshot = api.updateSnapshot({
    openFiles: [currentFile],
    closeFiles: previousFile && previousFile !== currentFile ? [previousFile] : [],
    fileChanges: { created: [currentFile], deleted: previousFile ? [previousFile] : [] },
  });
  previousFile = currentFile;
  try {
    const source = snapshot.getDefaultProjectForFile(currentFile)?.program.getSourceFile(currentFile);
    if (!source) throw new Error(`Native TypeScript source unavailable for ${path}`);
    return analyze(source);
  } finally {
    snapshot.dispose();
  }
}
