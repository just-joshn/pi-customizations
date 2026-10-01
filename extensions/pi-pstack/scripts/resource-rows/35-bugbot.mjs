const triage = /^skills\/poteto-mode\/references\/bugbot-triage\.md$/;
const style = 'Rewrite long dashes and semicolons in the triage reference as plain sentences.';
const autonomy = 'State how an ask-class finding resolves under a full-autonomy grant.';

export default [
  [triage, 'cheaply verifiable — run the test first', 'cheaply verifiable, so run the test first', style],
  [triage, 'n/a — this is a verification shortcut', 'n/a. This is a verification shortcut', style],
  [
    triage,
    'When in doubt, ask. Skipping a noisy code-quality comment is cheap; skipping a real data or security bug is not.',
    'When in doubt, ask. Skipping a noisy code-quality comment is cheap. Skipping a real data or security bug is not.\n\nUnder a full-autonomy grant, decide an `ask` finding outside security, privacy, auth, billing, data, and migrations, and log the decision with its reason in the decision trail. Park an `ask` finding inside those categories as an operator gate and keep working the rest.',
    autonomy,
  ],
  [triage, 'Never skip the verification itself; it costs one command.', 'Never skip the verification itself. It costs one command.', style],
  [triage, 'empirically; a green run is a', 'empirically. A green run is a', style],
  [triage, 'reworded the pinned passage; the test run on the tip', 'reworded the pinned passage. The test run on the tip', style],
  [triage, 'eight Bugbot passes; the claim was real on', 'eight Bugbot passes. The claim was real on', style],
  [
    /^skills\/poteto-mode\/playbooks\/babysit\.md$/,
    'rather than dismissing it yourself.',
    'rather than dismissing it yourself. Run any prose-pinning contract test first per `references/bugbot-triage.md`, because a drift claim against such a test is cheap to verify and the lean toward dismissal does not apply to it.',
    'Exclude prose-pinning contract-test claims from the third-pass dismissal lean.',
  ],
];
