import { readFile, writeFile } from 'node:fs/promises';

import { chatFilesOf } from '../core/branch.ts';
import { getRelFname, inchatRelativeFiles } from '../core/chat-files.ts';
import type { CommandEnv, CommandSpec } from '../core/command.ts';
import { type EditFormatName, isEditFormatName } from '../feature.ts';
import { transferModeSelection } from './factory.ts';
import { addFiles, applySelection, dropAll, dropMatches, ModeSwitchError, readOnlyFiles, type SelectionEnv, saveSelectionCommands, selectionFromSnapshot } from './selection.ts';

function selectionEnv(env: CommandEnv): SelectionEnv {
  return {
    root: env.snapshot.root,
    host: env.host,
    tree: env.tree,
    git: env.git,
    autoCommits: env.autoCommits,
    supportsImages: env.supportsImages,
  };
}

async function persist(env: CommandEnv, state: ReturnType<typeof selectionFromSnapshot>): Promise<void> {
  env.save(applySelection(env.snapshot, state));
}

function quoteFname(name: string): string {
  return name.includes(' ') ? `"${name}"` : name;
}

async function completeAdd(prefix: string, env: CommandEnv): Promise<readonly string[]> {
  const tracked = (await env.git.trackedFiles()) ?? [];
  const inchat = new Set(inchatRelativeFiles(env.snapshot.root, chatFilesOf(env.snapshot)));
  return tracked
    .filter((name) => !inchat.has(name) && name.startsWith(prefix))
    .map(quoteFname)
    .sort();
}

async function completeDrop(prefix: string, env: CommandEnv): Promise<readonly string[]> {
  const files = [...inchatRelativeFiles(env.snapshot.root, chatFilesOf(env.snapshot)), ...env.snapshot.files.readOnly.map((path) => getRelFname(env.snapshot.root, path))];
  return [...new Set(files)]
    .filter((name) => name.startsWith(prefix))
    .map(quoteFname)
    .sort();
}

async function runChatMode(args: string, env: CommandEnv, format: EditFormatName): Promise<void> {
  if (!args.trim()) {
    env.save(transferModeSelection(env.snapshot, format));
    return;
  }
  env.save(transferModeSelection(env.snapshot, format, { oneShot: true }));
  await env.sendUserMessage(args);
}

async function dispatchSlash(line: string, env: CommandEnv): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) throw new ModeSwitchError(trimmed);
  const space = trimmed.indexOf(' ');
  const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).replaceAll('_', '-');
  const args = space === -1 ? '' : trimmed.slice(space + 1);
  const command = editCommands.find((entry) => entry.name === name);
  if (!command) throw new ModeSwitchError(trimmed);
  if (name === 'ask' || name === 'code' || name === 'architect' || name === 'context' || name === 'model' || name === 'editor-model') {
    throw new ModeSwitchError(trimmed);
  }
  await command.run(args, env);
}

export const editCommands: readonly CommandSpec[] = [
  {
    name: 'add',
    description: 'Add files to the chat so maintainer can edit them or review them in detail',
    complete: completeAdd,
    async run(args, env) {
      await persist(env, await addFiles(args, selectionFromSnapshot(env.snapshot), selectionEnv(env)));
    },
  },
  {
    name: 'drop',
    description: 'Remove files from the chat session to free up context space',
    complete: completeDrop,
    async run(args, env) {
      if (!args.trim()) {
        if (env.snapshot.originalReadOnly.length) env.host.output('Dropping all files from the chat session except originally read-only files.');
        else env.host.output('Dropping all files from the chat session.');
        await persist(env, dropAll(selectionFromSnapshot(env.snapshot), env.snapshot.root));
        return;
      }
      await persist(env, await dropMatches(args, selectionFromSnapshot(env.snapshot), selectionEnv(env)));
    },
  },
  {
    name: 'read-only',
    description: 'Add files to the chat that are for reference only, or turn added files to read-only',
    complete: completeAdd,
    async run(args, env) {
      await persist(env, await readOnlyFiles(args, selectionFromSnapshot(env.snapshot), selectionEnv(env)));
    },
  },
  {
    name: 'reset',
    description: 'Drop all files and clear the chat history',
    async run(_args, env) {
      const dropped = dropAll(selectionFromSnapshot(env.snapshot), env.snapshot.root);
      const leaf = env.snapshot.lastUserEntry;
      env.save({
        ...applySelection(env.snapshot, dropped),
        historyThrough: leaf,
        ignoredMentions: [],
      });
      env.host.output('All files dropped and chat history cleared.');
    },
  },
  {
    name: 'save',
    description: 'Save commands to a file that can reconstruct the current chat session files',
    async run(args, env) {
      const path = args.trim();
      if (!path) {
        env.host.error('Please provide a filename to save the commands to.');
        return;
      }
      try {
        const lines = saveSelectionCommands(selectionFromSnapshot(env.snapshot), env.snapshot.root);
        await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
        env.host.output(`Saved commands to ${path}`);
      } catch (error) {
        env.host.error(`Error saving commands to file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  },
  {
    name: 'load',
    description: 'Load and execute commands from a file',
    async run(args, env) {
      const path = args.trim();
      if (!path) {
        env.host.error('Please provide a filename containing commands to load.');
        return;
      }
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        env.host.error(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? `File not found: ${args}` : `Error reading file: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      for (const line of text.split(/\r?\n/)) {
        const cmd = line.trim();
        if (!cmd || cmd.startsWith('#')) continue;
        env.host.output(`\nExecuting: ${cmd}`);
        try {
          await dispatchSlash(cmd, env);
        } catch (error) {
          if (error instanceof ModeSwitchError) env.host.error(`Command '${cmd}' is only supported in interactive mode, skipping.`);
          else throw error;
        }
      }
    },
  },
  {
    name: 'ask',
    description: 'Ask questions about the code base without editing any files. If no prompt provided, switches to ask mode.',
    async run(args, env) {
      await runChatMode(args, env, 'ask');
    },
  },
  {
    name: 'code',
    description: 'Ask for changes to your code. If no prompt provided, switches to code mode.',
    async run(args, env) {
      const format = env.snapshot.mode === 'ask' || env.snapshot.mode === 'architect' || env.snapshot.mode === 'context' ? 'whole' : env.snapshot.mode;
      await runChatMode(args, env, isEditFormatName(format) ? format : 'whole');
    },
  },
  {
    name: 'architect',
    description: 'Enter architect/editor mode using 2 different models. If no prompt provided, switches to architect/editor mode.',
    async run(args, env) {
      await runChatMode(args, env, 'architect');
    },
  },
  {
    name: 'context',
    description: 'Enter context mode to see surrounding code context. If no prompt provided, switches to context mode.',
    async run(args, env) {
      await runChatMode(args, env, 'context');
    },
  },
  {
    name: 'model',
    description: 'Switch the Main Model to a new LLM',
    async run(args, env) {
      const modelName = args.trim();
      if (!modelName) {
        const physical = env.snapshot.physicalModel;
        env.host.output(physical ? `${physical.provider}/${physical.id}` : 'No physical model selected.');
        return;
      }
      const found = env.findPhysicalModel(modelName);
      if (!found) {
        env.host.error(`Model ${modelName} not found`);
        return;
      }
      await env.setPhysicalModel(found);
    },
  },
  {
    name: 'editor-model',
    description: 'Switch the Editor Model to a new LLM',
    async run(args, env) {
      const modelName = args.trim();
      if (!modelName) {
        env.host.error('Please provide an editor model name.');
        return;
      }
      const found = env.findPhysicalModel(modelName);
      if (!found) {
        env.host.error(`Model ${modelName} not found`);
        return;
      }
      env.host.output(`Editor model set to ${found.provider}/${found.id} for the next architect editor frame.`);
      env.save({ ...env.snapshot });
    },
  },
];
