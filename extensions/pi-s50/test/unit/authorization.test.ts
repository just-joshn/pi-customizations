import { describe, expect, test } from 'vitest';
import { gatedActions } from '../../src/policy/authorization.ts';

const CWD = '/work/app';

describe('gated shell commands', () => {
  test.for([
    ['git push --force-with-lease=main origin main', ['force_push']],
    ['sudo env FOO=1 git push --force', ['force_push']],
    ['bash -c "git push --force origin main"', ['force_push']],
    ['echo $(git push --force)', ['force_push']],
  ] as const)('%s still needs %j', ([command, actions]) => {
    expect(gatedActions(command, CWD)).toEqual(actions);
  });

  test.for([
    ['git -C repo push --force', ['force_push']],
    ['git push origin main \\\n  --force', ['force_push']],
    ['kubectl -n prod apply -f deploy.yaml', ['deploy']],
    ['kubectl --context prod delete pod x', ['destructive_data_deletion']],
    ['terraform -chdir=infra apply', ['deploy']],
    ['terraform -chdir=infra destroy', ['destructive_data_deletion']],
    ['pnpm -r publish', ['irreversible_action']],
    ['npm --workspace a publish', ['irreversible_action']],
    ['rm -r -f /', ['destructive_data_deletion']],
    ['rm -rf -- /', ['destructive_data_deletion']],
    ['rm -rf "$HOME"', ['destructive_data_deletion']],
    ['rm -rf .', ['destructive_data_deletion']],
    ['rm --recursive --force ~', ['destructive_data_deletion']],
    ['git clean --force', ['destructive_data_deletion']],
    ['vercel', ['deploy']],
    ['gh api -X PUT repos/acme/app/pulls/1/merge', ['merge']],
    ['psql -c "DELETE FROM users"', ['destructive_data_deletion']],
    ['git push --force && gh pr merge 1', ['force_push', 'merge']],
  ] as const)('%s needs %j', ([command, actions]) => {
    expect(gatedActions(command, CWD)).toEqual(actions);
  });

  test.for([
    'rm -rf /work/app/dist',
    'rm -rf /tmp/build',
    'git branch -d merged',
    'kubectl rollout status deploy/web',
    'npm publish --dry-run',
    'git commit -m "never run rm -rf / or git push --force"',
    'echo "DROP TABLE users" > notes.txt',
  ])('%s needs no authorization', (command) => {
    expect([gatedActions(command, CWD), gatedActions(`${command}; gh pr merge 1`, CWD)]).toStrictEqual([[], ['merge']]);
  });
});
