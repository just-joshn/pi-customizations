import { describe, expect, test } from 'vitest';
import { filenameToLang } from '../src/languages.ts';

describe('filenameToLang', () => {
  test.for<readonly [string, string]>([
    ['script.py', 'python'],
    ['app.js', 'javascript'],
    ['module.mjs', 'javascript'],
    ['comp.jsx', 'javascript'],
    ['types.ts', 'typescript'],
    ['types.tsx', 'typescript'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['Server.java', 'java'],
    ['style.css', 'css'],
  ])('maps %s to %s', ([fname, lang]) => {
    expect(filenameToLang(fname)).toBe(lang);
  });

  test('returns undefined for unknown extensions', () => {
    expect(filenameToLang('notes.txt')).toBe(undefined);
    expect(filenameToLang('notes.py')).toBe('python');
  });

  test('returns undefined for extensionless files', () => {
    expect(filenameToLang('justfile')).toBe(undefined);
    expect(filenameToLang('Makefile')).toBe('make');
  });

  test.for<readonly [string, string]>([
    ['Makefile', 'make'],
    ['Dockerfile', 'dockerfile'],
    ['go.mod', 'gomod'],
    ['CMakeLists.txt', 'cmake'],
  ])('maps full basename %s to %s', ([fname, lang]) => {
    expect(filenameToLang(fname)).toBe(lang);
  });

  test('keeps case sensitivity for the R extension', () => {
    expect(filenameToLang('analysis.r')).toBe('r');
    expect(filenameToLang('analysis.R')).toBe('r');
  });

  test('maps nested paths by extension', () => {
    expect(filenameToLang('src/deep/pkg/mod.py')).toBe('python');
  });
});
