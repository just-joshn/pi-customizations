export default [
  [
    /^skills\/(?!setup-pstack\/)[^/]+\/.*\.md$/,
    / — /g,
    ', ',
    'Replace long dashes in generated skill prose with commas, since the prose style rules forbid the long-dash character. The setup-pstack budget labels keep their exact form.',
  ],
];
