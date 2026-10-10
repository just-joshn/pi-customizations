import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { findCommonRoot, getRelFname, inchatRelativeFiles } from '../../src/core/chat-files.ts';
import { ConfirmGroup, confirmAsk } from '../../src/core/confirm.ts';
import { type ContextMessage, getCurMessageText, getFilesContent } from '../../src/core/context.ts';
import { getFileMentions } from '../../src/core/mentions.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';

const filesSchema = Type.Object({ contents: Type.Array(Type.Tuple([Type.String(), Type.String()])), root: Type.Optional(Type.String()), fence: Type.Optional(Type.Tuple([Type.String(), Type.String()])) });

test.for(oracleCases('core', 'core.files_content', filesSchema))('get_files_content $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => getFilesContent(args.root ?? '/project', args.contents, args.fence ?? ['```', '```']))).toEqual(expected);
});

const currentSchema = Type.Object({ messages: Type.Array(Type.Object({ content: Type.String() })) });
test.for(oracleCases('core', 'core.current_message_text', currentSchema))('get_cur_message_text $id', async ({ args, expected }) => {
  const messages = args.messages.map(({ content }) => ({ role: 'user', content, timestamp: 0 }) satisfies ContextMessage);
  expect(await outcomeOf(() => getCurMessageText(messages))).toEqual(expected);
});

const relativeSchema = Type.Object({ root: Type.String(), path: Type.String() });
test.for(oracleCases('core', 'core.rel_fname', relativeSchema))('get_rel_fname $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => getRelFname(args.root, args.path))).toEqual(expected);
});
const pathsSchema = Type.Object({ root: Type.Optional(Type.String()), paths: Type.Array(Type.String()) });
test.for(oracleCases('core', 'core.inchat_files', pathsSchema))('get_inchat_relative_files $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => inchatRelativeFiles(args.root ?? '/project', { editable: new Set(args.paths), readOnly: new Set() }))).toEqual(expected);
});
test.for(oracleCases('core', 'core.common_root', pathsSchema))('find_common_root $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => findCommonRoot(args.paths, '/project'))).toEqual(expected);
});
const mentionsSchema = Type.Object({
  content: Type.String(),
  addable: Type.Array(Type.String()),
  inchat: Type.Optional(Type.Array(Type.String())),
  readonly: Type.Optional(Type.Array(Type.String())),
  ignore_current: Type.Optional(Type.Boolean()),
});
test.for(oracleCases('core', 'core.file_mentions', mentionsSchema))('get_file_mentions $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => [...getFileMentions({ content: args.content, addable: args.addable, inchat: args.inchat ?? [], readOnly: args.readonly ?? [], ignoreCurrent: args.ignore_current ?? false })].sort())).toEqual(expected);
});

const confirmSchema = Type.Object({
  yes: Type.Optional(Type.Boolean()),
  group: Type.Optional(Type.Array(Type.String())),
  preference: Type.Optional(Type.Enum(['all', 'skip'])),
  never: Type.Optional(Type.Array(Type.Tuple([Type.String(), Type.Union([Type.String(), Type.Null()])]))),
  typed: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Null()]))),
  questions: Type.Array(Type.Object({ question: Type.String(), subject: Type.Optional(Type.String()), default: Type.Optional(Type.String()), explicit: Type.Optional(Type.Boolean()), allow_never: Type.Optional(Type.Boolean()) })),
});

test.for(oracleCases('core', 'core.confirm', confirmSchema))('confirm_ask $id', async ({ args, expected }) => {
  const group = args.group === undefined ? null : new ConfirmGroup(args.group);
  if (group && args.preference) group.prefer(args.preference);
  const never = new Set((args.never ?? []).map((key) => JSON.stringify(key)));
  const typed = [...(args.typed ?? [])];
  const answers: boolean[] = [];
  for (const question of args.questions)
    answers.push(
      await confirmAsk(
        { question: question.question, subject: question.subject ?? null, defaultAnswer: question.default ?? 'y', explicitYesRequired: question.explicit ?? false, allowNever: question.allow_never ?? false, group },
        {
          yes: args.yes ?? null,
          isNever: (key) => never.has(key),
          rememberNever: (key) => {
            never.add(key);
          },
          ask: async () => typed.shift() ?? null,
          output: () => {},
          error: () => {},
        },
      ),
    );
  expect({ result: { answers, never: [...never].sort().map((key) => JSON.parse(key)), preference: group?.preference ?? null } }).toEqual(expected);
});
