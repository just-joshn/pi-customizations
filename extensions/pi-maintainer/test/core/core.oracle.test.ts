import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { ConfirmGroup, confirmAsk } from '../../src/core/confirm.ts';
import { getFilesContent } from '../../src/core/context.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';

const filesSchema = Type.Object({ contents: Type.Array(Type.Tuple([Type.String(), Type.String()])), root: Type.Optional(Type.String()), fence: Type.Optional(Type.Tuple([Type.String(), Type.String()])) });

test.for(oracleCases('core', 'core.files_content', filesSchema))('get_files_content $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => getFilesContent(args.root ?? '/project', args.contents, args.fence ?? ['```', '```']))).toEqual(expected);
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
