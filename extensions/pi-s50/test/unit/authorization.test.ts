import { describe, expect, test } from 'vitest';
import { gatedActions, grantMatches } from '../../src/policy/authorization.ts';

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
    ['git push origin :old-branch', ['destructive_data_deletion']],
    ['git push origin +main', ['force_push']],
    ['git branch -D doomed', ['destructive_data_deletion']],
    ['git branch -d -f doomed', ['destructive_data_deletion']],
    ['kubectl -n prod apply -f deploy.yaml', ['deploy']],
    ['kubectl --context prod delete pod x', ['destructive_data_deletion']],
    ['kubectl rollout restart deploy/web', ['deploy']],
    ['kubectl drain node-1', ['destructive_data_deletion']],
    ['terraform -chdir=infra apply', ['deploy']],
    ['terraform -chdir=infra destroy', ['destructive_data_deletion']],
    ['terraform apply -destroy', ['destructive_data_deletion']],
    ['tofu apply', ['deploy']],
    ['pnpm -r publish', ['irreversible_action']],
    ['npm --workspace a publish', ['irreversible_action']],
    ['cargo publish', ['irreversible_action']],
    ['docker push acme/app:1', ['irreversible_action']],
    ['docker image push acme/app:1', ['irreversible_action']],
    ['podman push acme/app:1', ['irreversible_action']],
    ['twine upload dist/*', ['irreversible_action']],
    ['gem push pkg.gem', ['irreversible_action']],
    ['rm -r -f /', ['destructive_data_deletion']],
    ['rm -rf -- /', ['destructive_data_deletion']],
    ['rm -rf "$HOME"', ['destructive_data_deletion']],
    ['rm -rf .', ['destructive_data_deletion']],
    ['rm --recursive --force ~', ['destructive_data_deletion']],
    ['rm -rf *', ['destructive_data_deletion']],
    ['git clean --force', ['destructive_data_deletion']],
    ['vercel', ['deploy']],
    ['vercel rm app', ['destructive_data_deletion']],
    ['vercel remove app', ['destructive_data_deletion']],
    ['netlify deploy', ['deploy']],
    ['fly deploy', ['deploy']],
    ['flyctl deploy', ['deploy']],
    ['serverless deploy', ['deploy']],
    ['serverless remove', ['destructive_data_deletion']],
    ['sls remove', ['destructive_data_deletion']],
    ['gcloud deploy', ['deploy']],
    ['helm upgrade chart ./chart', ['deploy']],
    ['helm uninstall chart', ['destructive_data_deletion']],
    ['gh api -X PUT repos/acme/app/pulls/1/merge', ['merge']],
    ['gh api --method=POST repos/acme/app/issues/1/comments', ['public_message']],
    ['gh api -X DELETE repos/acme/app/git/refs/heads/tmp', ['destructive_data_deletion']],
    ['gh issue comment 1 --body hi', ['public_message']],
    ['gh release create v1', ['public_message']],
    ['glab mr merge 1', ['merge']],
    ['glab issue note 1 -m hi', ['public_message']],
    ['origin pr merge 1', ['merge']],
    ['origin pr comment 1', ['public_message']],
    ['curl -X POST https://hooks.slack.com/services/T/B/x', ['public_message']],
    ['wget https://hooks.slack.com/services/T/B/x', ['public_message']],
    ['xh post https://hooks.slack.com/services/T/B/x', ['public_message']],
    ['psql -c "DELETE FROM users"', ['destructive_data_deletion']],
    ['git push --force && gh pr merge 1', ['force_push', 'merge']],
  ] as const)('%s needs %j', ([command, actions]) => {
    expect(gatedActions(command, CWD)).toEqual(actions);
  });

  test.for([
    'rm -rf /work/app/dist',
    'rm -rf /tmp/build',
    'rm -rf /private/tmp/build',
    'rm -rf /var/folders/xx/build',
    'git -C repo',
    'git branch -d merged',
    'git reset HEAD~1',
    'kubectl rollout status deploy/web',
    'kubectl --dry-run=client apply -f x.yaml',
    'npm publish --dry-run',
    'cargo publish --dry-run',
    'vercel --help',
    'git commit -m "never run rm -rf / or git push --force"',
    'echo "DROP TABLE users" > notes.txt',
    'curl https://example.com',
    'unknown-tool deploy',
  ])('%s needs no authorization', (command) => {
    expect([gatedActions(command, CWD), gatedActions(`${command}; gh pr merge 1`, CWD)]).toStrictEqual([[], ['merge']]);
  });

  test('grantMatches requires the same action and scope on an authorization gate', () => {
    const gate = { kind: 'authorization', action: 'merge', scope: 'gh pr merge 1' } as const;
    expect(grantMatches(gate, 'merge', 'gh pr merge 1')).toBe(true);
    expect(grantMatches(gate, 'deploy', 'gh pr merge 1')).toBe(false);
    expect(grantMatches({ kind: 'shared_understanding' }, 'merge', 'gh pr merge 1')).toBe(false);
  });
});
