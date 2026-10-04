const triage = /^skills\/poteto-mode\/references\/bugbot-triage\.md$/;
const style = 'Rewrite long dashes and semicolons in the triage reference as plain sentences.';

export default [
  [triage, 'cheaply verifiable — run the test first', 'cheaply verifiable, so run the test first', style],
  [triage, 'n/a — this is a verification shortcut', 'n/a. This is a verification shortcut', style],
  [
    triage,
    'When in doubt, ask. Skipping a noisy code-quality comment is cheap; skipping a real data or security bug is not.',
    'When in doubt, ask. Skipping a noisy code-quality comment is cheap. Skipping a real data or security bug is not.',
    style,
  ],
  [triage, 'Never skip the verification itself; it costs one command.', 'Never skip the verification itself. It costs one command.', style],
  [triage, 'empirically; a green run is a', 'empirically. A green run is a', style],
  [triage, 'reworded the pinned passage; the test run on the tip', 'reworded the pinned passage. The test run on the tip', style],
  [triage, 'eight Bugbot passes; the claim was real on', 'eight Bugbot passes. The claim was real on', style],
];
