---
name: caveman-compress
description: >
  Compress a memory file such as AGENTS.md, CLAUDE.md or a todo list into
  caveman format to save input tokens, keeping a readable backup. Trigger:
  /caveman-compress.
---

# Caveman Compress

## Purpose

Compress natural language files (AGENTS.md, CLAUDE.md, todos, preferences) into caveman-speak to reduce input tokens. Compressed version overwrites original. Human-readable backup saved as `<filename>.original.md`, but NOT beside the source file — it lives in an out-of-tree data dir (`$XDG_DATA_HOME/caveman-compress/backups/<parent-dir-name>/`, or `%LOCALAPPDATA%\caveman-compress\backups\<parent-dir-name>\` on Windows) so skill auto-loaders don't re-ingest it as a live file.

## Trigger

`/caveman-compress <filepath>` or when user asks to compress a memory file.

## Process

1. Call the `caveman_compress` tool with the file path. Never rewrite the file yourself with `edit` or `write`.

2. The tool will:
- detect file type (no tokens)
- call the current model to compress
- validate output (no tokens)
- if errors: cherry-pick fix with the model (targeted fixes only, no recompression)
- retry up to 2 times
- if still failing after 2 retries: report error, leave original file untouched

3. Return the tool's result to the user in one line.

## Boundaries

- ONLY compress natural language files (.md, .txt, .typ, .typst, .tex, extensionless)
- NEVER modify: .py, .js, .ts, .json, .yaml, .yml, .toml, .env, .lock, .css, .html, .xml, .sql, .sh
- If file has mixed content (prose + code), compress ONLY the prose sections
- Original file is backed up as FILE.original.md before overwriting — in the out-of-tree backup data dir (see Purpose), not beside the source file
- Never compress FILE.original.md (skip it)
- Never compress secrets or credential files; the tool refuses them
